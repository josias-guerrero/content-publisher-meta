"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
function durable(file, value, flag = "wx") {
  const fd = fs.openSync(file, flag, 0o600);
  try {
    fs.writeFileSync(fd, value);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
function verifyJournal(file, secret) {
  if (!secret || secret.length < 32)
    throw new Error("Configure the independent journal signing secret");
  const raw = fs.readFileSync(file, "utf8");
  if (raw && !raw.endsWith("\n"))
    throw new Error("Incomplete deletion journal");
  for (const line of raw.split("\n").filter(Boolean)) {
    const record = JSON.parse(line),
      expected = Buffer.from(
        crypto.createHmac("sha256", secret).update(record.body).digest("hex"),
      ),
      actual = Buffer.from(String(record.signature));
    if (
      expected.length !== actual.length ||
      !crypto.timingSafeEqual(expected, actual)
    )
      throw new Error("Invalid deletion journal");
    JSON.parse(record.body);
  }
  return raw;
}
function bootstrap({
  database,
  journal,
  secret,
  enabled = false,
  initialize = () => {},
}) {
  if (!journal) throw new Error("Deletion journal path required");
  const dir = path.dirname(database),
    marker = path.join(dir, ".installation.json");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (path.resolve(path.dirname(journal)) === path.resolve(dir))
    throw new Error("Journal must have an independent recovery directory");
  if (fs.existsSync(marker)) {
    const state = JSON.parse(fs.readFileSync(marker, "utf8"));
    if (state.version !== 1) throw new Error("Unknown installation marker");
    verifyJournal(journal, secret); // Never recreate a missing journal, even with bootstrap enabled.
    if (state.status === "pending") {
      if (!enabled)
        throw new Error(
          "Incomplete first installation: enable BOOTSTRAP_NEW_INSTALLATION to resume",
        );
      initialize();
      durable(marker, JSON.stringify({ version: 1, status: "ready" }), "w");
    } else if (state.status !== "ready")
      throw new Error("Invalid installation marker");
    return;
  }
  if (fs.existsSync(database)) {
    verifyJournal(journal, secret); // Existing installation: migrations remain explicit.
    return;
  }
  if (!enabled)
    throw new Error(
      "For an empty new installation only, set BOOTSTRAP_NEW_INSTALLATION=true",
    );
  if (fs.readdirSync(dir).length)
    throw new Error("New installation requires an empty data directory");
  if (!secret || secret.length < 32)
    throw new Error("Journal signing secret required");
  fs.mkdirSync(path.dirname(journal), { recursive: true, mode: 0o700 });
  // Existing journal on an empty data volume means recovery, not a fresh installation.
  if (fs.readdirSync(path.dirname(journal)).length)
    throw new Error(
      "Journal directory is not empty; restore the matching data instead",
    );
  durable(journal, "");
  durable(marker, JSON.stringify({ version: 1, status: "pending" }));
  initialize();
  durable(marker, JSON.stringify({ version: 1, status: "ready" }), "w");
}
const sqlString = (value) => "'" + value.replaceAll("'", "''") + "'";
function sqlite(db, sql) {
  return execFileSync("sqlite3", ["-readonly", "-batch", db, sql], {
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 16 * 1024 * 1024,
  });
}
function digest(file) {
  const h = crypto.createHash("sha256"),
    fd = fs.openSync(file, "r"),
    buffer = Buffer.alloc(1024 * 1024);
  try {
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)))
      h.update(buffer.subarray(0, count));
    return h.digest("hex");
  } finally {
    fs.closeSync(fd);
  }
}
function backup({
  database,
  uploads,
  journal,
  secret,
  destination,
  replica,
  keep = 0,
}) {
  if (!Number.isInteger(keep) || keep < 0 || keep > 10000)
    throw new Error("BACKUP_KEEP must be an integer between 0 and 10000");
  if (!destination || !replica)
    throw new Error(
      "BACKUP_DIRECTORY and DELETION_REPLICA_DIRECTORY are required",
    );
  for (const forbidden of [
    path.dirname(database),
    uploads,
    path.dirname(journal),
  ].filter(Boolean)) {
    const base = path.resolve(forbidden) + path.sep;
    for (const target of [destination, replica])
      if ((path.resolve(target) + path.sep).startsWith(base))
        throw new Error(
          "Backup destinations must be outside active data/uploads/journal",
        );
  }
  if (path.resolve(destination) === path.resolve(replica))
    throw new Error("Deletion replica must be independent of database backups");
  if (!fs.existsSync(database)) throw new Error("Database does not exist");
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  fs.mkdirSync(replica, { recursive: true, mode: 0o700 });
  const lock = path.join(destination, ".backup.lock");
  try {
    fs.mkdirSync(lock);
  } catch {
    throw new Error(
      "Backup already running or stale lock; inspect before removing the lock",
    );
  }
  let work;
  try {
    const stamp =
      new Date().toISOString().replaceAll(":", "-") + "-" + crypto.randomUUID();
    const journalText = verifyJournal(journal, secret);
    const journalCopy = path.join(replica, stamp + ".jsonl");
    durable(journalCopy, journalText);
    work = path.join(destination, ".partial-" + stamp);
    fs.mkdirSync(work, { mode: 0o700 });
    const snapshot = path.join(work, "database.sqlite");
    sqlite(database, ".backup " + sqlString(snapshot));
    fs.chmodSync(snapshot, 0o600);
    execFileSync(
      "sqlite3",
      ["-batch", snapshot, "PRAGMA journal_mode=DELETE;"],
      { stdio: "pipe", timeout: 120000 },
    );
    if (sqlite(snapshot, "PRAGMA integrity_check;").trim() !== "ok")
      throw new Error("Backup integrity failed");
    if (sqlite(snapshot, "PRAGMA foreign_key_check;").trim())
      throw new Error("Backup foreign key check failed");
    if (uploads) {
      const output = path.join(work, "uploads");
      fs.mkdirSync(output, { mode: 0o700 });
      const names = JSON.parse(
        sqlite(
          snapshot,
          "SELECT json_group_array(filename) FROM (SELECT filename FROM media WHERE filename IS NOT NULL UNION SELECT foto AS filename FROM clients WHERE foto IS NOT NULL AND foto<>'');",
        ) || "[]",
      );
      for (const name of names) {
        if (name !== path.basename(name) || name.includes("\\"))
          throw new Error("Unsafe media filename in database");
        const source = path.join(uploads, name),
          target = path.join(output, name);
        if (!fs.lstatSync(source).isFile())
          throw new Error("Media must be a regular file");
        fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
        fs.chmodSync(target, 0o600);
        if (digest(source) !== digest(target))
          throw new Error("Media changed during backup; retry");
      }
      // Derived images are regenerable; preserve originals referenced by the DB, not arbitrary private files.
    }
    const files = [];
    function inventory(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) inventory(file);
        else
          files.push({
            path: path.relative(work, file),
            size: fs.statSync(file).size,
            sha256: digest(file),
          });
      }
    }
    inventory(work);
    durable(
      path.join(work, "manifest.json"),
      JSON.stringify(
        {
          version: 1,
          createdAt: new Date().toISOString(),
          files,
          journalReplica: path.basename(journalCopy),
          restore:
            "Keep the latest independent journal; never resume historical jobs without reconciliation. Derivatives are regenerated.",
        },
        null,
        2,
      ),
    );
    const complete = path.join(destination, stamp);
    fs.renameSync(work, complete);
    work = undefined;
    if (keep > 0) {
      const snapshots = fs
        .readdirSync(destination)
        .filter(
          (name) =>
            /^\d{4}-\d{2}-\d{2}T[\d.Z-]+-[a-f0-9-]{36}$/.test(name) &&
            fs.existsSync(path.join(destination, name, "manifest.json")),
        )
        .sort()
        .reverse();
      for (const name of snapshots.slice(keep))
        fs.rmSync(path.join(destination, name), { recursive: true });
    }
    return {
      backup: complete,
      files: files.length,
      journalReplica: journalCopy,
    };
  } finally {
    if (work) fs.rmSync(work, { recursive: true, force: true });
    fs.rmdirSync(lock);
  }
}
function verifyBackup(directory) {
  const root = path.resolve(directory),
    manifest = JSON.parse(
      fs.readFileSync(path.join(root, "manifest.json"), "utf8"),
    );
  if (manifest.version !== 1 || !Array.isArray(manifest.files))
    throw new Error("Invalid backup manifest");
  for (const record of manifest.files) {
    const file = path.resolve(root, record.path);
    if (
      !file.startsWith(root + path.sep) ||
      !fs.realpathSync(file).startsWith(fs.realpathSync(root) + path.sep) ||
      !fs.lstatSync(file).isFile() ||
      fs.statSync(file).size !== record.size ||
      digest(file) !== record.sha256
    )
      throw new Error("Backup file missing or altered");
  }
  if (!manifest.files.some((f) => f.path === "database.sqlite"))
    throw new Error("Missing database manifest entry");
  if (
    sqlite(
      path.join(root, "database.sqlite"),
      "PRAGMA integrity_check;",
    ).trim() !== "ok"
  )
    throw new Error("Invalid SQLite snapshot");
  return { verified: true, files: manifest.files.length };
}
module.exports = { bootstrap, backup, verifyJournal, verifyBackup };
