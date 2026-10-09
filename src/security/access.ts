import { sqlite } from '../db/index.js';
import { context } from './context.js';
import { AppError } from '../lib/errors.js';
export function accountGrant(id: string) {
  const c = context();
  const grant = sqlite
    .prepare(
      `SELECT g.*, c.status, c.expires_at FROM grants g JOIN connections c ON c.id=g.connection_id WHERE g.account_id=? AND g.agency_id=? AND g.client_id=? ORDER BY (c.status='active' AND (c.expires_at IS NULL OR c.expires_at>unixepoch())) DESC,c.updated_at DESC LIMIT 1`,
    )
    .get(id, c.agencyId, c.clientId) as any;
  if (!grant) throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Account not found');
  return grant;
}
export function postAccess(id: string) {
  const c = context();
  const owner = sqlite
    .prepare(
      'SELECT * FROM post_ownership WHERE post_id=? AND agency_id=? AND client_id=?',
    )
    .get(id, c.agencyId, c.clientId);
  if (!owner) throw new AppError(404, 'POST_NOT_FOUND', 'Post not found');
}
export function activeGrant(id: string) {
  const grant = accountGrant(id);
  if (
    grant.status !== 'active' ||
    (grant.expires_at && grant.expires_at <= Math.floor(Date.now() / 1000))
  )
    throw new AppError(
      409,
      'CONNECTION_REAUTH_REQUIRED',
      'La cuenta necesita volver a conectarse',
    );
  return grant;
}
