import { it, expect } from 'vitest';
import pino from 'pino';
import { loggerOptions } from './logger.js';
it('does not log OAuth query codes, headers, bodies or error messages', () => {
  let output = '';
  const log = pino(
    { ...loggerOptions, level: 'info' },
    {
      write(chunk: string) {
        output += chunk;
      },
    },
  );
  log.info({
    req: {
      method: 'GET',
      id: 'request',
      url: '/auth/instagram/callback?code=secret-code&state=secret-state',
      headers: { authorization: 'secret-header' },
      body: { access_token: 'secret-body' },
    },
    access_token: 'secret-token',
    err: {
      name: 'Error',
      message: 'secret-message',
      config: { token: 'secret-config' },
    },
  });
  for (const secret of [
    'secret-code',
    'secret-state',
    'secret-header',
    'secret-body',
    'secret-token',
    'secret-message',
    'secret-config',
  ])
    expect(output).not.toContain(secret);
  expect(output).toContain('/auth/instagram/callback');
  expect(output).toContain('request');
});
