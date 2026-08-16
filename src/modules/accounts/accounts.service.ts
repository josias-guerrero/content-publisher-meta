import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { accounts } from '../../db/schema.js';
import { encrypt, decrypt } from '../../lib/crypto.js';
import * as graphApi from '../../meta/graph-api.js';
import type { CreateAccountInput } from './accounts.schema.js';

async function resolveAccountName(
  platform: CreateAccountInput['platform'],
  externalId: string,
  accessToken: string
): Promise<string> {
  if (platform === 'instagram') {
    const user = await graphApi.getInstagramUser(accessToken);
    return user.username;
  }

  const pages = await graphApi.getFacebookPages(accessToken);
  return pages.find((p) => p.id === externalId)?.name ?? externalId;
}

export async function createAccount(data: CreateAccountInput) {
  const id = randomUUID();
  const encryptedToken = encrypt(data.accessToken);
  const name = data.name ?? (await resolveAccountName(data.platform, data.externalId, data.accessToken));

  await db.insert(accounts).values({
    id,
    platform: data.platform,
    external_id: data.externalId,
    name,
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
      name: accounts.name,
      token_expires_at: accounts.token_expires_at,
      created_at: accounts.created_at,
    })
    .from(accounts);

  return result.map((account) => ({ ...account, name: account.name ?? account.external_id }));
}

export async function getAccountWithToken(id: string) {
  const result = await db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
  if (!result.length) return null;
  return { ...result[0], access_token: decrypt(result[0].access_token) };
}

export async function deleteAccount(id: string) {
  return await db.delete(accounts).where(eq(accounts.id, id));
}
