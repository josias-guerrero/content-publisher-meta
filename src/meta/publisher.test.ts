import { describe, it, expect, vi, beforeEach } from 'vitest';
import { publishPost } from './publisher.js';
import * as graphApi from './graph-api.js';
import { db } from '../db/index.js';
import { encrypt } from '../lib/crypto.js';

// Mock dependencias
vi.mock('./graph-api.js');
vi.mock('../db/index.js', () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
  },
}));

describe('Publisher Service', () => {
  const fakeToken = 'fake-access-token';
  const encryptedToken = encrypt(fakeToken);
  
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should process the 3-step publishing flow successfully', async () => {
    // Setup mocks
    const mockPost = {
      id: 'post-1',
      account_id: 'acc-1',
      status: 'pending',
      media_urls: JSON.stringify(['https://example.com/img.jpg']),
      caption: 'Test caption',
      container_id: null,
    };
    const mockAccount = {
      id: 'acc-1',
      external_id: 'ext-acc-1',
      access_token: encryptedToken,
    };

    // Chain mocks para db.select().from().where().limit()
    const selectMock = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn()
            .mockResolvedValueOnce([mockPost]) // Para el post
            .mockResolvedValueOnce([mockAccount]), // Para la cuenta
        })
      })
    });
    
    // @ts-ignore
    db.select.mockImplementation(selectMock);
    
    const updateMock = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(true)
      })
    });
    // @ts-ignore
    db.update.mockImplementation(updateMock);

    // Mocks API Meta
    vi.mocked(graphApi.createMediaContainer).mockResolvedValue({ containerId: 'container-123' });
    // First polling says IN_PROGRESS, second says FINISHED
    vi.mocked(graphApi.getContainerStatus)
      .mockResolvedValueOnce({ statusCode: 'IN_PROGRESS' })
      .mockResolvedValueOnce({ statusCode: 'FINISHED' });
    vi.mocked(graphApi.publishContainer).mockResolvedValue({ postId: 'meta-post-123' });

    // Ejecutar
    await publishPost('post-1');

    // Asserts
    expect(graphApi.createMediaContainer).toHaveBeenCalledWith('ext-acc-1', fakeToken, {
      imageUrl: 'https://example.com/img.jpg',
      videoUrl: undefined,
      caption: 'Test caption',
    });

    // Should poll twice
    expect(graphApi.getContainerStatus).toHaveBeenCalledTimes(2);
    expect(graphApi.publishContainer).toHaveBeenCalledWith('ext-acc-1', fakeToken, 'container-123');

    // Check status updates in DB (publishing -> container_id -> published)
    expect(db.update).toHaveBeenCalledTimes(3);
  });

  it('should publish to a facebook page via createFacebookMediaPost', async () => {
    const mockPost = {
      id: 'post-fb',
      account_id: 'acc-fb',
      status: 'pending',
      media_urls: JSON.stringify(['https://example.com/img.jpg']),
      caption: 'FB caption',
      container_id: null,
    };
    const mockAccount = {
      id: 'acc-fb',
      platform: 'facebook',
      external_id: 'page-123',
      access_token: encryptedToken,
    };

    const selectMock = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn()
            .mockResolvedValueOnce([mockPost])
            .mockResolvedValueOnce([mockAccount]),
        })
      })
    });
    // @ts-ignore
    db.select.mockImplementation(selectMock);

    const updateMock = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(true)
      })
    });
    // @ts-ignore
    db.update.mockImplementation(updateMock);

    vi.mocked(graphApi.createFacebookMediaPost).mockResolvedValue({ postId: 'fb-post-123' });

    await publishPost('post-fb');

    expect(graphApi.createFacebookMediaPost).toHaveBeenCalledWith('page-123', fakeToken, {
      imageUrl: 'https://example.com/img.jpg',
      videoUrl: undefined,
      caption: 'FB caption',
    });
    expect(db.update).toHaveBeenCalledTimes(1);
  });
});
