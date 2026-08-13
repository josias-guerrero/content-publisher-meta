import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createPostSchema } from './posts.schema.js';
import * as postsService from './posts.service.js';

export async function postsRoutes(fastify: FastifyInstance) {
  fastify.post('/', async (request, reply) => {
    try {
      const data = createPostSchema.parse(request.body);
      const result = await postsService.createPost(data);
      return reply.status(201).send(result);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  fastify.get('/', async (request, reply) => {
    const querySchema = z.object({
      status: z.string().optional(),
      limit: z.coerce.number().default(20),
      offset: z.coerce.number().default(0),
    });
    
    const query = querySchema.parse(request.query);
    const posts = await postsService.listPosts(query);
    return { posts };
  });

  fastify.get('/:id', async (request, reply) => {
    const paramsSchema = z.object({ id: z.string().uuid() });
    const { id } = paramsSchema.parse(request.params);
    
    const post = await postsService.getPost(id);
    if (!post) {
      return reply.status(404).send({ error: 'Post not found' });
    }
    return post;
  });

  fastify.delete('/:id', async (request, reply) => {
    try {
      const paramsSchema = z.object({ id: z.string().uuid() });
      const { id } = paramsSchema.parse(request.params);
      
      await postsService.cancelPost(id);
      return { success: true };
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });
}
