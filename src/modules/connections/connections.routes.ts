import type { FastifyInstance } from 'fastify';
import { sqlite } from '../../db/index.js';
import { context } from '../../security/context.js';
import { AppError } from '../../lib/errors.js';
import { audit } from '../../security/audit.js';
import { emit, postEvent } from '../../jobs/events.js';
export function stopConnection(
  id: string,
  status: 'disconnected' | 'revoked' | 'reauth_required',
) {
  sqlite.transaction(() => {
    const now = Math.floor(Date.now() / 1000);
    const row = sqlite
      .prepare('SELECT status FROM connections WHERE id=?')
      .get(id) as any;
    if (!row || row.status === status) return;
    sqlite
      .prepare('UPDATE connections SET status=?,updated_at=? WHERE id=?')
      .run(status, now, id);
    const affected = sqlite
      .prepare(
        "SELECT p.id FROM posts p JOIN post_ownership o ON o.post_id=p.id JOIN grants g ON g.id=o.grant_id WHERE g.connection_id=? AND p.status='pending'",
      )
      .all(id) as any[];
    for (const p of affected) {
      sqlite
        .prepare(
          "UPDATE posts SET status='cancelled',error_code='CONNECTION_UNAVAILABLE',updated_at=? WHERE id=? AND status='pending'",
        )
        .run(now, p.id);
      postEvent(p.id);
    }
    const scopes = sqlite
      .prepare(
        'SELECT DISTINCT agency_id,client_id FROM grants WHERE connection_id=?',
      )
      .all(id) as any[];
    for (const s of scopes)
      emit(
        status === 'reauth_required'
          ? 'connection.updated'
          : 'connection.disconnected',
        { agencyId: s.agency_id, clientId: s.client_id },
        { id, status },
      );
  })();
}
export async function connectionsRoutes(app: FastifyInstance) {
  app.get('/', async () => {
    const c = context();
    return {
      connections: sqlite
        .prepare(
          'SELECT DISTINCT c.id,c.provider,c.login_mode,c.app_id,c.status,c.expires_at,c.created_at,c.updated_at FROM connections c JOIN grants g ON g.connection_id=c.id WHERE g.agency_id=? AND g.client_id=? ORDER BY c.created_at DESC LIMIT 100',
        )
        .all(c.agencyId, c.clientId),
    };
  });
  app.post('/:id/disconnect', async (req) => {
    const c = context(),
      id = (req.params as any).id;
    if (c.role !== 'admin')
      throw new AppError(
        403,
        'ADMIN_REQUIRED',
        'Agency admin required to disconnect a shared connection',
      );
    if (
      !sqlite
        .prepare('SELECT id FROM connections WHERE id=? AND agency_id=?')
        .get(id, c.agencyId)
    )
      throw new AppError(404, 'CONNECTION_NOT_FOUND', 'Connection not found');
    sqlite.transaction(() => {
      stopConnection(id, 'disconnected');
      audit(c.userId, c.agencyId, 'connection.disconnect', id);
    })();
    return { id, status: 'disconnected' };
  });
}
