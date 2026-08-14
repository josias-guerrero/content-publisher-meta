import type { FastifyInstance } from 'fastify';
import { createAccountSchema, testAccountSchema } from './accounts.schema.js';
import * as accountsService from './accounts.service.js';
import * as graphApi from '../../meta/graph-api.js';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function accountsRoutes(fastify: FastifyInstance) {
  fastify.post('/', async (request, reply) => {
    const data = createAccountSchema.parse(request.body);
    const result = await accountsService.createAccount(data);
    return reply.status(201).send(result);
  });

  fastify.get('/', async (request, reply) => {
    const accounts = await accountsService.listAccounts();
    return { accounts };
  });

  fastify.post('/:id/test', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = testAccountSchema.parse(request.body ?? {});

    const account = await accountsService.getAccountWithToken(id);
    if (!account) {
      return reply.status(404).send({ error: 'Account not found' });
    }

    try {
      if (account.platform === 'facebook') {
        const pages = await graphApi.getFacebookPages(account.access_token);
        const page = pages.find((p) => p.id === account.external_id) ?? null;
        return { platform: 'facebook', external_id: account.external_id, page, accessible: !!page };
      }

      const user = await graphApi.getInstagramUser(account.access_token);
      const result: Record<string, unknown> = {
        platform: 'instagram',
        external_id: account.external_id,
        matched: user.userId === account.external_id,
        username: user.username,
        account_type: user.accountType,
      };

      if (body.imageUrl) {
        const { containerId } = await graphApi.createMediaContainer(
          account.external_id,
          account.access_token,
          { imageUrl: body.imageUrl }
        );
        let statusCode: string = 'IN_PROGRESS';
        for (let i = 0; i < 5; i++) {
          const status = await graphApi.getContainerStatus(containerId, account.access_token);
          statusCode = status.statusCode;
          if (statusCode === 'FINISHED' || statusCode === 'ERROR' || statusCode === 'EXPIRED') break;
          await sleep(2000);
        }
        result.container = { container_id: containerId, status: statusCode };
      }

      return result;
    } catch (err: any) {
      return reply.status(502).send({ error: err.message });
    }
  });
}
