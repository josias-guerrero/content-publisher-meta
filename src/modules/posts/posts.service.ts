import { randomUUID } from 'node:crypto';
import { eq, desc, and } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { posts } from '../../db/schema.js';
import type { CreatePostInput } from './posts.schema.js';

export async function createPost(data: CreatePostInput) {
  const now = Math.floor(Date.now() / 1000);
  
  if (data.scheduledAt <= now) {
    throw new Error('scheduledAt must be in the future');
  }

  const id = randomUUID();

  await db.insert(posts).values({
    id,
    account_id: data.accountId,
    caption: data.caption,
    media_urls: JSON.stringify(data.mediaUrls),
    type: data.type ?? null,
    scheduled_at: data.scheduledAt,
    status: 'pending',
    created_at: now,
    updated_at: now,
  });

  return { id };
}

export async function listPosts({ status, limit = 20, offset = 0 }: { status?: string, limit?: number, offset?: number }) {
  let query = db.select().from(posts);
  
  if (status) {
    // @ts-expect-error type cast
    query = query.where(eq(posts.status, status));
  }
  
  const result = await query
    .orderBy(desc(posts.created_at))
    .limit(limit)
    .offset(offset);

  return result.map(post => ({
    ...post,
    media_urls: JSON.parse(post.media_urls),
  }));
}

export async function getPost(id: string) {
  const result = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
  
  if (!result.length) {
    return null;
  }
  
  const post = result[0];
  return {
    ...post,
    media_urls: JSON.parse(post.media_urls),
  };
}

export async function cancelPost(id: string) {
  const post = await getPost(id);
  
  if (!post) {
    throw new Error('Post not found');
  }
  
  if (post.status !== 'pending') {
    throw new Error('Only pending posts can be cancelled');
  }

  const now = Math.floor(Date.now() / 1000);

  await db.update(posts)
    .set({
      status: 'failed',
      error_message: 'cancelled by user',
      updated_at: now,
    })
    .where(eq(posts.id, id));
}
