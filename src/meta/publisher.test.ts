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
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: any) => {
      fn();
      return 0 as any;
    });
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

  it('should publish a reels video when type=reels', async () => {
    const mockPost = {
      id: 'post-reels',
      account_id: 'acc-1',
      status: 'pending',
      media_urls: JSON.stringify(['https://example.com/video.mp4']),
      caption: 'Reel',
      container_id: null,
      type: 'reels',
      thumb_offset: 2000,
      cover_url: 'https://example.com/cover.jpg'
    };
    const mockAccount = {
      id: 'acc-1',
      external_id: 'ext-acc-1',
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
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(true) })
    });
    // @ts-ignore
    db.update.mockImplementation(updateMock);

    vi.mocked(graphApi.createMediaContainer).mockResolvedValue({ containerId: 'container-reels' });
    vi.mocked(graphApi.getContainerStatus).mockResolvedValue({ statusCode: 'FINISHED' });
    vi.mocked(graphApi.publishContainer).mockResolvedValue({ postId: 'meta-reels' });

    await publishPost('post-reels');

    expect(graphApi.createMediaContainer).toHaveBeenCalledWith('ext-acc-1', fakeToken, {
      imageUrl: undefined,
      videoUrl: 'https://example.com/video.mp4',
      caption: 'Reel',
      mediaType: 'REELS',
      thumbOffset: 2000,
      coverUrl: 'https://example.com/cover.jpg',
    });
    expect(graphApi.publishContainer).toHaveBeenCalledWith('ext-acc-1', fakeToken, 'container-reels');
  });

  it('should publish an instagram story when type=story (no caption in container)', async () => {
    const mockPost = {
      id: 'post-story',
      account_id: 'acc-1',
      status: 'pending',
      media_urls: JSON.stringify(['https://example.com/img.jpg']),
      caption: 'Historia',
      container_id: null,
      type: 'story',
    };
    const mockAccount = {
      id: 'acc-1',
      external_id: 'ext-acc-1',
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
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(true) })
    });
    // @ts-ignore
    db.update.mockImplementation(updateMock);

    vi.mocked(graphApi.createMediaContainer).mockResolvedValue({ containerId: 'container-story' });
    vi.mocked(graphApi.getContainerStatus).mockResolvedValue({ statusCode: 'FINISHED' });
    vi.mocked(graphApi.publishContainer).mockResolvedValue({ postId: 'meta-story' });

    await publishPost('post-story');

    expect(graphApi.createMediaContainer).toHaveBeenCalledWith('ext-acc-1', fakeToken, {
      imageUrl: 'https://example.com/img.jpg',
      videoUrl: undefined,
      caption: undefined,
      mediaType: 'STORIES',
    });
    expect(graphApi.publishContainer).toHaveBeenCalledWith('ext-acc-1', fakeToken, 'container-story');
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

  it('should reset post to pending when container is still IN_PROGRESS within 15 minutes', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const mockPost = {
      id: 'post-video-pending',
      account_id: 'acc-1',
      status: 'pending',
      scheduled_at: nowSec - 60, // 1 minuto atrás
      media_urls: JSON.stringify(['https://example.com/story.mp4']),
      caption: null,
      container_id: null,
      type: 'story',
    };
    const mockAccount = {
      id: 'acc-1',
      external_id: 'ext-acc-1',
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

    const setMock = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(true)
    });
    const updateMock = vi.fn().mockReturnValue({ set: setMock });
    // @ts-ignore
    db.update.mockImplementation(updateMock);

    vi.mocked(graphApi.createMediaContainer).mockResolvedValue({ containerId: 'container-slow' });
    // Siempre IN_PROGRESS
    vi.mocked(graphApi.getContainerStatus).mockResolvedValue({ statusCode: 'IN_PROGRESS' });

    await publishPost('post-video-pending');

    // Debe haber consultado el status 10 veces
    expect(graphApi.getContainerStatus).toHaveBeenCalledTimes(10);
    // NO debe haber publicado el contenedor
    expect(graphApi.publishContainer).not.toHaveBeenCalled();

    // Verificamos que el último update fue volver a 'pending' (y no 'failed')
    expect(setMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'pending',
      })
    );
  });

  it('should resume with existing container_id on next tick without re-creating container', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const mockPost = {
      id: 'post-video-resumed',
      account_id: 'acc-1',
      status: 'pending',
      scheduled_at: nowSec - 120, // 2 minutos atrás
      media_urls: JSON.stringify(['https://example.com/story.mp4']),
      caption: null,
      container_id: 'container-existing-123',
      type: 'story',
    };
    const mockAccount = {
      id: 'acc-1',
      external_id: 'ext-acc-1',
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

    const setMock = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(true)
    });
    const updateMock = vi.fn().mockReturnValue({ set: setMock });
    // @ts-ignore
    db.update.mockImplementation(updateMock);

    // En este tick Meta ya terminó el contenedor
    vi.mocked(graphApi.getContainerStatus).mockResolvedValue({ statusCode: 'FINISHED' });
    vi.mocked(graphApi.publishContainer).mockResolvedValue({ postId: 'meta-post-resumed' });

    await publishPost('post-video-resumed');

    // No debe crear contenedor nuevo
    expect(graphApi.createMediaContainer).not.toHaveBeenCalled();
    // Debe consultar con el container_id existente y publicar
    expect(graphApi.getContainerStatus).toHaveBeenCalledWith('container-existing-123', fakeToken);
    expect(graphApi.publishContainer).toHaveBeenCalledWith('ext-acc-1', fakeToken, 'container-existing-123');

    // Debe quedar en 'published'
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'published',
        error_message: null,
      })
    );
  });

  it('should mark post as failed when container is still IN_PROGRESS after 15 minutes from scheduled_at', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const mockPost = {
      id: 'post-video-expired',
      account_id: 'acc-1',
      status: 'pending',
      scheduled_at: nowSec - 16 * 60, // 16 minutos atrás (> 15 min)
      media_urls: JSON.stringify(['https://example.com/story.mp4']),
      caption: null,
      container_id: 'container-stuck',
      type: 'story',
    };
    const mockAccount = {
      id: 'acc-1',
      external_id: 'ext-acc-1',
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

    const setMock = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(true)
    });
    const updateMock = vi.fn().mockReturnValue({ set: setMock });
    // @ts-ignore
    db.update.mockImplementation(updateMock);

    vi.mocked(graphApi.getContainerStatus).mockResolvedValue({ statusCode: 'IN_PROGRESS' });

    await publishPost('post-video-expired');

    expect(graphApi.publishContainer).not.toHaveBeenCalled();
    // Debe quedar en failed
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error_message: expect.stringContaining('exceeded 15 minutes'),
      })
    );
  });

  it('should mark post as failed immediately when Meta returns ERROR or EXPIRED', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const mockPost = {
      id: 'post-video-err',
      account_id: 'acc-1',
      status: 'pending',
      scheduled_at: nowSec - 60,
      media_urls: JSON.stringify(['https://example.com/story.mp4']),
      caption: null,
      container_id: 'container-err',
      type: 'story',
    };
    const mockAccount = {
      id: 'acc-1',
      external_id: 'ext-acc-1',
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

    const setMock = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(true)
    });
    const updateMock = vi.fn().mockReturnValue({ set: setMock });
    // @ts-ignore
    db.update.mockImplementation(updateMock);

    vi.mocked(graphApi.getContainerStatus).mockResolvedValue({ statusCode: 'ERROR' });

    await publishPost('post-video-err');

    expect(graphApi.getContainerStatus).toHaveBeenCalledTimes(1);
    expect(graphApi.publishContainer).not.toHaveBeenCalled();
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error_message: 'Container status: ERROR',
      })
    );
  });
});
