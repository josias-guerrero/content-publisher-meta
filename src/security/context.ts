import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
export const contextSchema = z.object({
  agencyId: z.string().min(1).max(128),
  clientId: z.string().min(1).max(128),
  userId: z.string().min(1).max(128),
  sessionId: z.string().min(16).max(256),
  expiresAt: z.number().int(),
  role: z.enum(['user', 'admin']).default('user'),
});
export type Context = z.infer<typeof contextSchema>;
export const contexts = new AsyncLocalStorage<Context>();
export function context(): Context {
  const c = contexts.getStore();
  if (!c)
    throw new AppError(
      401,
      'CONTEXT_REQUIRED',
      'Verified service context required',
    );
  return c;
}
export function equal(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function signature(value: string, secret: string) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}
export function verifyContext(
  value: string,
  method: string,
  url: string,
  secret: string,
): Context {
  const [payload, sig, extra] = value.split('.');
  if (
    !payload ||
    !sig ||
    extra ||
    !equal(signature(`${method}\n${url}\n${payload}`, secret), sig)
  )
    throw new AppError(401, 'INVALID_CONTEXT', 'Invalid context signature');
  let c: Context;
  try {
    c = contextSchema.parse(
      JSON.parse(Buffer.from(payload, 'base64url').toString()),
    );
  } catch {
    throw new AppError(401, 'INVALID_CONTEXT', 'Invalid context');
  }
  const now = Math.floor(Date.now() / 1000);
  if (c.expiresAt <= now || c.expiresAt > now + 300)
    throw new AppError(401, 'CONTEXT_EXPIRED', 'Context expired');
  return c;
}
