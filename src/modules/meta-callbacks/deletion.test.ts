import { it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { config } from "../../config.js";
import { sqlite } from "../../db/index.js";
import { clear, fixture, job } from "../../test-helpers.js";
import {
  registerRemoval,
  processDeletion,
  replayDeletions,
  scopeDigest,
} from "./deletion.js";
import { signature } from "../../security/context.js";
let directory: string;
beforeEach(() => {
  clear();
  directory = mkdtempSync(join(tmpdir(), "deletion-restore-"));
  config.DELETION_LEDGER_PATH = join(directory, "journal");
  config.DELETION_LEDGER_SECRET = "independent-synthetic-secret-".repeat(2);
  writeFileSync(config.DELETION_LEDGER_PATH, "");
});
afterEach(() => {
  config.DELETION_LEDGER_PATH = undefined;
  config.DELETION_LEDGER_SECRET = undefined;
  rmSync(directory, { recursive: true, force: true });
});
const receipts = (id: string, postIds: string[]) => {
  const body = JSON.stringify({
    kind: "tiko.deletion.completed",
    requestId: id,
    agencyId: "agency-a",
    clientId: "client-a",
    scopeDigest: scopeDigest(postIds),
    backupEvidence: "synthetic disposition",
  });
  return [{ body, signature: signature(body, config.EVENT_SIGNING_SECRET!) }];
};
it("requires an authentic receipt for the exact post set, preserves other subjects, and prevents resurrection from a real SQLite backup", async () => {
  const first = fixture(),
    post = job(first),
    other = fixture();
  sqlite
    .prepare("UPDATE connections SET subject_id='other' WHERE id=?")
    .run(other.connection);
  const otherPost = job(other),
    backup = join(directory, "before.db");
  await sqlite.backup(backup);
  const request = registerRemoval(
    "instagram",
    config.META_INSTAGRAM_APP_ID,
    "subject-1",
    Math.floor(Date.now() / 1000),
    true,
  );
  expect(() =>
    processDeletion(request.id, receipts(request.id, [otherPost]), "evidence"),
  ).toThrow("every affected");
  const forged = receipts(request.id, [post]);
  forged[0]!.signature = "wrong";
  expect(() => processDeletion(request.id, forged, "evidence")).toThrow();
  processDeletion(
    request.id,
    receipts(request.id, [post]),
    "synthetic backups protected",
  );
  expect(
    (sqlite.prepare("SELECT media_urls FROM posts WHERE id=?").get(post) as any)
      .media_urls,
  ).toBe("[]");
  expect(
    (
      sqlite
        .prepare("SELECT token FROM connections WHERE id=?")
        .get(other.connection) as any
    ).token,
  ).not.toBe("");
  // Restore rows from the actual pre-deletion backup into the isolated singleton DB.
  const old = new Database(backup, { readonly: true });
  clear();
  for (const table of [
    "accounts",
    "connections",
    "grants",
    "posts",
    "post_ownership",
  ])
    for (const row of old.prepare(`SELECT * FROM ${table}`).all() as any[]) {
      const cols = Object.keys(row);
      sqlite
        .prepare(
          `INSERT INTO ${table}(${cols.join(",")}) VALUES(${cols.map(() => "?").join(",")})`,
        )
        .run(...Object.values(row));
    }
  old.close();
  replayDeletions();
  expect(
    sqlite
      .prepare("SELECT token,status FROM connections WHERE id=?")
      .get(first.connection) as any,
  ).toEqual({ token: "", status: "revoked" });
  expect(
    sqlite
      .prepare("SELECT status,media_urls FROM posts WHERE id=?")
      .get(post) as any,
  ).toEqual({ status: "cancelled", media_urls: "[]" });
  expect(
    (
      sqlite
        .prepare("SELECT status FROM posts WHERE id=?")
        .get(otherPost) as any
    ).status,
  ).toBe("pending");
  expect(
    (
      sqlite
        .prepare("SELECT status FROM deletion_requests WHERE id=?")
        .get(request.id) as any
    ).status,
  ).toBe("completed");
});
it("does not revoke a new authorization when an old callback is replayed; new requests receive a new confirmation", () => {
  const first = fixture(),
    now = Math.floor(Date.now() / 1000);
  const old = registerRemoval(
    "instagram",
    config.META_INSTAGRAM_APP_ID,
    "subject-1",
    now,
    true,
  );
  processDeletion(old.id, receipts(old.id, []), "backups synthetic");
  const second = fixture();
  sqlite
    .prepare("UPDATE connections SET created_at=? WHERE id=?")
    .run(now + 1, second.connection);
  expect(
    registerRemoval(
      "instagram",
      config.META_INSTAGRAM_APP_ID,
      "subject-1",
      now,
      true,
    ),
  ).toEqual(old);
  expect(
    (
      sqlite
        .prepare("SELECT status FROM connections WHERE id=?")
        .get(second.connection) as any
    ).status,
  ).toBe("active");
  const next = registerRemoval(
    "instagram",
    config.META_INSTAGRAM_APP_ID,
    "subject-1",
    now + 2,
    true,
  );
  expect(next.code).not.toBe(old.code);
});
it("fails closed when the journal is missing or altered", () => {
  fixture();
  registerRemoval(
    "instagram",
    config.META_INSTAGRAM_APP_ID,
    "subject-1",
    Math.floor(Date.now() / 1000),
    true,
  );
  const path = config.DELETION_LEDGER_PATH!,
    body = readFileSync(path, "utf8");
  writeFileSync(
    path,
    body.replace("subject", "tampered").replace("request", "tampered"),
  );
  expect(() => replayDeletions()).toThrow();
  rmSync(path);
  expect(() => replayDeletions()).toThrow();
});
