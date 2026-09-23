import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastify from 'fastify';
import { postsRoutes } from './posts.routes.js';
import * as postsService from './posts.service.js';
import crypto from 'node:crypto';

vi.mock('./posts.service.js');

describe('Posts Routes', () => {
  const app = fastify();
  app.register(postsRoutes, { prefix: '/posts' });

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should create a post', async () => {
    vi.mocked(postsService.createPost).mockResolvedValue({ id: '11111111-1111-1111-1111-111111111111' });

    const payload = {
      accountId: crypto.randomUUID(),
      caption: 'Test post',
      mediaUrls: ['https://example.com/img.jpg'],
      thumbOffset: 3000,
      coverUrl: 'https://example.com/cover.jpg',
      scheduledAt: Math.floor(Date.now() / 1000) + 3600, // 1 hour in future
    };

    const response = await app.inject({
      method: 'POST',
      url: '/posts',
      payload,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().id).toBe('11111111-1111-1111-1111-111111111111');
    expect(postsService.createPost).toHaveBeenCalledWith(payload);
  });

  it('should create a post with an explicit type', async () => {
    vi.mocked(postsService.createPost).mockResolvedValue({ id: '11111111-1111-1111-1111-111111111111' });

    const payload = {
      accountId: crypto.randomUUID(),
      caption: 'Historia',
      mediaUrls: ['https://example.com/img.jpg'],
      type: 'story' as const,
      scheduledAt: Math.floor(Date.now() / 1000) + 3600,
    };

    const response = await app.inject({
      method: 'POST',
      url: '/posts',
      payload,
    });

    expect(response.statusCode).toBe(201);
    expect(postsService.createPost).toHaveBeenCalledWith(payload);
  });

  it('should reject an invalid post type', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/posts',
      payload: {
        accountId: crypto.randomUUID(),
        mediaUrls: ['https://example.com/img.jpg'],
        type: 'carrete',
        scheduledAt: Math.floor(Date.now() / 1000) + 3600,
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('should list posts', async () => {
    const mockPost = {
      id: '11111111-1111-1111-1111-111111111111',
      account_id: '22222222-2222-2222-2222-222222222222',
      caption: 'Test',
      media_urls: ['https://example.com/img.jpg'],
      scheduled_at: 1700000000,
      status: 'pending' as const,
      container_id: null,
      error_message: null,
      created_at: 1600000000,
      updated_at: 1600000000,
    };
    
    vi.mocked(postsService.listPosts).mockResolvedValue([mockPost]);

    const response = await app.inject({
      method: 'GET',
      url: '/posts?status=pending&limit=10',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.posts).toHaveLength(1);
    expect(postsService.listPosts).toHaveBeenCalledWith({ status: 'pending', limit: 10, offset: 0 });
  });
});
