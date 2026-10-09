import { config } from '../config.js';

const INSTAGRAM_TOKEN_BASE_URL = 'https://graph.instagram.com';
const INSTAGRAM_API_BASE_URL = `${INSTAGRAM_TOKEN_BASE_URL}/${config.META_GRAPH_API_VERSION}`;
const INSTAGRAM_OAUTH_BASE_URL = 'https://api.instagram.com';
const FACEBOOK_GRAPH_API_BASE_URL = `https://graph.facebook.com/${config.META_GRAPH_API_VERSION}`;

export class MetaApiError extends Error {
  constructor(
    public code: number,
    public type: string,
    message: string,
    public status = 502,
    public subcode?: number,
    public traceId?: string,
    public retryable = false,
  ) {
    super(message);
    this.name = 'MetaApiError';
  }
}
async function metaFetch(url: string, init: RequestInit = {}) {
  try {
    return await fetch(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(config.META_HTTP_TIMEOUT_MS),
    });
  } catch {
    throw new MetaApiError(
      0,
      'NETWORK',
      'Meta request timed out or could not be completed',
      503,
      undefined,
      undefined,
      true,
    );
  }
}
async function handleResponse(res: Response): Promise<any> {
  let data: any;
  try {
    data = await res.json();
  } catch {
    throw new MetaApiError(
      res.status,
      'INVALID_RESPONSE',
      'Meta returned an unreadable response',
      502,
      undefined,
      undefined,
      true,
    );
  }
  if (!res.ok || data.error) {
    const e = data.error || {},
      code = e.code || res.status;
    const type =
      code === 190
        ? 'AUTH'
        : code === 10 || code === 200
          ? 'PERMISSION'
          : res.status === 429 || [4, 17, 32, 613].includes(code)
            ? 'RATE'
            : e.is_transient || res.status >= 500
              ? 'TRANSIENT'
              : 'CONTENT';
    throw new MetaApiError(
      code,
      type,
      `Meta ${type.toLowerCase()} error`,
      res.status,
      e.error_subcode,
      e.fbtrace_id,
      ['RATE', 'TRANSIENT'].includes(type),
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
  params: {
    imageUrl?: string;
    videoUrl?: string;
    caption?: string;
    mediaType?: 'REELS' | 'STORIES' | 'VIDEO' | 'CAROUSEL';
    children?: string[];
    isCarouselItem?: boolean;
    thumbOffset?: number;
    coverUrl?: string;
  },
): Promise<{ containerId: string }> {
  const urlParams = new URLSearchParams();
  urlParams.append('access_token', accessToken);

  if (params.children) urlParams.append('children', params.children.join(','));
  if (params.isCarouselItem) urlParams.append('is_carousel_item', 'true');
  if (params.imageUrl) urlParams.append('image_url', params.imageUrl);
  if (params.videoUrl) urlParams.append('video_url', params.videoUrl);
  if (params.mediaType) urlParams.append('media_type', params.mediaType);
  if (params.caption) urlParams.append('caption', params.caption);

  if (params.mediaType === 'REELS') {
    if (params.thumbOffset !== undefined)
      urlParams.append('thumb_offset', params.thumbOffset.toString());
    if (params.coverUrl) urlParams.append('cover_url', params.coverUrl);
  }

  const res = await metaFetch(`${INSTAGRAM_API_BASE_URL}/${igUserId}/media`, {
    method: 'POST',
    body: urlParams,
  });

  const data = await handleResponse(res);
  return { containerId: data.id };
}

export async function getContainerStatus(
  containerId: string,
  accessToken: string,
): Promise<{ statusCode: 'IN_PROGRESS' | 'FINISHED' | 'ERROR' | 'EXPIRED' }> {
  const res = await metaFetch(
    `${INSTAGRAM_API_BASE_URL}/${containerId}?fields=status_code&access_token=${accessToken}`,
  );
  const data = await handleResponse(res);
  return { statusCode: data.status_code };
}

export async function publishContainer(
  igUserId: string,
  accessToken: string,
  containerId: string,
): Promise<{ postId: string }> {
  const urlParams = new URLSearchParams();
  urlParams.append('creation_id', containerId);
  urlParams.append('access_token', accessToken);

  const res = await metaFetch(
    `${INSTAGRAM_API_BASE_URL}/${igUserId}/media_publish`,
    {
      method: 'POST',
      body: urlParams,
    },
  );

  const data = await handleResponse(res);
  return { postId: data.id };
}

export async function refreshInstagramToken(
  currentToken: string,
): Promise<{ accessToken: string; expiresIn: number }> {
  const urlParams = new URLSearchParams();
  urlParams.append('grant_type', 'ig_refresh_token');
  urlParams.append('access_token', currentToken);

  const res = await metaFetch(
    `${INSTAGRAM_TOKEN_BASE_URL}/refresh_access_token?${urlParams}`,
  );
  const data = await handleResponse(res);
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
  };
}

export async function exchangeInstagramCode(
  code: string,
  redirectUri: string,
): Promise<{ accessToken: string; userId: string }> {
  const urlParams = new URLSearchParams();
  urlParams.append(
    'client_id',
    requireConfig('META_INSTAGRAM_APP_ID', config.META_INSTAGRAM_APP_ID),
  );
  urlParams.append(
    'client_secret',
    requireConfig(
      'META_INSTAGRAM_APP_SECRET',
      config.META_INSTAGRAM_APP_SECRET,
    ),
  );
  urlParams.append('grant_type', 'authorization_code');
  urlParams.append('redirect_uri', redirectUri);
  urlParams.append('code', code);

  const res = await metaFetch(
    `${INSTAGRAM_OAUTH_BASE_URL}/oauth/access_token`,
    {
      method: 'POST',
      body: urlParams,
    },
  );
  const data = await handleResponse(res);
  return { accessToken: data.access_token, userId: data.user_id };
}

export async function exchangeInstagramToken(
  shortToken: string,
): Promise<{ accessToken: string; expiresIn: number }> {
  const urlParams = new URLSearchParams();
  urlParams.append('grant_type', 'ig_exchange_token');
  urlParams.append(
    'client_secret',
    requireConfig(
      'META_INSTAGRAM_APP_SECRET',
      config.META_INSTAGRAM_APP_SECRET,
    ),
  );
  urlParams.append('access_token', shortToken);

  const res = await metaFetch(
    `${INSTAGRAM_TOKEN_BASE_URL}/access_token?${urlParams}`,
  );
  const data = await handleResponse(res);
  return { accessToken: data.access_token, expiresIn: data.expires_in };
}

export async function getInstagramUser(
  accessToken: string,
): Promise<{ userId: string; username: string; accountType?: string }> {
  const res = await metaFetch(
    `${INSTAGRAM_API_BASE_URL}/me?fields=user_id,username,account_type&access_token=${accessToken}`,
  );
  const data = await handleResponse(res);
  return {
    userId: data.user_id,
    username: data.username,
    accountType: data.account_type,
  };
}

// ---------- Facebook (Facebook Login for Business) ----------

export async function refreshFacebookToken(
  userToken: string,
): Promise<{ accessToken: string; expiresIn: number }> {
  const urlParams = new URLSearchParams();
  urlParams.append('grant_type', 'fb_exchange_token');
  urlParams.append(
    'client_id',
    requireConfig('META_FACEBOOK_APP_ID', config.META_FACEBOOK_APP_ID),
  );
  urlParams.append(
    'client_secret',
    requireConfig('META_FACEBOOK_APP_SECRET', config.META_FACEBOOK_APP_SECRET),
  );
  urlParams.append('fb_exchange_token', userToken);

  const res = await metaFetch(
    `${FACEBOOK_GRAPH_API_BASE_URL}/oauth/access_token?${urlParams}`,
  );
  const data = await handleResponse(res);
  return { accessToken: data.access_token, expiresIn: data.expires_in };
}

export async function exchangeFacebookCode(
  code: string,
  redirectUri: string,
): Promise<{ accessToken: string; expiresIn: number }> {
  const urlParams = new URLSearchParams();
  urlParams.append(
    'client_id',
    requireConfig('META_FACEBOOK_APP_ID', config.META_FACEBOOK_APP_ID),
  );
  urlParams.append(
    'client_secret',
    requireConfig('META_FACEBOOK_APP_SECRET', config.META_FACEBOOK_APP_SECRET),
  );
  urlParams.append('redirect_uri', redirectUri);
  urlParams.append('code', code);

  const res = await metaFetch(
    `${FACEBOOK_GRAPH_API_BASE_URL}/oauth/access_token?${urlParams}`,
  );
  const data = await handleResponse(res);
  return { accessToken: data.access_token, expiresIn: data.expires_in };
}

export async function getFacebookPages(
  userToken: string,
): Promise<{ id: string; name: string }[]> {
  return (await getFacebookAssets(userToken)).map(({ id, name }) => ({
    id,
    name,
  }));
}

export async function getFacebookUserId(token: string): Promise<string> {
  const data = await handleResponse(
    await metaFetch(`${FACEBOOK_GRAPH_API_BASE_URL}/me?fields=id`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
  );
  if (!data.id) throw new Error('Missing subject');
  return String(data.id);
}
export async function getGrantedPermissions(
  provider: 'instagram' | 'facebook',
  token: string,
): Promise<string[]> {
  const base =
    provider === 'instagram'
      ? INSTAGRAM_API_BASE_URL
      : FACEBOOK_GRAPH_API_BASE_URL;
  const data = await handleResponse(
    await metaFetch(`${base}/me/permissions`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
  );
  return (data.data || [])
    .filter((p: any) => p.status === 'granted')
    .map((p: any) => p.permission);
}
export async function getFacebookAssets(
  token: string,
): Promise<{ id: string; name: string; token: string; tasks: string[] }[]> {
  const assets: any[] = [];
  let after: string | undefined;
  const seen = new Set<string>();
  do {
    const params = new URLSearchParams({
      fields: 'id,name,access_token,tasks',
      limit: '100',
    });
    if (after) params.set('after', after);
    const data = await handleResponse(
      await metaFetch(`${FACEBOOK_GRAPH_API_BASE_URL}/me/accounts?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    for (const p of data.data || [])
      if (p.access_token)
        assets.push({
          id: String(p.id),
          name: p.name,
          token: p.access_token,
          tasks: p.tasks || [],
        });
    after = data.paging?.next ? data.paging?.cursors?.after : undefined;
    if (after && seen.has(after)) throw new Error('Repeated pagination cursor');
    if (after) seen.add(after);
  } while (after);
  return assets;
}
export async function facebookRequest(
  pageId: string,
  token: string,
  edge: string,
  params: Record<string, string>,
) {
  return handleResponse(
    await metaFetch(`${FACEBOOK_GRAPH_API_BASE_URL}/${pageId}/${edge}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: new URLSearchParams(params),
    }),
  );
}
export async function facebookVideoStatus(videoId: string, token: string) {
  return handleResponse(
    await metaFetch(`${FACEBOOK_GRAPH_API_BASE_URL}/${videoId}?fields=status`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
  );
}
export async function uploadFacebookVideo(
  uploadUrl: string,
  token: string,
  fileUrl: string,
) {
  const url = new URL(uploadUrl);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'rupload.facebook.com' ||
    url.username ||
    url.password
  )
    throw new Error('Invalid upload host');
  return handleResponse(
    await metaFetch(url.toString(), {
      method: 'POST',
      headers: { Authorization: `OAuth ${token}`, file_url: fileUrl },
    }),
  );
}
export async function mediaPermalink(
  provider: 'instagram' | 'facebook',
  id: string,
  token: string,
): Promise<string | null> {
  const field = provider === 'instagram' ? 'permalink' : 'permalink_url';
  const data = await handleResponse(
    await metaFetch(
      `${provider === 'instagram' ? INSTAGRAM_API_BASE_URL : FACEBOOK_GRAPH_API_BASE_URL}/${id}?fields=${field}`,
      { headers: { Authorization: `Bearer ${token}` } },
    ),
  );
  return data[field] || null;
}
