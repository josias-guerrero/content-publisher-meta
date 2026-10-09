import { createRequire } from "node:module";
import Database from "better-sqlite3";
import { config } from "../src/config.js";
import { migrate } from "../src/db/migrate.js";
const { bootstrap } = createRequire(import.meta.url)("../ops/runtime.cjs");
bootstrap({
  database: config.DATABASE_PATH,
  journal: config.DELETION_LEDGER_PATH,
  secret: config.DELETION_LEDGER_SECRET,
  enabled: process.env.BOOTSTRAP_NEW_INSTALLATION === "true",
  initialize: () => {
    const db = new Database(config.DATABASE_PATH);
    try {
      db.pragma("foreign_keys=ON");
      migrate(db);
    } finally {
      db.close();
    }
  },
});
