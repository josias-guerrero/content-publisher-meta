import cron from 'node-cron';
import { sqlite } from '../db/index.js';
import { refreshInstagramToken, MetaApiError } from '../meta/graph-api.js';
import { encrypt, decrypt } from '../lib/crypto.js';
import { stopConnection } from '../modules/connections/connections.routes.js';
export async function refreshTokens() {
  const now = Math.floor(Date.now() / 1000);
  const rows = sqlite
    .prepare(
      "SELECT * FROM connections WHERE status='active' AND expires_at IS NOT NULL AND expires_at<=?",
    )
    .all(now + 7 * 86400) as any[];
  for (const c of rows) {
    if (c.expires_at <= now) {
      stopConnection(c.id, 'reauth_required');
      continue;
    }
    if (c.provider !== 'instagram') continue; // User/Page tokens do not have an indefinite refresh guarantee.
    try {
      const result = await refreshInstagramToken(decrypt(c.token));
      const encrypted = encrypt(result.accessToken);
      sqlite.transaction(() => {
        const changed = sqlite
          .prepare(
            "UPDATE connections SET token=?,expires_at=?,updated_at=? WHERE id=? AND status='active' AND token=?",
          )
          .run(encrypted, now + result.expiresIn, now, c.id, c.token);
        if (changed.changes)
          sqlite
            .prepare('UPDATE grants SET token=? WHERE connection_id=?')
            .run(encrypted, c.id);
      })();
    } catch (e) {
      if (
        e instanceof MetaApiError &&
        (e.type === 'AUTH' || e.type === 'PERMISSION')
      )
        stopConnection(c.id, 'reauth_required');
    }
  }
}
let refreshInFlight: Promise<void> | undefined;
export function startTokenRefreshJob() {
  return cron.schedule('0 9 * * *', () => {
    if (!refreshInFlight)
      refreshInFlight = refreshTokens().finally(() => {
        refreshInFlight = undefined;
      });
    return refreshInFlight;
  });
}
export async function drainTokenRefresh() {
  await refreshInFlight;
}
