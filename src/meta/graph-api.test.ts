import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  getFacebookAssets,
  getInstagramUser,
  publishContainer,
  MetaApiError,
} from './graph-api.js';
describe('Meta HTTP client', () => {
  afterEach(() => vi.restoreAllMocks());
  it('follows cursor pagination using only the configured Graph host', async () => {
    const f = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: '1',
                name: 'First',
                access_token: 'fake',
                tasks: ['CREATE_CONTENT'],
              },
            ],
            paging: {
              next: 'https://evil.test/?token=secret',
              cursors: { after: 'cursor' },
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: '2',
                name: 'Second',
                access_token: 'fake2',
                tasks: ['MANAGE'],
              },
            ],
          }),
        ),
      );
    const pages = await getFacebookAssets('fake-user-token');
    expect(pages.map((p) => p.id)).toEqual(['1', '2']);
    expect(String(f.mock.calls[1][0])).toContain('https://graph.facebook.com/');
    expect(String(f.mock.calls[1][0])).toContain('after=cursor');
    expect(String(f.mock.calls[1][0])).not.toContain('evil');
  });
  it('classifies authentication without leaking remote messages', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 190,
            error_subcode: 463,
            fbtrace_id: 'trace',
            message: 'secret-token',
          },
        }),
        { status: 400 },
      ),
    );
    try {
      await getInstagramUser('fake');
      throw new Error('Expected error');
    } catch (e) {
      expect(e).toBeInstanceOf(MetaApiError);
      expect(e).toMatchObject({ type: 'AUTH', subcode: 463, traceId: 'trace' });
      expect(String(e)).not.toContain('secret-token');
    }
  });
  it('rejects non JSON and never repeats an uncertain publication', async () => {
    const f = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response('<html>Unavailable</html>', { status: 503 }),
      );
    await expect(
      publishContainer('user', 'fake', 'container'),
    ).rejects.toMatchObject({ type: 'INVALID_RESPONSE' });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('maps network timeout without blind retry', async () => {
    const f = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new DOMException('timeout', 'TimeoutError'));
    await expect(
      publishContainer('user', 'fake', 'container'),
    ).rejects.toMatchObject({ type: 'NETWORK', retryable: true });
    expect(f).toHaveBeenCalledTimes(1);
  });
});
