import pino, { type LoggerOptions } from 'pino';
export const loggerOptions: LoggerOptions = {
  level: process.env.LOG_LEVEL || 'info',
  redact: {
    paths: [
      'req.headers',
      'req.body',
      'req.query',
      'res.headers',
      'access_token',
      'accessToken',
      'client_secret',
      'code',
      'state',
      'token',
      'err.config',
      'err.request',
    ],
    censor: '[REDACTED]',
  },
  hooks: {
    logMethod(args, method) {
      const first = args[0] as any;
      if (first instanceof Error) {
        args[0] = { err: first };
        if (typeof args[1] !== 'string') args[1] = 'Operation failed';
      } else if (
        first &&
        typeof first === 'object' &&
        first.err &&
        typeof args[1] !== 'string'
      )
        args[1] = 'Operation failed';
      method.apply(this, args);
    },
  },
  serializers: {
    req: (req) => ({
      method: req.method,
      path: String(req.url || '').split('?')[0],
      id: req.id,
    }),
    err: (err) => ({
      name: err.name,
      code: err.code,
      statusCode: err.statusCode,
    }),
  },
};
export const logger = pino(loggerOptions);
