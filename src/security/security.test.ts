import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHmac } from "node:crypto";
import Database from "better-sqlite3";
import { envSchema, config } from "../config.js";
import { migrate } from "../db/migrate.js";
import { buildApp } from "../server.js";
import { clear, fixture, job } from "../test-helpers.js";
import { sqlite } from "../db/index.js";
import { publicAddress, validateFormat } from "../meta/media.js";
import {
  processDeletion,
  scopeDigest,
} from "../modules/meta-callbacks/deletion.js";
import { refreshTokens } from "../jobs/token-refresh.js";
import * as graph from "../meta/graph-api.js";
import { signature } from "./context.js";
import { deliverEvents } from "../jobs/events.js";
vi.mock("../meta/graph-api.js", async (original) => ({
  ...(await original<any>()),
  refreshInstagramToken: vi.fn(),
}));
const signed = (secret: string, subject = "subject-1") => {
  const p = Buffer.from(
    JSON.stringify({
      algorithm: "HMAC-SHA256",
      user_id: subject,
      issued_at: Math.floor(Date.now() / 1000),
    }),
  ).toString("base64url");
  return createHmac("sha256", secret).update(p).digest("base64url") + "." + p;
};
describe("security and preservation", () => {
  beforeEach(clear);
  it("rejects missing production secrets, nonhex AES, insecure callback and URLs containing credentials", () => {
    expect(
      envSchema.safeParse({
        ...config,
        NODE_ENV: "production",
        API_KEY: undefined,
      }).success,
    ).toBe(false);
    expect(
      envSchema.safeParse({ ...config, TOKEN_ENCRYPTION_KEY: "g".repeat(64) })
        .success,
    ).toBe(false);
    expect(
      envSchema.safeParse({
        ...config,
        NODE_ENV: "production",
        PUBLIC_BASE_URL: "http://example.com",
      }).success,
    ).toBe(false);
    expect(
      envSchema.safeParse({
        ...config,
        PUBLIC_BASE_URL: "https://user:pass@example.com",
      }).success,
    ).toBe(false);
  });
  it("migration preserves historical IDs/statuses/token ciphertext, never deduplicates or requeues", () => {
    const db = new Database(":memory:");
    migrate(db);
    db.prepare("INSERT INTO accounts VALUES(?,?,?,?,?,?,?)").run(
      "old",
      "instagram",
      "external",
      "Old",
      "cipher",
      123,
      1,
    );
    db.prepare("INSERT INTO accounts VALUES(?,?,?,?,?,?,?)").run(
      "duplicate",
      "instagram",
      "external",
      "Dup",
      "cipher2",
      123,
      1,
    );
    db.prepare(
      "INSERT INTO posts(id,account_id,media_urls,status,scheduled_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
    ).run("history", "old", "[]", "published", 1, 1, 1);
    migrate(db);
    expect(db.prepare("SELECT id,status FROM posts").all()).toEqual([
      { id: "history", status: "published" },
    ]);
    expect((db.prepare("SELECT count(*) n FROM accounts").get() as any).n).toBe(
      2,
    );
    expect((db.prepare("SELECT count(*) n FROM grants").get() as any).n).toBe(
      0,
    );
    db.close();
  });
  it("invalid and wrong-provider signed requests cannot create deletion work", async () => {
    const app = buildApp();
    for (const signature of [
      "invalid",
      signed(config.META_FACEBOOK_APP_SECRET!),
    ])
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/meta/instagram/data-deletion",
            payload: { signed_request: signature },
          })
        ).statusCode,
      ).toBe(401);
    expect(
      (sqlite.prepare("SELECT count(*) n FROM deletion_requests").get() as any)
        .n,
    ).toBe(0);
    await app.close();
  });
  it("deletion callback is idempotent, cancels pending work, preserves in-flight and other subjects", async () => {
    const f = fixture(),
      id = job(f),
      app = buildApp(),
      payload =
        "signed_request=" +
        encodeURIComponent(signed(config.META_INSTAGRAM_APP_SECRET));
    const request = {
      method: "POST" as const,
      url: "/meta/instagram/data-deletion",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload,
    };
    const a = await app.inject(request),
      b = await app.inject(request);
    expect(a.statusCode).toBe(200);
    expect(a.json()).toEqual(b.json());
    expect(
      (sqlite.prepare("SELECT status FROM posts WHERE id=?").get(id) as any)
        .status,
    ).toBe("cancelled");
    const row = sqlite.prepare("SELECT id FROM deletion_requests").get() as any;
    expect(() => processDeletion(row.id, [], "")).toThrow();
    const body = JSON.stringify({
      kind: "tiko.deletion.completed",
      requestId: row.id,
      agencyId: "agency-a",
      clientId: "client-a",
      scopeDigest: scopeDigest([id]),
      backupEvidence: "synthetic backup disposition",
    });
    const receipts = [
      { body, signature: signature(body, config.EVENT_SIGNING_SECRET!) },
    ];
    sqlite.prepare("UPDATE posts SET status='publishing' WHERE id=?").run(id);
    expect(() =>
      processDeletion(
        row.id,
        receipts,
        "synthetic publisher backup disposition",
      ),
    ).toThrow();
    sqlite.prepare("UPDATE posts SET status='cancelled' WHERE id=?").run(id);
    expect(
      processDeletion(
        row.id,
        receipts,
        "synthetic publisher backup disposition",
      ).status,
    ).toBe("completed");
    expect(
      processDeletion(
        row.id,
        receipts,
        "synthetic publisher backup disposition",
      ).status,
    ).toBe("completed");
    expect(
      (
        sqlite
          .prepare("SELECT token FROM connections WHERE id=?")
          .get(f.connection) as any
      ).token,
    ).toBe("");
    await app.close();
  });
  it("expired credentials require reconnection and never use Facebook exchange as a scheduled refresh", async () => {
    const f = fixture("facebook");
    sqlite.prepare("UPDATE connections SET expires_at=1").run();
    await refreshTokens();
    expect(
      (
        sqlite
          .prepare("SELECT status FROM connections WHERE id=?")
          .get(f.connection) as any
      ).status,
    ).toBe("reauth_required");
    expect(graph.refreshInstagramToken).not.toHaveBeenCalled();
  });
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "169.254.169.254",
    "172.16.2.1",
    "192.168.1.1",
    "100.64.1.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "2001:db8::1",
  ])("blocks SSRF address %s", (ip) => expect(publicAddress(ip)).toBe(false));
  it("rejects unsupported media combinations without silently changing formats", () => {
    const image = {
      url: "https://media.example.test/a.jpg",
      mimeType: "image/jpeg",
      size: 100,
    };
    expect(() => validateFormat("instagram", "reels", [image], {})).toThrow();
    expect(() =>
      validateFormat("instagram", "story", [image], {
        accountType: "MEDIA_CREATOR",
      }),
    ).toThrow();
    expect(() =>
      validateFormat("facebook", "story", [image, image], {}),
    ).toThrow();
    expect(() =>
      validateFormat("facebook", "post", [image], {}, undefined, 100),
    ).toThrow();
  });
  it("outbox keeps failed deliveries for retry", async () => {
    const f = fixture(),
      app = buildApp();
    await app.inject({
      method: "POST",
      url: "/meta/instagram/deauthorize",
      payload: { signed_request: signed(config.META_INSTAGRAM_APP_SECRET) },
    });
    const before = (
      sqlite
        .prepare("SELECT count(*) n FROM outbox WHERE delivered_at IS NULL")
        .get() as any
    ).n;
    expect(before).toBeGreaterThan(0);
    const destination = config.EVENT_DESTINATION,
      secret = config.EVENT_SIGNING_SECRET;
    config.EVENT_DESTINATION = "https://tiko.example.test/events";
    config.EVENT_SIGNING_SECRET = "fake".repeat(10);
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Offline"));
    try {
      await deliverEvents();
      expect(
        (sqlite.prepare("SELECT attempts FROM outbox LIMIT 1").get() as any)
          .attempts,
      ).toBe(1);
    } finally {
      fetch.mockRestore();
      config.EVENT_DESTINATION = destination;
      config.EVENT_SIGNING_SECRET = secret;
      await app.close();
    }
  });
});
