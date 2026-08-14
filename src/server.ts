import fastify from 'fastify';
import { config } from './config.js';
import apiKeyMiddleware from './middleware/api-key.js';
import { accountsRoutes } from './modules/accounts/accounts.routes.js';
import { postsRoutes } from './modules/posts/posts.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { startScheduler } from './jobs/scheduler.js';
import { startTokenRefreshJob } from './jobs/token-refresh.js';
import { logger } from './lib/logger.js';

const app = fastify({
  loggerInstance: logger,
  trustProxy: true,
});

// Middleware
app.register(apiKeyMiddleware);

// Routes
app.register(authRoutes, { prefix: '/auth' });
app.register(accountsRoutes, { prefix: '/accounts' });
app.register(postsRoutes, { prefix: '/posts' });

app.get('/health', async () => {
  return { status: 'ok', version: process.env.npm_package_version || '1.0.0' };
});

const start = async () => {
  try {
    // Start background jobs
    startScheduler();
    startTokenRefreshJob();
    
    await app.listen({ host: config.HOST, port: config.PORT });
    app.log.info(`🚀 Server running at http://${config.HOST}:${config.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
