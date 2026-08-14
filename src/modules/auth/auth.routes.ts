import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { config } from '../../config.js';
import { createAccount } from '../accounts/accounts.service.js';
import * as graphApi from '../../meta/graph-api.js';

function callbackUrl(request: FastifyRequest, path: string): string {
  if (config.PUBLIC_BASE_URL) {
    return `${config.PUBLIC_BASE_URL.replace(/\/+$/, '')}${path}`;
  }
  const forwardedProto = request.headers['x-forwarded-proto'];
  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto || request.protocol;
  return `${proto}://${request.host}${path}`;
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  // ---------- Instagram (Instagram API with Instagram Login) ----------

  fastify.get('/instagram/login', async (_request, reply) => {
    const redirectUri = callbackUrl(_request, '/auth/instagram/callback');
    const params = new URLSearchParams({
      client_id: config.META_INSTAGRAM_APP_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'instagram_business_basic,instagram_business_content_publish',
    });
    return reply.redirect(`https://www.instagram.com/oauth/authorize?${params.toString()}`);
  });

  fastify.get('/instagram/callback', async (request, reply) => {
    const query = request.query as { code?: string; error?: string; error_description?: string };
    if (query.error) {
      return reply.status(400).send({ error: query.error, error_description: query.error_description });
    }
    if (!query.code) {
      return reply.status(400).send({ error: 'Missing code parameter' });
    }
    const redirectUri = callbackUrl(request, '/auth/instagram/callback');
    try {
      const { accessToken: shortToken } = await graphApi.exchangeInstagramCode(query.code, redirectUri);
      const { accessToken, expiresIn } = await graphApi.exchangeInstagramToken(shortToken);
      const { userId, username } = await graphApi.getInstagramUser(accessToken);
      const tokenExpiresAt = now() + expiresIn;

      const { id } = await createAccount({
        platform: 'instagram',
        externalId: userId,
        name: username,
        accessToken,
        tokenExpiresAt,
      });

      return reply.status(201).send({
        account: { id, platform: 'instagram', external_id: userId, name: username, token_expires_at: tokenExpiresAt },
      });
    } catch (err: any) {
      return reply.status(502).send({ error: err.message });
    }
  });

  // ---------- Facebook (Facebook Login for Business) ----------

  fastify.get('/facebook/login', async (_request, reply) => {
    if (!config.META_FACEBOOK_APP_ID) {
      return reply.status(400).send({ error: 'META_FACEBOOK_APP_ID is not configured' });
    }
    const redirectUri = callbackUrl(_request, '/auth/facebook/callback');
    const params = new URLSearchParams({
      client_id: config.META_FACEBOOK_APP_ID,
      redirect_uri: redirectUri,
      scope: 'pages_show_list,pages_read_engagement,pages_manage_posts',
    });
    return reply.redirect(
      `https://www.facebook.com/${config.META_GRAPH_API_VERSION}/dialog/oauth?${params.toString()}`
    );
  });

  fastify.get('/facebook/callback', async (request, reply) => {
    const query = request.query as { code?: string; error?: string; error_description?: string };
    if (query.error) {
      return reply.status(400).send({ error: query.error, error_description: query.error_description });
    }
    if (!query.code) {
      return reply.status(400).send({ error: 'Missing code parameter' });
    }
    const redirectUri = callbackUrl(request, '/auth/facebook/callback');
    try {
      const { accessToken: shortToken } = await graphApi.exchangeFacebookCode(query.code, redirectUri);
      const { accessToken, expiresIn } = await graphApi.refreshFacebookToken(shortToken);
      const pages = await graphApi.getFacebookPages(accessToken);
      const tokenExpiresAt = now() + expiresIn;

      const registered: { id: string; platform: 'facebook'; external_id: string; name: string; token_expires_at: number }[] = [];
      for (const page of pages) {
        const { id } = await createAccount({
          platform: 'facebook',
          externalId: page.id,
          name: page.name,
          accessToken,
          tokenExpiresAt,
        });
        registered.push({ id, platform: 'facebook', external_id: page.id, name: page.name, token_expires_at: tokenExpiresAt });
      }

      return reply.status(201).send({ accounts: registered });
    } catch (err: any) {
      return reply.status(502).send({ error: err.message });
    }
  });
};
