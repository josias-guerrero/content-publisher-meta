import fastify from "fastify";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { config } from "./config.js";
import { sqlite } from "./db/index.js";
import apiKeyMiddleware from "./middleware/api-key.js";
import { accountsRoutes } from "./modules/accounts/accounts.routes.js";
import { postsRoutes } from "./modules/posts/posts.routes.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { connectionsRoutes } from "./modules/connections/connections.routes.js";
import { metaCallbackRoutes } from "./modules/meta-callbacks/routes.js";
import { startScheduler, drainScheduler } from "./jobs/scheduler.js";
import {
  startTokenRefreshJob,
  drainTokenRefresh,
} from "./jobs/token-refresh.js";
import { logger } from "./lib/logger.js";
import { AppError } from "./lib/errors.js";
import { replayDeletions } from "./modules/meta-callbacks/deletion.js";
import { MetaApiError } from "./meta/graph-api.js";
export function buildApp() {
  const app = fastify({
    loggerInstance: logger,
    trustProxy: config.TRUST_PROXY ? config.TRUST_PROXY.split(",") : false,
    genReqId: () => randomUUID(),
    requestTimeout: 30000,
    bodyLimit: 65536,
  });
  app.setErrorHandler((err, req, reply) => {
    const status =
      err instanceof AppError
        ? err.statusCode
        : err instanceof ZodError
          ? 400
          : err instanceof MetaApiError
            ? err.type === "RATE"
              ? 429
              : 502
            : 500;
    reply.code(status).send({
      error: {
        code:
          err instanceof AppError
            ? err.code
            : err instanceof ZodError
              ? "VALIDATION_ERROR"
              : err instanceof MetaApiError
                ? `META_${err.type}`
                : "INTERNAL_ERROR",
        message:
          err instanceof AppError
            ? err.message
            : err instanceof ZodError
              ? "Invalid request"
              : "Request could not be completed",
        retryable:
          err instanceof AppError || err instanceof MetaApiError
            ? err.retryable
            : false,
        requestId: req.id,
      },
    });
  });
  app.addHook("onSend", async (req, reply, payload) => {
    reply.header("x-request-id", req.id);
    return payload;
  });
  app.register(apiKeyMiddleware);
  app.register(authRoutes, { prefix: "/auth" });
  app.register(accountsRoutes, { prefix: "/accounts" });
  app.register(postsRoutes, { prefix: "/posts" });
  app.register(connectionsRoutes, { prefix: "/connections" });
  app.register(metaCallbackRoutes);
  app.get("/health", async () => ({ status: "ok" }));
  app.get("/ready", async () => {
    if (
      !sqlite
        .prepare("SELECT version FROM publisher_migrations WHERE version=6")
        .get()
    )
      throw new AppError(503, "NOT_READY", "Database migration required", true);
    return { status: "ready" };
  });
  app.get("/metrics", async () => ({
    jobs: sqlite
      .prepare("SELECT status,count(*) count FROM posts GROUP BY status")
      .all(),
    pendingEvents: (
      sqlite
        .prepare("SELECT count(*) count FROM outbox WHERE delivered_at IS NULL")
        .get() as any
    ).count,
  }));
  return app;
}
async function start() {
  if (
    !sqlite
      .prepare("SELECT version FROM publisher_migrations WHERE version=6")
      .get()
  )
    throw new Error("Run reviewed migration before starting");
  replayDeletions();
  const app = buildApp();
  await app.listen({ host: config.HOST, port: config.PORT });
  const tasks =
    config.WORKERS_ENABLED === "true"
      ? [startScheduler(), startTokenRefreshJob()]
      : [];
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    for (const t of tasks) await t.stop();
    await app.close();
    await drainScheduler();
    await drainTokenRefresh();
    sqlite.close();
  };
  process.once("SIGTERM", () => void stop());
  process.once("SIGINT", () => void stop());
}
if (process.env.NODE_ENV !== "test")
  start().catch((err) => {
    logger.error({ err }, "Startup failed");
    process.exitCode = 1;
  });
