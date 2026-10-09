import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { config } from "../../config.js";
import { sqlite } from "../../db/index.js";
import { equal } from "../../security/context.js";
import { AppError } from "../../lib/errors.js";
import { registerRemoval } from "./deletion.js";
export function verifySignedRequest(value: string, secret: string) {
  const [sig, payload, extra] = value.split(".");
  if (
    !sig ||
    !payload ||
    extra ||
    !equal(
      sig,
      createHmac("sha256", secret).update(payload).digest("base64url"),
    )
  )
    throw new AppError(401, "INVALID_META_SIGNATURE", "Invalid signature");
  let body: any;
  try {
    body = JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch {
    throw new AppError(400, "INVALID_META_PAYLOAD", "Invalid payload");
  }
  if (
    body.algorithm !== "HMAC-SHA256" ||
    typeof body.user_id !== "string" ||
    !body.user_id ||
    !Number.isInteger(body.issued_at) ||
    body.issued_at > Math.floor(Date.now() / 1000) + 300
  )
    throw new AppError(400, "INVALID_META_PAYLOAD", "Invalid signed payload");
  return body;
}
export async function metaCallbackRoutes(app: FastifyInstance) {
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string", bodyLimit: 16384 },
    (_req, body, done) =>
      done(null, Object.fromEntries(new URLSearchParams(String(body)))),
  );
  for (const provider of ["instagram", "facebook"] as const)
    for (const action of ["deauthorize", "data-deletion"] as const) {
      app.post(`/meta/${provider}/${action}`, async (req) => {
        const secret =
            provider === "instagram"
              ? config.META_INSTAGRAM_APP_SECRET
              : config.META_FACEBOOK_APP_SECRET,
          appId =
            provider === "instagram"
              ? config.META_INSTAGRAM_APP_ID
              : config.META_FACEBOOK_APP_ID;
        if (!secret || !appId)
          throw new AppError(
            404,
            "PROVIDER_NOT_CONFIGURED",
            "Provider not configured",
          );
        const signed = (req.body as any)?.signed_request;
        if (typeof signed !== "string" || signed.length > 16000)
          throw new AppError(
            400,
            "INVALID_META_PAYLOAD",
            "signed_request required",
          );
        const body = verifySignedRequest(signed, secret);
        const row = registerRemoval(
          provider,
          appId,
          body.user_id,
          body.issued_at,
          action === "data-deletion",
        );
        if (action === "deauthorize") return { success: true };
        return {
          url: `${config.PUBLIC_BASE_URL}/data-deletion/status/${row.code}`,
          confirmation_code: row.code,
        };
      });
    }
  app.get("/data-deletion/status/:code", async (req, reply) => {
    const row = sqlite
      .prepare("SELECT status FROM deletion_requests WHERE code=?")
      .get((req.params as any).code) as any;
    reply.header("cache-control", "no-store");
    if (!row) throw new AppError(404, "REQUEST_NOT_FOUND", "Request not found");
    return { status: row.status };
  });
}
