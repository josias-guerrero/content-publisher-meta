import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { signature } from "../src/security/context.js";
const [mode, value] = process.argv.slice(2);
if (!["--diagnostic", "--publish"].includes(mode) || !value)
  throw new Error("Use --diagnostic ACCOUNT_ID or --publish PAYLOAD_FILE");
if (
  mode === "--publish" &&
  process.env.TEST_PUBLISH_ACK !== "I_AUTHORIZE_A_TEST_PUBLICATION"
)
  throw new Error("Explicit test publication acknowledgment required");
for (const key of [
  "TEST_PUBLISHER_URL",
  "API_KEY",
  "CONTEXT_SIGNING_SECRET",
  "TEST_AGENCY_ID",
  "TEST_CLIENT_ID",
  "TEST_USER_ID",
])
  if (!process.env[key]) throw new Error(`${key} required`);
const route =
  mode === "--diagnostic"
    ? `/accounts/${encodeURIComponent(value)}/test`
    : "/posts";
const payload = Buffer.from(
  JSON.stringify({
    agencyId: process.env.TEST_AGENCY_ID,
    clientId: process.env.TEST_CLIENT_ID,
    userId: process.env.TEST_USER_ID,
    sessionId: "designated-integration-test-session",
    role: "user",
    expiresAt: Math.floor(Date.now() / 1000) + 120,
  }),
).toString("base64url");
const result = await fetch(process.env.TEST_PUBLISHER_URL + route, {
  method: "POST",
  redirect: "error",
  headers: {
    "content-type": "application/json",
    "x-api-key": process.env.API_KEY!,
    "x-publisher-context": `${payload}.${signature(`POST\n${route}\n${payload}`, process.env.CONTEXT_SIGNING_SECRET!)}`,
    "idempotency-key": process.env.TEST_INTENT_KEY || randomUUID(),
  },
  body: mode === "--diagnostic" ? "{}" : readFileSync(value, "utf8"),
  signal: AbortSignal.timeout(30000),
});
const data = (await result.json()) as any;
console.log(
  JSON.stringify({
    timestamp: new Date().toISOString(),
    mode,
    status: result.status,
    requestId: result.headers.get("x-request-id"),
    resourceId: data.id ?? null,
    code: data.error?.code ?? null,
    published: false,
  }),
);
if (!result.ok) process.exitCode = 1;
