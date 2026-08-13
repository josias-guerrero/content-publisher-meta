import { randomUUID } from 'node:crypto';
import { db } from '../../db/index.js';
import { accounts } from '../../db/schema.js';
import { encrypt } from '../../lib/crypto.js';
import type { CreateAccountInput } from './accounts.schema.js';

export async function createAccount(data: CreateAccountInput) {
  const id = randomUUID();
  const encryptedToken = encrypt(data.accessToken);

  await db.insert(accounts).values({
    id,
    platform: data.platform,
    external_id: data.externalId,
    access_token: encryptedToken,
    token_expires_at: data.tokenExpiresAt,
    created_at: Math.floor(Date.now() / 1000),
  });

  return { id };
}

export async function listAccounts() {
  const result = await db
    .select({
      id: accounts.id,
      platform: accounts.platform,
      external_id: accounts.external_id,
      token_expires_at: accounts.token_expires_at,
      created_at: accounts.created_at,
    })
    .from(accounts);
  
  return result;
}
