import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastify from 'fastify';
import { accountsRoutes } from './accounts.routes.js';
import * as accountsService from './accounts.service.js';
import * as graphApi from '../../meta/graph-api.js';

vi.mock('./accounts.service.js');
vi.mock('../../meta/graph-api.js');

describe('Accounts Routes', () => {
  const app = fastify();
  app.register(accountsRoutes, { prefix: '/accounts' });

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should list accounts', async () => {
    vi.mocked(accountsService.listAccounts).mockResolvedValue([
      {
        id: '12345678-1234-1234-1234-123456789012',
        platform: 'instagram',
        external_id: 'ext-1',
        name: 'mi.marca',
        token_expires_at: 1700000000,
        created_at: 1600000000,
      },
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/accounts',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.accounts).toHaveLength(1);
    expect(body.accounts[0].id).toBe('12345678-1234-1234-1234-123456789012');
    expect(body.accounts[0].name).toBe('mi.marca');
  });

  it('should create an account', async () => {
    vi.mocked(accountsService.createAccount).mockResolvedValue({ id: '87654321-4321-4321-4321-210987654321' });

    const payload = {
      platform: 'facebook',
      externalId: 'ext-2',
      accessToken: 'dummy-token',
      tokenExpiresAt: 1700000000,
    };

    const response = await app.inject({
      method: 'POST',
      url: '/accounts',
      payload,
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.id).toBe('87654321-4321-4321-4321-210987654321');
    expect(accountsService.createAccount).toHaveBeenCalledWith(payload);
  });

  it('returns 404 when testing an unknown account', async () => {
    vi.mocked(accountsService.getAccountWithToken).mockResolvedValue(null);

    const response = await app.inject({
      method: 'POST',
      url: '/accounts/unknown-id/test',
    });

    expect(response.statusCode).toBe(404);
  });

  it('validates an instagram account and checks container status without publishing', async () => {
    vi.mocked(accountsService.getAccountWithToken).mockResolvedValue({
      id: 'acc-1',
      platform: 'instagram',
      external_id: 'ig-1',
      access_token: 'plain-token',
      token_expires_at: 1700000000,
      created_at: 1600000000,
    });
    vi.mocked(graphApi.getInstagramUser).mockResolvedValue({
      userId: 'ig-1',
      username: 'myuser',
      accountType: 'BUSINESS',
    });
    vi.mocked(graphApi.createMediaContainer).mockResolvedValue({ containerId: 'container-1' });
    vi.mocked(graphApi.getContainerStatus).mockResolvedValue({ statusCode: 'FINISHED' });

    const response = await app.inject({
      method: 'POST',
      url: '/accounts/acc-1/test',
      payload: { imageUrl: 'https://example.com/test.jpg' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.matched).toBe(true);
    expect(body.account_type).toBe('BUSINESS');
    expect(body.container).toEqual({ container_id: 'container-1', status: 'FINISHED' });
    expect(graphApi.publishContainer).not.toHaveBeenCalled();
  });

  it('validates a facebook account against its pages', async () => {
    vi.mocked(accountsService.getAccountWithToken).mockResolvedValue({
      id: 'acc-2',
      platform: 'facebook',
      external_id: 'page-1',
      access_token: 'plain-token',
      token_expires_at: 1700000000,
      created_at: 1600000000,
    });
    vi.mocked(graphApi.getFacebookPages).mockResolvedValue([
      { id: 'page-1', name: 'My Page' },
      { id: 'page-2', name: 'Other Page' },
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/accounts/acc-2/test',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.accessible).toBe(true);
    expect(body.page).toEqual({ id: 'page-1', name: 'My Page' });
  });
});
