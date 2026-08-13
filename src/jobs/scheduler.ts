import cron from 'node-cron';
import { lte, eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { posts } from '../db/schema.js';
import { publishPost } from '../meta/publisher.js';

let isRunning = false;

export function startScheduler() {
  console.log('[Scheduler] Started - will check for pending posts every minute');
  
  cron.schedule('* * * * *', async () => {
    if (isRunning) {
      console.log('[Scheduler] Previous tick is still running, skipping...');
      return;
    }

    isRunning = true;
    try {
      const now = Math.floor(Date.now() / 1000);
      
      const pendingPosts = await db.select().from(posts).where(
        and(
          eq(posts.status, 'pending'),
          lte(posts.scheduled_at, now)
        )
      );

      if (pendingPosts.length > 0) {
        console.log(`[Scheduler] Found ${pendingPosts.length} posts to publish`);
        
        // Execute sequentially to respect Meta rate limits and prevent DB locking issues
        for (const post of pendingPosts) {
          console.log(`[Scheduler] Processing post ${post.id}`);
          await publishPost(post.id);
        }
      }
    } catch (err) {
      console.error('[Scheduler] Error in tick:', err);
    } finally {
      isRunning = false;
    }
  });
}
