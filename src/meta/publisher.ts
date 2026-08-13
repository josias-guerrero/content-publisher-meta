import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { posts, accounts } from '../db/schema.js';
import { decrypt } from '../lib/crypto.js';
import * as graphApi from './graph-api.js';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function publishPost(postId: string): Promise<void> {
  const postResult = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
  if (!postResult.length) return;
  const post = postResult[0];

  if (post.status !== 'pending' && post.status !== 'publishing') {
    return; // Ya se publicó o falló irremediablemente
  }

  const accountResult = await db.select().from(accounts).where(eq(accounts.id, post.account_id)).limit(1);
  if (!accountResult.length) {
    await markFailed(postId, 'Account not found');
    return;
  }
  const account = accountResult[0];
  const accessToken = decrypt(account.access_token);
  const mediaUrls: string[] = JSON.parse(post.media_urls);
  const isVideo = mediaUrls[0].endsWith('.mp4');

  try {
    let containerId = post.container_id;

    // 1. Crear contenedor si no existe
    if (!containerId) {
      await db.update(posts).set({ status: 'publishing', updated_at: now() }).where(eq(posts.id, postId));
      
      const res = await graphApi.createMediaContainer(account.external_id, accessToken, {
        imageUrl: isVideo ? undefined : mediaUrls[0],
        videoUrl: isVideo ? mediaUrls[0] : undefined,
        caption: post.caption || undefined,
      });
      containerId = res.containerId;
      await db.update(posts).set({ container_id: containerId, updated_at: now() }).where(eq(posts.id, postId));
    }

    // 2. Polling del estado
    let isReady = false;
    for (let i = 0; i < 10; i++) {
      const statusRes = await graphApi.getContainerStatus(containerId, accessToken);
      if (statusRes.statusCode === 'FINISHED') {
        isReady = true;
        break;
      }
      if (statusRes.statusCode === 'ERROR' || statusRes.statusCode === 'EXPIRED') {
        throw new Error(`Container status: ${statusRes.statusCode}`);
      }
      await sleep(3000); // Wait 3s
    }

    if (!isReady) {
      throw new Error('Timeout waiting for container to be ready (FINISHED)');
    }

    // 3. Publicar
    const publishRes = await graphApi.publishContainer(account.external_id, accessToken, containerId);
    
    await db.update(posts).set({
      status: 'published',
      updated_at: now(),
      error_message: null,
    }).where(eq(posts.id, postId));
    
    console.log(`[Publisher] Post ${postId} published successfully as Meta Post ${publishRes.postId}`);

  } catch (error: any) {
    console.error(`[Publisher] Error publishing post ${postId}:`, error);
    await markFailed(postId, error.message || 'Unknown error');
  }
}

function now() {
  return Math.floor(Date.now() / 1000);
}

async function markFailed(postId: string, errorMsg: string) {
  await db.update(posts).set({
    status: 'failed',
    error_message: errorMsg,
    updated_at: now(),
  }).where(eq(posts.id, postId));
}
