import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastify from 'fastify';
import { authRoutes } from './auth.routes.js';
import * as graphApi from '../../meta/graph-api.js';
import * as accountsService from '../accounts/accounts.service.js';

vi.mock('../../config.js', () => ({
  config: {
    META_INSTAGRAM_APP_ID: 'ig-app',
    META_INSTAGRAM_APP_SECRET: 'ig-secret',
    META_FACEBOOK_APP_ID: 'fb-app',
    META_FACEBOOK_APP_SECRET: 'fb-secret',
    META_GRAPH_API_VERSION: 'v21.0',
  },
}));
vi.mock('../../meta/graph-api.js');
vi.mock('../accounts/accounts.service.js');

describe('Auth Routes', () => {
  const app = fastify();
  app.register(authRoutes, { prefix: '/auth' });

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('redirects to the Instagram authorize URL with publishing scopes', async () => {
    const response = await app.inject({ method: 'GET', url: '/auth/instagram/login' });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain('https://www.instagram.com/oauth/authorize');
    expect(response.headers.location).toContain('instagram_business_content_publish');
  });

  it('redirects to the Facebook dialog for business login', async () => {
    const response = await app.inject({ method: 'GET', url: '/auth/facebook/login' });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain('https://www.facebook.com/v21.0/dialog/oauth');
    expect(response.headers.location).toContain('pages_manage_posts');
  });

  it('registers an instagram account on callback', async () => {
    vi.mocked(graphApi.exchangeInstagramCode).mockResolvedValue({ accessToken: 'short', userId: 'ig-1' });
    vi.mocked(graphApi.exchangeInstagramToken).mockResolvedValue({ accessToken: 'long', expiresIn: 5184000 });
    vi.mocked(graphApi.getInstagramUser).mockResolvedValue({ userId: 'ig-1', username: 'myuser' });
    vi.mocked(accountsService.createAccount).mockResolvedValue({ id: 'uuid-1' });

    const response = await app.inject({ method: 'GET', url: '/auth/instagram/callback?code=abc' });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.account.platform).toBe('instagram');
    expect(body.account.external_id).toBe('ig-1');
    expect(accountsService.createAccount).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'instagram', externalId: 'ig-1', name: 'myuser', accessToken: 'long' })
    );
  });

  it('registers one account per facebook page on callback', async () => {
    vi.mocked(graphApi.exchangeFacebookCode).mockResolvedValue({ accessToken: 'short', expiresIn: 5000 });
    vi.mocked(graphApi.refreshFacebookToken).mockResolvedValue({ accessToken: 'long', expiresIn: 5184000 });
    vi.mocked(graphApi.getFacebookPages).mockResolvedValue([
      { id: 'page-1', name: 'Page One' },
      { id: 'page-2', name: 'Page Two' },
    ]);
    vi.mocked(accountsService.createAccount)
      .mockResolvedValueOnce({ id: 'uuid-1' })
      .mockResolvedValueOnce({ id: 'uuid-2' });

    const response = await app.inject({ method: 'GET', url: '/auth/facebook/callback?code=abc' });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.accounts).toHaveLength(2);
    expect(body.accounts[0].external_id).toBe('page-1');
    expect(body.accounts[1].external_id).toBe('page-2');
    expect(accountsService.createAccount).toHaveBeenCalledTimes(2);
    expect(accountsService.createAccount).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ platform: 'facebook', externalId: 'page-1', name: 'Page One' })
    );
    expect(accountsService.createAccount).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ platform: 'facebook', externalId: 'page-2', name: 'Page Two' })
    );
  });

  it('returns 400 when Meta reports an OAuth error', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/auth/instagram/callback?error=access_denied&error_description=User+denied',
    });
    expect(response.statusCode).toBe(400);
  });
});
