import { randomUUID } from "node:crypto";
import { sqlite } from "./db/index.js";
import { signature, contexts, type Context } from "./security/context.js";
import { config } from "./config.js";
import { encrypt } from "./lib/crypto.js";
export const tenant: Context = {
  agencyId: "agency-a",
  clientId: "client-a",
  userId: "user-a",
  sessionId: "session-browser-a-12345",
  role: "admin",
  expiresAt: 0,
};
export function headers(
  method: string,
  path: string,
  c: Partial<Context> = {},
) {
  const payload = Buffer.from(
    JSON.stringify({
      ...tenant,
      ...c,
      expiresAt: Math.floor(Date.now() / 1000) + 120,
    }),
  ).toString("base64url");
  return {
    "x-api-key": config.API_KEY!,
    "x-publisher-context": `${payload}.${signature(`${method}\n${path}\n${payload}`, config.CONTEXT_SIGNING_SECRET!)}`,
  };
}
export function inContext<T>(fn: () => T, c: Partial<Context> = {}) {
  return contexts.run({ ...tenant, ...c }, fn);
}
export function clear() {
  for (const table of [
    "outbox",
    "audit",
    "deletion_targets",
    "deletion_scopes",
    "deletion_requests",
    "idempotency",
    "post_ownership",
    "posts",
    "oauth_sessions",
    "grants",
    "connections",
    "accounts",
  ])
    sqlite.prepare(`DELETE FROM ${table}`).run();
}
export function fixture(platform = "instagram") {
  const account = randomUUID(),
    connection = randomUUID(),
    grant = randomUUID(),
    now = Math.floor(Date.now() / 1000);
  sqlite
    .prepare(
      "INSERT INTO accounts(id,platform,external_id,name,access_token,token_expires_at,created_at) VALUES(?,?,?,?,?,?,?)",
    )
    .run(account, platform, "external-1", "Test account", "", 0, now);
  sqlite
    .prepare(
      "INSERT INTO connections(id,agency_id,provider,login_mode,app_id,subject_id,scopes,token,token_type,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      connection,
      tenant.agencyId,
      platform,
      `${platform}_login`,
      platform === "instagram"
        ? config.META_INSTAGRAM_APP_ID
        : config.META_FACEBOOK_APP_ID!,
      "subject-1",
      "[]",
      encrypt("fake-token"),
      platform === "instagram" ? "instagram" : "user",
      now + 86400,
      now,
      now,
    );
  sqlite
    .prepare("INSERT INTO grants VALUES(?,?,?,?,?,?,?,?)")
    .run(
      grant,
      account,
      connection,
      tenant.agencyId,
      tenant.clientId,
      encrypt("fake-token"),
      platform === "instagram" ? "instagram" : "page",
      JSON.stringify({ accountType: "BUSINESS" }),
    );
  return { account, connection, grant };
}
export function job(
  f: ReturnType<typeof fixture>,
  media = ["https://media.example.test/a.jpg"],
  type = "post",
) {
  const id = randomUUID(),
    now = Math.floor(Date.now() / 1000);
  sqlite
    .prepare(
      "INSERT INTO posts(id,account_id,media_urls,type,scheduled_at,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
    )
    .run(
      id,
      f.account,
      JSON.stringify(media),
      type,
      now - 1,
      "pending",
      now,
      now,
    );
  sqlite
    .prepare("INSERT INTO post_ownership VALUES(?,?,?,?)")
    .run(id, tenant.agencyId, tenant.clientId, f.grant);
  return id;
}
