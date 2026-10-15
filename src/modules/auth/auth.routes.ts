import type { FastifyPluginAsync } from 'fastify';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { config } from '../../config.js';
import { sqlite } from '../../db/index.js';
import { context, equal } from '../../security/context.js';
import { encrypt, decrypt } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { audit } from '../../security/audit.js';
import { emit } from '../../jobs/events.js';
import * as graph from '../../meta/graph-api.js';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const now = () => Math.floor(Date.now() / 1000);
const scopes = {
  instagram: ['instagram_business_basic', 'instagram_business_content_publish'],
  facebook: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'],
};
function owned(id: string) {
  const c = context();
  const row = sqlite
    .prepare(
      'SELECT * FROM oauth_sessions WHERE id=? AND agency_id=? AND client_id=? AND user_id=? AND session_hash=?',
    )
    .get(id, c.agencyId, c.clientId, c.userId, hash(c.sessionId)) as any;
  if (!row)
    throw new AppError(404, 'OAUTH_SESSION_NOT_FOUND', 'Session not found');
  return row;
}
export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/sessions', async (request, reply) => {
    const { platform } = z
      .object({ platform: z.enum(['instagram', 'facebook']) })
      .parse(request.body);
    if (platform === 'facebook' && !config.META_FACEBOOK_APP_ID)
      throw new AppError(
        409,
        'PROVIDER_NOT_CONFIGURED',
        'Facebook not configured',
      );
    const c = context(),
      id = randomUUID(),
      ticket = randomBytes(32).toString('base64url'),
      state = randomBytes(32).toString('base64url'),
      expires = now() + 600;
    // State is encrypted until the browser redeems the one-use launch ticket.
    sqlite
      .prepare(
        'INSERT INTO oauth_sessions(id,provider,agency_id,client_id,user_id,session_hash,state_hash,ticket_hash,expires_at,assets,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        id,
        platform,
        c.agencyId,
        c.clientId,
        c.userId,
        hash(c.sessionId),
        hash(state),
        hash(ticket),
        expires,
        encrypt(state),
        now(),
      );
    return reply.code(201).send({
      id,
      authorizationUrl: `${config.PUBLIC_BASE_URL}/auth/${platform}/login?ticket=${ticket}`,
      expiresAt: expires,
    });
  });
  app.get('/sessions/:id', async (request) => {
    const row = owned((request.params as any).id);
    return {
      id: row.id,
      status:
        row.status === 'pending' && row.expires_at <= now()
          ? 'expired'
          : row.status,
      expiresAt: row.expires_at,
    };
  });
  app.get('/sessions/:id/assets', async (request) => {
    const row = owned((request.params as any).id);
    if (row.status !== 'succeeded')
      throw new AppError(409, 'OAUTH_NOT_READY', 'Authorization not complete');
    const assets = JSON.parse(decrypt(row.assets));
    return { assets: assets.map(({ token, ...asset }: any) => asset) };
  });
  app.post('/sessions/:id/complete', async (request) => {
    const { assetIds } = z
      .object({ assetIds: z.array(z.string().min(1)).min(1).max(100) })
      .parse(request.body);
    const selected = JSON.stringify([...new Set(assetIds)].sort());
    return sqlite.transaction(() => {
      const row = owned((request.params as any).id),
        c = context();
      if (row.status !== 'succeeded' || row.expires_at <= now())
        throw new AppError(409, 'OAUTH_NOT_READY', 'Session unavailable');
      const connection = sqlite
        .prepare('SELECT status,expires_at FROM connections WHERE id=?')
        .get(row.connection_id) as any;
      if (
        !connection ||
        connection.status !== 'active' ||
        connection.expires_at <= now()
      )
        throw new AppError(
          409,
          'CONNECTION_REAUTH_REQUIRED',
          'Authorization no longer active',
        );
      if (row.selected && row.selected !== selected)
        throw new AppError(
          409,
          'SELECTION_CONFLICT',
          'Selection already completed',
        );
      const assets = JSON.parse(decrypt(row.assets));
      if (assetIds.some((id) => !assets.some((a: any) => a.id === id)))
        throw new AppError(400, 'INVALID_ASSET', 'Invalid asset selection');
      const result = [];
      for (const asset of assets.filter((a: any) => assetIds.includes(a.id))) {
        let account = sqlite
          .prepare('SELECT id FROM accounts WHERE platform=? AND external_id=?')
          .get(row.provider, asset.id) as any;
        if (!account) {
          account = { id: randomUUID() };
          // New credentials live only on the connection/grant, never on the shared asset.
          sqlite
            .prepare(
              'INSERT INTO accounts(id,platform,external_id,name,access_token,token_expires_at,created_at) VALUES(?,?,?,?,?,?,?)',
            )
            .run(account.id, row.provider, asset.id, asset.name, '', 0, now());
        }
        sqlite
          .prepare(
            'INSERT OR IGNORE INTO grants(id,account_id,connection_id,agency_id,client_id,token,token_type,capabilities) VALUES(?,?,?,?,?,?,?,?)',
          )
          .run(
            randomUUID(),
            account.id,
            row.connection_id,
            c.agencyId,
            c.clientId,
            encrypt(asset.token),
            row.provider === 'facebook' ? 'page' : 'instagram',
            JSON.stringify({
              accountType: asset.accountType,
              tasks: asset.tasks,
            }),
          );
        result.push({
          id: account.id,
          platform: row.provider,
          external_id: asset.id,
          name: asset.name,
        });
      }
      if (!row.selected) {
        sqlite
          .prepare('UPDATE oauth_sessions SET selected=? WHERE id=?')
          .run(selected, row.id);
        emit('connection.updated', c, {
          id: row.connection_id,
          status: 'active',
        });
        audit(c.userId, c.agencyId, 'oauth.select-assets', row.connection_id);
      }
      return { accounts: result };
    })();
  });
  for (const provider of ['instagram', 'facebook'] as const) {
    app.get(`/${provider}/login`, async (request, reply) => {
      const { ticket } = z
        .object({ ticket: z.string().min(40).max(100) })
        .parse(request.query);
      const browser = randomBytes(32).toString('base64url');
      const row = sqlite
        .prepare(
          `UPDATE oauth_sessions SET browser_hash=? WHERE ticket_hash=? AND provider=? AND browser_hash IS NULL AND expires_at>? AND status='pending' RETURNING *`,
        )
        .get(hash(browser), hash(ticket), provider, now()) as any;
      if (!row)
        throw new AppError(
          400,
          'INVALID_TICKET',
          'Invalid or expired launch ticket',
        );
      const state = decrypt(row.assets);
      sqlite
        .prepare('UPDATE oauth_sessions SET assets=NULL WHERE id=?')
        .run(row.id);
      const params = new URLSearchParams({
        client_id:
          provider === 'instagram'
            ? config.META_INSTAGRAM_APP_ID
            : config.META_FACEBOOK_APP_ID!,
        redirect_uri: `${config.PUBLIC_BASE_URL}/auth/${provider}/callback`,
        response_type: 'code',
        scope: scopes[provider].join(','),
        state,
      });
      reply.header(
        'set-cookie',
        `oauth_${row.id}=${browser}; Path=/auth/${provider}/callback; HttpOnly; SameSite=Lax; Max-Age=600${config.PUBLIC_BASE_URL.startsWith('https:') ? '; Secure' : ''}`,
      );
      reply
        .header('cache-control', 'no-store')
        .header('referrer-policy', 'no-referrer');
      return reply.redirect(
        `${provider === 'instagram' ? 'https://www.instagram.com/oauth/authorize' : `https://www.facebook.com/${config.META_GRAPH_API_VERSION}/dialog/oauth`}?${params}`,
      );
    });
    app.get(`/${provider}/callback`, async (request, reply) => {
      const query = z
        .object({
          state: z.string().min(40).max(100),
          code: z.string().max(4096).optional(),
          error: z.string().optional(),
        })
        .parse(request.query);
      const row = sqlite
        .prepare(
          'SELECT * FROM oauth_sessions WHERE state_hash=? AND provider=? AND expires_at>? AND consumed_at IS NULL',
        )
        .get(hash(query.state), provider, now()) as any;
      const cookies = Object.fromEntries(
        String(request.headers.cookie || '')
          .split(';')
          .map((c) => c.trim().split('=')),
      );
      if (
        !row ||
        !row.browser_hash ||
        !equal(hash(cookies[`oauth_${row.id}`] || ''), row.browser_hash)
      )
        throw new AppError(
          400,
          'INVALID_STATE',
          'Invalid OAuth state or browser binding',
        );
      const consumed = sqlite
        .prepare(
          'UPDATE oauth_sessions SET consumed_at=? WHERE id=? AND consumed_at IS NULL',
        )
        .run(now(), row.id);
      if (!consumed.changes)
        throw new AppError(400, 'INVALID_STATE', 'State already consumed');
      reply
        .header('cache-control', 'no-store')
        .header('referrer-policy', 'no-referrer');
      reply.header(
        'set-cookie',
        `oauth_${row.id}=; Path=/auth/${provider}/callback; HttpOnly; SameSite=Lax; Max-Age=0`,
      );
      if (query.error || !query.code) {
        sqlite
          .prepare('UPDATE oauth_sessions SET status=? WHERE id=?')
          .run(query.error ? 'denied' : 'failed', row.id);
        return reply
          .code(400)
          .type('text/html')
          .send(
            '<p>La autorización no se completó. Puedes cerrar esta ventana y volver a Tiko.</p>',
          );
      }
      let phase = 'code_exchange';
      try {
        const redirect = `${config.PUBLIC_BASE_URL}/auth/${provider}/callback`;
        let token: string, expires: number, subject: string, assets: any[];
        if (provider === 'instagram') {
          const short = await graph.exchangeInstagramCode(query.code, redirect);
          phase = 'long_token_exchange';
          const long = await graph.exchangeInstagramToken(short.accessToken);
          phase = 'identity_lookup';
          const user = await graph.getInstagramUser(long.accessToken);
          // Use the subject returned by /me with the exchanged token. The
          // OAuth token response and Graph profile can expose IDs in different
          // scopes; the token-authenticated profile is canonical for API calls.
          token = long.accessToken;
          expires = now() + long.expiresIn;
          subject = String(user.userId);
          assets = [
            {
              id: subject,
              name: user.username,
              accountType: user.accountType,
              token,
            },
          ];
        } else {
          const short = await graph.exchangeFacebookCode(query.code, redirect),
            long = await graph.refreshFacebookToken(short.accessToken);
          token = long.accessToken;
          expires = now() + long.expiresIn;
          subject = await graph.getFacebookUserId(token);
          assets = (await graph.getFacebookAssets(token)).filter((a) =>
            a.tasks?.some((t) =>
              [
                'CREATE_CONTENT',
                'MANAGE',
                'PROFILE_PLUS_CREATE_CONTENT',
              ].includes(t),
            ),
          );
        }
        phase = 'permission_check';
        // Instagram Login tokens do not support the Facebook Graph
        // `/me/permissions` edge. The Instagram OAuth consent requested the
        // scopes above; endpoint-specific access is confirmed by the live
        // diagnostic/publish calls. Facebook Login still exposes that edge.
        const granted =
          provider === 'instagram'
            ? scopes.instagram
            : await graph.getGrantedPermissions(provider, token);
        if (
          provider === 'facebook' &&
          scopes[provider].some((s) => !granted.includes(s))
        )
          throw new AppError(
            403,
            'PERMISSION_MISSING',
            'Required publishing permissions missing',
          );
        const deletionHash = hash(
          `${provider}:${provider === 'instagram' ? config.META_INSTAGRAM_APP_ID : config.META_FACEBOOK_APP_ID}:${subject}`,
        );
        if (
          sqlite
            .prepare(
              "SELECT id FROM deletion_requests WHERE user_hash=? AND status<>'completed'",
            )
            .get(deletionHash)
        )
          throw new AppError(
            409,
            'DELETION_PENDING',
            'Deletion is in progress',
          );
        const id = randomUUID();
        phase = 'store_connection';
        sqlite.transaction(() => {
          sqlite
            .prepare(
              'INSERT INTO connections(id,agency_id,provider,login_mode,app_id,subject_id,scopes,token,token_type,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
            )
            .run(
              id,
              row.agency_id,
              provider,
              `${provider}_login`,
              provider === 'instagram'
                ? config.META_INSTAGRAM_APP_ID
                : config.META_FACEBOOK_APP_ID!,
              subject,
              JSON.stringify(granted),
              encrypt(token),
              provider === 'instagram' ? 'instagram' : 'user',
              expires,
              now(),
              now(),
            );
          sqlite
            .prepare(
              "UPDATE oauth_sessions SET status='succeeded',connection_id=?,assets=? WHERE id=?",
            )
            .run(id, encrypt(JSON.stringify(assets)), row.id);
        })();
        return reply
          .type('text/html')
          .send(
            '<p>Autorización recibida. Cierra esta ventana y selecciona las cuentas en Tiko.</p>',
          );
      } catch (error) {
        const metaError = error instanceof graph.MetaApiError ? error : null;
        request.log.warn(
          {
            reqId: request.id,
            provider,
            phase,
            errorCode: error instanceof AppError ? error.code : undefined,
            errorName: error instanceof Error ? error.name : 'UnknownError',
            metaStatus: metaError?.status,
            metaCode: metaError?.code,
            metaType: metaError?.type,
            metaSubcode: metaError?.subcode,
            metaTraceId: metaError?.traceId,
          },
          'OAuth callback failed; sensitive credentials omitted',
        );
        sqlite
          .prepare(
            "UPDATE oauth_sessions SET status='failed',assets=NULL WHERE id=?",
          )
          .run(row.id);
        throw new AppError(
          502,
          'OAUTH_EXCHANGE_FAILED',
          'No se pudo completar la autorización',
        );
      }
    });
  }
};
