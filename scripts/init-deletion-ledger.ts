import { openSync, closeSync, fsyncSync } from "node:fs";
import { config } from "../src/config.js";
if (process.argv[2] !== "--new-installation" || !config.DELETION_LEDGER_PATH)
  throw new Error(
    "Only for a new installation: set DELETION_LEDGER_PATH, then pass --new-installation. Restore requires the existing independent journal.",
  );
const fd = openSync(config.DELETION_LEDGER_PATH, "wx", 0o600);
fsyncSync(fd);
closeSync(fd);
console.log(
  "Independent deletion ledger initialized; keep it outside database backup/restore volumes.",
);
