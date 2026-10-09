import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createPostSchema } from './posts.schema.js';
import * as service from './posts.service.js';
const id = (params: unknown) =>
  z.object({ id: z.string().uuid() }).parse(params).id;
export async function postsRoutes(app: FastifyInstance) {
  app.post('/', async (req, reply) =>
    reply
      .code(201)
      .send(
        await service.createPost(
          createPostSchema.parse(req.body),
          req.headers['idempotency-key'] as string,
        ),
      ),
  );
  app.get('/', async (req) => ({
    posts: await service.listPosts(
      z
        .object({
          status: z
            .enum([
              'pending',
              'publishing',
              'published',
              'failed',
              'cancelled',
              'reconciling',
            ])
            .optional(),
          limit: z.coerce.number().int().min(1).max(100).default(20),
          offset: z.coerce.number().int().min(0).default(0),
        })
        .parse(req.query),
    ),
  }));
  app.get('/:id', async (req) => service.getPost(id(req.params)));
  app.delete('/:id', async (req) => {
    await service.cancelPost(id(req.params));
    return { success: true };
  });
  app.post('/:id/retry', async (req) => service.retryPost(id(req.params)));
}
