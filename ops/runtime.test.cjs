"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  { execFileSync } = require("node:child_process");
const { bootstrap, backup, verifyBackup } = require("./runtime.cjs");
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tiko-runtime-"));
  return {
    dir,
    database: path.join(dir, "data/app.db"),
    journal: path.join(dir, "ledger/events.jsonl"),
    secret: "test-key-".repeat(8),
    destination: path.join(dir, "backups"),
    replica: path.join(dir, "replica"),
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("explicit bootstrap initializes once, resumes incomplete initialization, and never replaces a missing journal", () => {
  const f = fixture();
  try {
    assert.throws(() => bootstrap(f), /new installation/);
    let runs = 0;
    const options = {
      ...f,
      enabled: true,
      initialize() {
        runs++;
        if (runs === 1) throw new Error("simulated migration failure");
        fs.writeFileSync(f.database, "test");
      },
    };
    assert.throws(() => bootstrap(options), /simulated/);
    bootstrap(options);
    bootstrap(options);
    assert.equal(runs, 2);
    fs.unlinkSync(f.journal);
    assert.throws(() => bootstrap(options), /ENOENT/);
    assert.equal(fs.existsSync(f.journal), false);
  } finally {
    f.cleanup();
  }
});
test("existing data and recovery journals are never treated as a fresh empty installation", () => {
  const f = fixture();
  try {
    fs.mkdirSync(path.dirname(f.database));
    fs.writeFileSync(f.database, "existing");
    assert.throws(() => bootstrap({ ...f, enabled: true }));
    fs.unlinkSync(f.database);
    fs.mkdirSync(path.dirname(f.journal));
    fs.writeFileSync(f.journal, "");
    assert.throws(() => bootstrap({ ...f, enabled: true }), /not empty/);
  } finally {
    f.cleanup();
  }
});
test("live WAL backup restores consistent rows and original files; missing media never creates a complete backup", () => {
  const f = fixture();
  try {
    bootstrap({ ...f, enabled: true });
    f.uploads = path.join(f.dir, "uploads");
    fs.mkdirSync(f.uploads);
    execFileSync("sqlite3", [
      f.database,
      "PRAGMA journal_mode=WAL;CREATE TABLE media(filename TEXT);CREATE TABLE clients(foto TEXT);INSERT INTO media VALUES('photo.jpg');",
    ]);
    fs.writeFileSync(path.join(f.uploads, "photo.jpg"), "synthetic-original");
    const result = backup(f),
      manifest = JSON.parse(
        fs.readFileSync(path.join(result.backup, "manifest.json")),
      );
    assert.equal(manifest.files.length, 2);
    assert.equal(verifyBackup(result.backup).verified, true);
    assert.equal(
      fs.readFileSync(path.join(result.backup, "uploads/photo.jpg"), "utf8"),
      "synthetic-original",
    );
    assert.equal(
      execFileSync(
        "sqlite3",
        [
          path.join(result.backup, "database.sqlite"),
          "SELECT filename FROM media;",
        ],
        { encoding: "utf8" },
      ).trim(),
      "photo.jpg",
    );
    fs.unlinkSync(path.join(f.uploads, "photo.jpg"));
    assert.throws(() => backup(f));
    assert.equal(
      fs.readdirSync(f.destination).filter((x) => !x.startsWith(".")).length,
      1,
    );
    assert.equal(
      fs.existsSync(path.join(f.destination, ".backup.lock")),
      false,
    );
    fs.writeFileSync(path.join(result.backup, "uploads/photo.jpg"), "tampered");
    assert.throws(() => verifyBackup(result.backup), /altered/);
  } finally {
    f.cleanup();
  }
});
test("rejects destinations inside active data and detects corrupt journals before backup", () => {
  const f = fixture();
  try {
    bootstrap({ ...f, enabled: true });
    fs.writeFileSync(f.database, "");
    assert.throws(
      () =>
        backup({
          ...f,
          destination: path.join(path.dirname(f.database), "backups"),
        }),
      /outside/,
    );
    fs.writeFileSync(f.journal, "corrupt");
    assert.throws(() => backup(f), /Incomplete/);
  } finally {
    f.cleanup();
  }
});
