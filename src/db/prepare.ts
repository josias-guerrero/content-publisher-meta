import Database from "better-sqlite3";
import { config } from "../config.js";
import { migrate } from "./migrate.js";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
if (config.DATABASE_PATH !== ":memory:")
  mkdirSync(dirname(config.DATABASE_PATH), { recursive: true, mode: 0o700 });
const sqlite = new Database(config.DATABASE_PATH);
sqlite.pragma("foreign_keys = ON");
if (config.DATABASE_PATH !== ":memory:") {
  const destination = `${config.DATABASE_PATH}.pre-v6-${Date.now()}.bak`;
  await sqlite.backup(destination);
  const copy = new Database(destination, { readonly: true });
  if (copy.pragma("integrity_check", { simple: true }) !== "ok")
    throw new Error("Backup integrity check failed");
  copy.close();
}
migrate(sqlite);
if (sqlite.pragma("integrity_check", { simple: true }) !== "ok")
  throw new Error("Migration integrity check failed");
sqlite.close();
