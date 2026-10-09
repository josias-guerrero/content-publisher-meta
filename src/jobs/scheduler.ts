import cron from 'node-cron';
import { sqlite } from '../db/index.js';
import {
  publishPost,
  recoverLeases,
  reconcileVideos,
} from '../meta/publisher.js';
import { deliverEvents } from './events.js';
let running = false;
export async function schedulerTick() {
  if (running) return;
  running = true;
  try {
    recoverLeases();
    await reconcileVideos();
    const posts = sqlite
      .prepare(
        "SELECT p.id FROM posts p JOIN post_ownership o ON o.post_id=p.id WHERE p.status='pending' AND p.scheduled_at<=? ORDER BY p.scheduled_at LIMIT 20",
      )
      .all(Math.floor(Date.now() / 1000)) as { id: string }[];
    for (const p of posts) {
      try {
        await publishPost(p.id);
      } catch {
        /* Each job is isolated; expired leases are recovered. */
      }
    }
    await deliverEvents();
  } finally {
    running = false;
  }
}
export function startScheduler() {
  return cron.schedule('* * * * *', schedulerTick);
}
export async function drainScheduler() {
  while (running) await new Promise((r) => setTimeout(r, 100));
}
