import { z } from 'zod';

export const createPostSchema = z.object({
  accountId: z.string().uuid(),
  caption: z.string().optional(),
  mediaUrls: z.array(z.string().url()).min(1),
  type: z.enum(['post', 'reels', 'story']).optional(), // feed / reel / historia (IG)
  thumbOffset: z.number().int().nonnegative().optional(), // milisegundos
  coverUrl: z.string().url().optional(), // URL pública
  scheduledAt: z.number().int().positive(), // unix timestamp
});

export const postTypeSchema = z.enum(['post', 'reels', 'story']);

export type CreatePostInput = z.infer<typeof createPostSchema>;
export type PostType = z.infer<typeof postTypeSchema>;
