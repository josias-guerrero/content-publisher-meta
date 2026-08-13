import type { FastifyInstance } from 'fastify';
import { createAccountSchema } from './accounts.schema.js';
import * as accountsService from './accounts.service.js';

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
}
