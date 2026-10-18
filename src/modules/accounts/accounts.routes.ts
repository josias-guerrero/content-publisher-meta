import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sqlite } from '../../db/index.js';
import { context } from '../../security/context.js';
import { accountGrant, activeGrant } from '../../security/access.js';
import { decrypt } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { capabilities } from '../../meta/media.js';
import * as graph from '../../meta/graph-api.js';
export async function accountsRoutes(app: FastifyInstance) {
  app.post('/', async () => {
    throw new AppError(
      409,
      'MANUAL_TOKEN_DISABLED',
      'Use verified OAuth asset selection',
    );
  });
  app.get('/', async (req) => {
    const q = z
        .object({
          limit: z.coerce.number().int().min(1).max(100).default(20),
          offset: z.coerce.number().int().min(0).default(0),
        })
        .parse(req.query),
      c = context();
    const rows = sqlite
      .prepare(
        `SELECT id,platform,external_id,name,created_at,connection_id,status,token_expires_at,capabilities FROM (SELECT a.id,a.platform,a.external_id,a.name,a.created_at,c.id connection_id,c.status,c.expires_at token_expires_at,g.capabilities,ROW_NUMBER() OVER (PARTITION BY a.id,g.agency_id,g.client_id ORDER BY CASE WHEN c.status='active' THEN 0 ELSE 1 END,c.created_at DESC,g.id DESC) rn FROM accounts a JOIN grants g ON a.id=g.account_id JOIN connections c ON c.id=g.connection_id WHERE g.agency_id=? AND g.client_id=?) WHERE rn=1 ORDER BY created_at DESC,id LIMIT ? OFFSET ?`,
      )
      .all(c.agencyId, c.clientId, q.limit, q.offset) as any[];
    return {
      accounts: rows.map((r) => ({
        ...r,
        capabilities: capabilities(r.platform, JSON.parse(r.capabilities)),
      })),
    };
  });
  app.get('/:id/capabilities', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params),
      g = accountGrant(id),
      a = sqlite
        .prepare('SELECT platform FROM accounts WHERE id=?')
        .get(id) as any;
    return capabilities(a.platform, JSON.parse(g.capabilities));
  });
  app.delete('/:id', async (req) => {
    accountGrant((req.params as any).id);
    throw new AppError(
      409,
      'USE_DISCONNECT',
      'Disconnect the connection; account/history deletion is a separate operation',
    );
  });
  app.post('/:id/test', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params),
      g = activeGrant(id),
      a = sqlite.prepare('SELECT * FROM accounts WHERE id=?').get(id) as any;
    const token = decrypt(g.token);
    if (a.platform === 'instagram') {
      const user = await graph.getInstagramUser(token);
      return {
        platform: a.platform,
        matched: String(user.userId) === a.external_id,
        account_type: user.accountType,
        published: false,
        checks: ['identity'],
        publishingPermissionVerified: false,
      };
    }
    const identity = await graph.getFacebookUserId(token);
    return {
      platform: a.platform,
      matched: identity === a.external_id,
      published: false,
      checks: ['identity'],
      publishingPermissionVerified: false,
    };
  });
}
