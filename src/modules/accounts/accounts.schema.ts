import { z } from 'zod';

export const createAccountSchema = z.object({
  platform: z.enum(['instagram', 'facebook']),
  externalId: z.string().min(1),
  accessToken: z.string().min(1),
  tokenExpiresAt: z.number().int().positive(), // unix timestamp
});

export type CreateAccountInput = z.infer<typeof createAccountSchema>;
