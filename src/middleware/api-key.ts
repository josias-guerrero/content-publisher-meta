import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { config } from '../config.js';
import { contexts, equal, verifyContext } from '../security/context.js';
const publicPaths = new Set([
  '/health',
  '/auth/instagram/login',
  '/auth/facebook/login',
  '/auth/instagram/callback',
  '/auth/facebook/callback',
  '/meta/instagram/deauthorize',
  '/meta/facebook/deauthorize',
  '/meta/instagram/data-deletion',
  '/meta/facebook/data-deletion',
]);
const apiKeyMiddleware: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', (request, reply, done) => {
    const path = request.url.split('?')[0];
    if (
      publicPaths.has(path) ||
      /^\/data-deletion\/status\/[a-zA-Z0-9_-]{43}$/.test(path)
    )
      return done();
    const key = request.headers['x-api-key'];
    if (
      !config.API_KEY ||
      typeof key !== 'string' ||
      !equal(key, config.API_KEY)
    ) {
      reply
        .code(401)
        .send({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Service credential required',
            retryable: false,
            requestId: request.id,
          },
        });
      return;
    }
    try {
      const raw = request.headers['x-publisher-context'];
      if (typeof raw !== 'string' || !config.CONTEXT_SIGNING_SECRET)
        throw new Error('Missing context');
      const ctx = verifyContext(
        raw,
        request.method,
        request.url,
        config.CONTEXT_SIGNING_SECRET,
      );
      contexts.run(ctx, done);
    } catch {
      reply
        .code(401)
        .send({
          error: {
            code: 'INVALID_CONTEXT',
            message: 'Verified context required',
            retryable: false,
            requestId: request.id,
          },
        });
    }
  });
};
export default fp(apiKeyMiddleware);
