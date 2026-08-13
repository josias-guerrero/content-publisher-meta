import { z } from 'zod';

export const createPostSchema = z.object({
  accountId: z.string().uuid(),
  caption: z.string().optional(),
  mediaUrls: z.array(z.string().url()).min(1),
  scheduledAt: z.number().int().positive(), // unix timestamp
});

export type CreatePostInput = z.infer<typeof createPostSchema>;
