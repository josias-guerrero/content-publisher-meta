import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastify from 'fastify';
import { accountsRoutes } from './accounts.routes.js';
import * as accountsService from './accounts.service.js';

vi.mock('./accounts.service.js');

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
});
