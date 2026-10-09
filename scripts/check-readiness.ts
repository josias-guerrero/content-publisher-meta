import Database from "better-sqlite3";
import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { config } from "../src/config.js";
import { ledger } from "../src/security/deletion-ledger.js";
const checks: { check: string; ok: boolean; detail?: string }[] = [];
function check(name: string, fn: () => void) {
  try {
    fn();
    checks.push({ check: name, ok: true });
  } catch (e: any) {
    checks.push({ check: name, ok: false, detail: e.message });
  }
}
function need(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
check("staging isolation declaration", () => {
  need(
    process.env.STAGING_ONLY === "true",
    "Set STAGING_ONLY=true only in the isolated test deployment",
  );
  need(
    config.PUBLIC_BASE_URL.startsWith("https://"),
    "Public HTTPS required for OAuth/media",
  );
  for (const value of [config.PUBLIC_BASE_URL, config.EVENT_DESTINATION])
    if (value)
      need(
        !["publisher.tikocloud.com", "tikocloud.com"].includes(
          new URL(value).hostname,
        ),
        "Do not run this staging checklist against the known production origins",
      );
});
check("service configuration", () => {
  for (const value of [
    config.API_KEY,
    config.CONTEXT_SIGNING_SECRET,
    config.EVENT_SIGNING_SECRET,
  ])
    need(
      value && value.length >= 32,
      "Configure service, context and event secrets with at least 32 characters",
    );
  need(config.EVENT_DESTINATION, "Configure EVENT_DESTINATION");
  need(
    config.MEDIA_ALLOWED_HOSTS.split(",").includes(
      new URL(config.EVENT_DESTINATION!).hostname,
    ),
    "Include the controlled Tiko host in MEDIA_ALLOWED_HOSTS",
  );
  need(
    config.WORKERS_ENABLED === "false",
    "Keep workers disabled during preflight",
  );
});
check("ffprobe installed", () => {
  execFileSync("ffprobe", ["-version"], { stdio: "ignore", timeout: 10000 });
});
check("independent erasure journal", () => {
  need(
    config.DELETION_LEDGER_PATH && config.DELETION_LEDGER_SECRET,
    "Initialize the independent deletion ledger",
  );
  need(
    (statSync(config.DELETION_LEDGER_PATH).mode & 0o077) === 0,
    "Deletion journal must be private (mode 600)",
  );
  need(
    dirname(realpathSync(config.DELETION_LEDGER_PATH)) !==
      dirname(realpathSync(config.DATABASE_PATH)),
    "Journal and SQLite must use separate recovery locations",
  );
  ledger(config.DELETION_LEDGER_PATH, config.DELETION_LEDGER_SECRET).read();
});
check("database integrity and queue mapping", () => {
  need(
    existsSync(config.DATABASE_PATH),
    "Run the backed-up migration on staging first",
  );
  const db = new Database(config.DATABASE_PATH, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    need(
      db.prepare("SELECT 1 FROM publisher_migrations WHERE version=6").get(),
      "Migration 6 required",
    );
    need(
      db.pragma("integrity_check", { simple: true }) === "ok",
      "SQLite integrity failure",
    );
    need(
      !(db.pragma("foreign_key_check") as unknown[]).length,
      "Foreign key violations",
    );
    need(
      !db
        .prepare(
          "SELECT 1 FROM posts p LEFT JOIN post_ownership o ON o.post_id=p.id WHERE p.status IN ('pending','publishing','reconciling') AND o.post_id IS NULL LIMIT 1",
        )
        .get(),
      "Unmapped jobs require explicit reconciliation/backfill",
    );
    need(
      !db
        .prepare(
          "SELECT 1 FROM posts WHERE status IN ('publishing','reconciling') LIMIT 1",
        )
        .get(),
      "Reconcile uncertain jobs before promotion",
    );
  } finally {
    db.close();
  }
});
console.log(
  JSON.stringify(
    {
      ok: checks.every((c) => c.ok),
      checks,
      limitations:
        "Local preflight only: does not verify proxy mounts, DNS reachability, Meta permissions or publish anything.",
    },
    null,
    2,
  ),
);
if (checks.some((c) => !c.ok)) process.exitCode = 1;
