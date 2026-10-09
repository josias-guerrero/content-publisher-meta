import { beforeEach, describe, it, expect } from 'vitest';
import { buildApp } from '../../server.js';
import { clear, fixture, headers } from '../../test-helpers.js';
describe('account authorization', () => {
  beforeEach(clear);
  it('requires service and signed context', async () => {
    const a = buildApp();
    expect((await a.inject('/accounts')).statusCode).toBe(401);
    expect((await a.inject({ url: '/auth/sessions/unknown' })).statusCode).toBe(
      401,
    );
    expect((await a.inject('/health')).statusCode).toBe(200);
    await a.close();
  });
  it('scopes assets and never exposes credentials', async () => {
    const a = buildApp();
    fixture();
    const own = await a.inject({
      url: '/accounts',
      headers: headers('GET', '/accounts'),
    });
    expect(own.json().accounts).toHaveLength(1);
    expect(own.body).not.toContain('access_token');
    for (const ctx of [{ agencyId: 'b' }, { clientId: 'b' }])
      expect(
        (
          await a.inject({
            url: '/accounts',
            headers: headers('GET', '/accounts', ctx),
          })
        ).json().accounts,
      ).toHaveLength(0);
    await a.close();
  });
  it('does not delete an asset or its history', async () => {
    const a = buildApp(),
      f = fixture(),
      path = '/accounts/' + f.account;
    expect(
      (
        await a.inject({
          method: 'DELETE',
          url: path,
          headers: headers('DELETE', path),
        })
      ).statusCode,
    ).toBe(409);
    await a.close();
  });
});

it('rejects a context signed for a different route', async () => {
  const app = buildApp();
  const r = await app.inject({
    url: '/accounts',
    headers: headers('GET', '/posts'),
  });
  expect(r.statusCode).toBe(401);
  await app.close();
});
