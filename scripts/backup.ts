import { createRequire } from "node:module";
import { config } from "../src/config.js";
const { backup } = createRequire(import.meta.url)("../ops/runtime.cjs");
console.log(
  JSON.stringify(
    backup({
      database: config.DATABASE_PATH,
      journal: config.DELETION_LEDGER_PATH,
      secret: config.DELETION_LEDGER_SECRET,
      destination: process.env.BACKUP_DIRECTORY,
      keep: Number(process.env.BACKUP_KEEP || 0),
      replica: process.env.DELETION_REPLICA_DIRECTORY,
    }),
  ),
);
