import { config } from '../config.js';

const API_BASE_URL = `https://graph.facebook.com/${config.META_GRAPH_API_VERSION}`;

export class MetaApiError extends Error {
  constructor(public code: number, public type: string, message: string) {
    super(`[Meta API Error ${code} - ${type}] ${message}`);
    this.name = 'MetaApiError';
  }
}

async function handleResponse(res: Response) {
  const data = await res.json();
  if (!res.ok) {
    const error = data.error || {};
    throw new MetaApiError(
      error.code || res.status,
      error.type || 'Unknown',
      error.message || 'Unknown Meta API Error'
    );
  }
  return data;
}

export async function createMediaContainer(
  igUserId: string,
  accessToken: string,
  params: { imageUrl?: string; videoUrl?: string; caption?: string }
): Promise<{ containerId: string }> {
  const urlParams = new URLSearchParams();
  urlParams.append('access_token', accessToken);
  
  if (params.imageUrl) urlParams.append('image_url', params.imageUrl);
  if (params.videoUrl) {
    urlParams.append('video_url', params.videoUrl);
    urlParams.append('media_type', 'REELS');
  }
  if (params.caption) urlParams.append('caption', params.caption);

  const res = await fetch(`${API_BASE_URL}/${igUserId}/media`, {
    method: 'POST',
    body: urlParams,
  });

  const data = await handleResponse(res);
  return { containerId: data.id };
}

export async function getContainerStatus(
  containerId: string,
  accessToken: string
): Promise<{ statusCode: 'IN_PROGRESS' | 'FINISHED' | 'ERROR' | 'EXPIRED' }> {
  const res = await fetch(
    `${API_BASE_URL}/${containerId}?fields=status_code&access_token=${accessToken}`
  );
  const data = await handleResponse(res);
  return { statusCode: data.status_code };
}

export async function publishContainer(
  igUserId: string,
  accessToken: string,
  containerId: string
): Promise<{ postId: string }> {
  const urlParams = new URLSearchParams();
  urlParams.append('creation_id', containerId);
  urlParams.append('access_token', accessToken);

  const res = await fetch(`${API_BASE_URL}/${igUserId}/media_publish`, {
    method: 'POST',
    body: urlParams,
  });

  const data = await handleResponse(res);
  return { postId: data.id };
}

export async function refreshLongLivedToken(
  currentToken: string
): Promise<{ accessToken: string; expiresIn: number }> {
  const res = await fetch(
    `${API_BASE_URL}/oauth/access_token?grant_type=fb_exchange_token&client_id=${config.META_APP_ID}&client_secret=${config.META_APP_SECRET}&fb_exchange_token=${currentToken}`
  );
  const data = await handleResponse(res);
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
  };
}
