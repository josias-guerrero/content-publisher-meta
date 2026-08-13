import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { config } from '../config.js';

const apiKeyMiddleware: FastifyPluginAsync = async (fastify) => {
  if (!config.API_KEY) {
    fastify.log.warn('API_KEY is not defined. Running in insecure mode.');
    return;
  }

  fastify.addHook('onRequest', async (request, reply) => {
    // Permitir /health sin api key (opcional)
    if (request.url === '/health') return;

    const apiKey = request.headers['x-api-key'];
    if (apiKey !== config.API_KEY) {
      reply.status(401).send({ error: 'Unauthorized: Invalid or missing X-API-Key' });
    }
  });
};

export default fp(apiKeyMiddleware);
