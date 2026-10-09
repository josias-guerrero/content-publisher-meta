import { sqlite } from "../src/db/index.js";
import { encrypt, decrypt } from "../src/lib/crypto.js";
if (process.argv[2] !== "--apply")
  throw new Error(
    "Back up the database, configure current and previous keys, stop workers, then pass --apply",
  );
sqlite.transaction(() => {
  for (const [table, column] of [
    ["accounts", "access_token"],
    ["connections", "token"],
    ["grants", "token"],
    ["oauth_sessions", "assets"],
  ]) {
    const rows = sqlite
      .prepare(
        `SELECT id,${column} value FROM ${table} WHERE ${column} IS NOT NULL AND ${column}<>''`,
      )
      .all() as any[];
    for (const row of rows)
      sqlite
        .prepare(`UPDATE ${table} SET ${column}=? WHERE id=?`)
        .run(encrypt(decrypt(row.value)), row.id);
  }
})();
console.log(
  "Token rotation committed; verify isolated restore before retiring previous keys.",
);
