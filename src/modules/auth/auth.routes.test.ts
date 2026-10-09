import { beforeEach, describe, it, expect, vi } from 'vitest';
import { buildApp } from '../../server.js';
import { clear, headers } from '../../test-helpers.js';
import * as graph from '../../meta/graph-api.js';
import { sqlite } from '../../db/index.js';
vi.mock('../../meta/graph-api.js', async (original) => ({
  ...(await original<any>()),
  exchangeInstagramCode: vi.fn(),
  exchangeInstagramToken: vi.fn(),
  getInstagramUser: vi.fn(),
  getGrantedPermissions: vi.fn(),
}));
describe('OAuth bound state', () => {
  beforeEach(() => {
    clear();
    vi.clearAllMocks();
  });
  it('rejects unsigned start and callback before exchange', async () => {
    const a = buildApp();
    expect((await a.inject('/auth/instagram/login')).statusCode).toBe(400);
    expect(
      (
        await a.inject(
          '/auth/instagram/callback?code=secret&state=' + 'a'.repeat(43),
        )
      ).statusCode,
    ).toBe(400);
    expect(graph.exchangeInstagramCode).not.toHaveBeenCalled();
    await a.close();
  });
  it('binds browser, consumes once, and requires explicit selection', async () => {
    const a = buildApp();
    const session = (
      await a.inject({
        method: 'POST',
        url: '/auth/sessions',
        headers: headers('POST', '/auth/sessions'),
        payload: { platform: 'instagram' },
      })
    ).json();
    const launchUrl = new URL(session.authorizationUrl);
    const launch = await a.inject({
      url: launchUrl.pathname + launchUrl.search,
      headers: {
        host: 'attacker.example',
        'x-forwarded-proto': 'http',
        'x-forwarded-host': 'attacker.example',
      },
    });
    expect(
      new URL(String(launch.headers.location)).searchParams.get('redirect_uri'),
    ).toBe('https://publisher.example.test/auth/instagram/callback');
    const state = new URL(String(launch.headers.location)).searchParams.get(
      'state',
    );
    const cookie = String(launch.headers['set-cookie']).split(';')[0];
    const callback = '/auth/instagram/callback?code=fake&state=' + state;
    expect((await a.inject(callback)).statusCode).toBe(400);
    expect(graph.exchangeInstagramCode).not.toHaveBeenCalled();
    vi.mocked(graph.exchangeInstagramCode).mockResolvedValue({
      accessToken: 'short',
      userId: 'ig-1',
    });
    vi.mocked(graph.exchangeInstagramToken).mockResolvedValue({
      accessToken: 'long',
      expiresIn: 86400,
    });
    vi.mocked(graph.getInstagramUser).mockResolvedValue({
      userId: 'ig-1',
      username: 'test',
      accountType: 'BUSINESS',
    });
    vi.mocked(graph.getGrantedPermissions).mockResolvedValue([
      'instagram_business_basic',
      'instagram_business_content_publish',
    ]);
    expect(
      (await a.inject({ url: callback, headers: { cookie } })).statusCode,
    ).toBe(200);
    expect(
      (sqlite.prepare('SELECT count(*) n FROM accounts').get() as any).n,
    ).toBe(0);
    expect(
      (await a.inject({ url: callback, headers: { cookie } })).statusCode,
    ).toBe(400);
    expect(graph.exchangeInstagramCode).toHaveBeenCalledTimes(1);
    const path = `/auth/sessions/${session.id}/complete`;
    const result = await a.inject({
      method: 'POST',
      url: path,
      headers: headers('POST', path),
      payload: { assetIds: ['ig-1'] },
    });
    expect(result.statusCode).toBe(200);
    expect(result.json().accounts).toHaveLength(1);
    expect(
      (
        await a.inject({
          method: 'POST',
          url: path,
          headers: headers('POST', path),
          payload: { assetIds: ['ig-1'] },
        })
      ).json(),
    ).toEqual(result.json());
    await a.close();
  });
});
