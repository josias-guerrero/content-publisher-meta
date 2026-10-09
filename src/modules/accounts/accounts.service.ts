import { sqlite } from '../../db/index.js';
import { context } from '../../security/context.js';
import { activeGrant, accountGrant } from '../../security/access.js';
import { decrypt } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import type { CreateAccountInput } from './accounts.schema.js';
/** Manual credential ingestion is intentionally disabled; use OAuth asset selection. */
export async function createAccount(_data: CreateAccountInput) {
  throw new AppError(
    409,
    'MANUAL_TOKEN_DISABLED',
    'Use verified OAuth asset selection',
  );
}
export async function listAccounts() {
  const c = context();
  return sqlite
    .prepare(
      'SELECT a.id,a.platform,a.external_id,a.name,a.created_at FROM accounts a JOIN grants g ON g.account_id=a.id WHERE g.agency_id=? AND g.client_id=? ORDER BY a.created_at DESC LIMIT 100',
    )
    .all(c.agencyId, c.clientId);
}
export async function getAccountWithToken(id: string) {
  const grant = activeGrant(id),
    a = sqlite
      .prepare('SELECT id,platform,external_id,name FROM accounts WHERE id=?')
      .get(id) as any;
  return { ...a, access_token: decrypt(grant.token) };
}
export async function deleteAccount(id: string) {
  accountGrant(id);
  throw new AppError(
    409,
    'USE_DISCONNECT',
    'Account/history deletion is a separate coordinated operation',
  );
}
