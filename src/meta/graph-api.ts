import { config } from '../config.js';

const INSTAGRAM_API_BASE_URL = 'https://graph.instagram.com';
const INSTAGRAM_OAUTH_BASE_URL = 'https://api.instagram.com';
const FACEBOOK_GRAPH_API_BASE_URL = `https://graph.facebook.com/${config.META_GRAPH_API_VERSION}`;

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

function requireConfig(key: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${key} is not configured`);
  }
  return value;
}

// ---------- Instagram (Instagram API with Instagram Login) ----------

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

  const res = await fetch(`${INSTAGRAM_API_BASE_URL}/${igUserId}/media`, {
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
    `${INSTAGRAM_API_BASE_URL}/${containerId}?fields=status_code&access_token=${accessToken}`
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

  const res = await fetch(`${INSTAGRAM_API_BASE_URL}/${igUserId}/media_publish`, {
    method: 'POST',
    body: urlParams,
  });

  const data = await handleResponse(res);
  return { postId: data.id };
}

export async function refreshInstagramToken(
  currentToken: string
): Promise<{ accessToken: string; expiresIn: number }> {
  const urlParams = new URLSearchParams();
  urlParams.append('grant_type', 'ig_refresh_token');
  urlParams.append('access_token', currentToken);

  const res = await fetch(`${INSTAGRAM_API_BASE_URL}/refresh_access_token?${urlParams}`);
  const data = await handleResponse(res);
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
  };
}

export async function exchangeInstagramCode(
  code: string,
  redirectUri: string
): Promise<{ accessToken: string; userId: string }> {
  const urlParams = new URLSearchParams();
  urlParams.append('client_id', requireConfig('META_INSTAGRAM_APP_ID', config.META_INSTAGRAM_APP_ID));
  urlParams.append('client_secret', requireConfig('META_INSTAGRAM_APP_SECRET', config.META_INSTAGRAM_APP_SECRET));
  urlParams.append('grant_type', 'authorization_code');
  urlParams.append('redirect_uri', redirectUri);
  urlParams.append('code', code);

  const res = await fetch(`${INSTAGRAM_OAUTH_BASE_URL}/oauth/access_token`, {
    method: 'POST',
    body: urlParams,
  });
  const data = await handleResponse(res);
  return { accessToken: data.access_token, userId: data.user_id };
}

export async function exchangeInstagramToken(
  shortToken: string
): Promise<{ accessToken: string; expiresIn: number }> {
  const urlParams = new URLSearchParams();
  urlParams.append('grant_type', 'ig_exchange_token');
  urlParams.append('client_secret', requireConfig('META_INSTAGRAM_APP_SECRET', config.META_INSTAGRAM_APP_SECRET));
  urlParams.append('access_token', shortToken);

  const res = await fetch(`${INSTAGRAM_API_BASE_URL}/access_token?${urlParams}`);
  const data = await handleResponse(res);
  return { accessToken: data.access_token, expiresIn: data.expires_in };
}

export async function getInstagramUser(
  accessToken: string
): Promise<{ userId: string; username: string; accountType?: string }> {
  const res = await fetch(
    `${INSTAGRAM_API_BASE_URL}/me?fields=user_id,username,account_type&access_token=${accessToken}`
  );
  const data = await handleResponse(res);
  return { userId: data.user_id, username: data.username, accountType: data.account_type };
}

// ---------- Facebook (Facebook Login for Business) ----------

export async function refreshFacebookToken(
  userToken: string
): Promise<{ accessToken: string; expiresIn: number }> {
  const urlParams = new URLSearchParams();
  urlParams.append('grant_type', 'fb_exchange_token');
  urlParams.append('client_id', requireConfig('META_FACEBOOK_APP_ID', config.META_FACEBOOK_APP_ID));
  urlParams.append('client_secret', requireConfig('META_FACEBOOK_APP_SECRET', config.META_FACEBOOK_APP_SECRET));
  urlParams.append('fb_exchange_token', userToken);

  const res = await fetch(`${FACEBOOK_GRAPH_API_BASE_URL}/oauth/access_token?${urlParams}`);
  const data = await handleResponse(res);
  return { accessToken: data.access_token, expiresIn: data.expires_in };
}

export async function exchangeFacebookCode(
  code: string,
  redirectUri: string
): Promise<{ accessToken: string; expiresIn: number }> {
  const urlParams = new URLSearchParams();
  urlParams.append('client_id', requireConfig('META_FACEBOOK_APP_ID', config.META_FACEBOOK_APP_ID));
  urlParams.append('client_secret', requireConfig('META_FACEBOOK_APP_SECRET', config.META_FACEBOOK_APP_SECRET));
  urlParams.append('redirect_uri', redirectUri);
  urlParams.append('code', code);

  const res = await fetch(`${FACEBOOK_GRAPH_API_BASE_URL}/oauth/access_token?${urlParams}`);
  const data = await handleResponse(res);
  return { accessToken: data.access_token, expiresIn: data.expires_in };
}

export async function getFacebookPages(
  userToken: string
): Promise<{ id: string; name: string }[]> {
  const res = await fetch(
    `${FACEBOOK_GRAPH_API_BASE_URL}/me/accounts?fields=id,name&access_token=${userToken}`
  );
  const data = await handleResponse(res);
  return (data.data || []).map((page: { id: string; name: string }) => ({
    id: page.id,
    name: page.name,
  }));
}

export async function createFacebookMediaPost(
  pageId: string,
  userToken: string,
  params: { imageUrl?: string; videoUrl?: string; caption?: string }
): Promise<{ postId: string }> {
  const pageTokenRes = await fetch(
    `${FACEBOOK_GRAPH_API_BASE_URL}/${pageId}?fields=access_token&access_token=${userToken}`
  );
  const pageTokenData = await handleResponse(pageTokenRes);
  const pageToken: string = pageTokenData.access_token;

  const urlParams = new URLSearchParams();
  urlParams.append('access_token', pageToken);

  if (params.imageUrl) {
    urlParams.append('url', params.imageUrl);
    if (params.caption) urlParams.append('caption', params.caption);
    const res = await fetch(`${FACEBOOK_GRAPH_API_BASE_URL}/${pageId}/photos`, {
      method: 'POST',
      body: urlParams,
    });
    const data = await handleResponse(res);
    return { postId: data.id };
  }

  if (params.videoUrl) {
    urlParams.append('file_url', params.videoUrl);
    if (params.caption) urlParams.append('description', params.caption);
    const res = await fetch(`${FACEBOOK_GRAPH_API_BASE_URL}/${pageId}/videos`, {
      method: 'POST',
      body: urlParams,
    });
    const data = await handleResponse(res);
    return { postId: data.id };
  }

  throw new Error('createFacebookMediaPost requires imageUrl or videoUrl');
}
