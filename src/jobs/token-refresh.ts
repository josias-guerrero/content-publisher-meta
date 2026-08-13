import cron from 'node-cron';
import { lte, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { accounts } from '../db/schema.js';
import { refreshLongLivedToken } from '../meta/graph-api.js';
import { encrypt, decrypt } from '../lib/crypto.js';

export function startTokenRefreshJob() {
  console.log('[Token Refresh] Started - will check for expiring tokens daily at 09:00 AM');
  
  // Run every day at 09:00 AM
  cron.schedule('0 9 * * *', async () => {
    try {
      const now = Math.floor(Date.now() / 1000);
      const SEVEN_DAYS_IN_SECONDS = 7 * 24 * 60 * 60;
      const threshold = now + SEVEN_DAYS_IN_SECONDS;

      const expiringAccounts = await db.select().from(accounts).where(
        lte(accounts.token_expires_at, threshold)
      );

      if (expiringAccounts.length === 0) {
        console.log('[Token Refresh] No tokens expiring within 7 days.');
        return;
      }

      console.log(`[Token Refresh] Found ${expiringAccounts.length} accounts with expiring tokens. Processing...`);

      for (const account of expiringAccounts) {
        try {
          const currentToken = decrypt(account.access_token);
          const { accessToken: newToken, expiresIn } = await refreshLongLivedToken(currentToken);
          
          const encryptedNewToken = encrypt(newToken);
          const newExpiresAt = now + expiresIn;

          await db.update(accounts)
            .set({
              access_token: encryptedNewToken,
              token_expires_at: newExpiresAt,
            })
            .where(eq(accounts.id, account.id));
            
          console.log(`[Token Refresh] Successfully refreshed token for account ${account.id} (expires in ${Math.floor(expiresIn/86400)} days)`);
        } catch (err: any) {
          console.error(`[Token Refresh] Failed to refresh token for account ${account.id}:`, err.message);
          // Note: we don't mark the account as invalid immediately, we let it try again tomorrow
          // until it actually expires. Future enhancement: alert the user.
        }
      }
    } catch (err) {
      console.error('[Token Refresh] Error in job execution:', err);
    }
  });
}
