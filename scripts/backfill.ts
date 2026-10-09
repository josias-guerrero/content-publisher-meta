import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sqlite } from "../src/db/index.js";
import { decrypt, encrypt } from "../src/lib/crypto.js";
import {
  getFacebookAssets,
  getInstagramUser,
  getFacebookUserId,
} from "../src/meta/graph-api.js";
const input = z
  .array(
    z.object({
      accountId: z.string().uuid(),
      agencyId: z.string().min(1),
      clientId: z.string().min(1),
      appId: z.string().min(1),
      subjectId: z.string().min(1),
      postIds: z.array(z.string().uuid()),
      scopes: z.array(z.string()),
    }),
  )
  .parse(JSON.parse(readFileSync(process.argv[2], "utf8")));
const prepared: {
  item: (typeof input)[number];
  a: any;
  pageToken: string;
  capabilities: Record<string, unknown>;
}[] = [];
for (const item of input) {
  const a = sqlite
    .prepare("SELECT * FROM accounts WHERE id=?")
    .get(item.accountId) as any;
  if (!a) throw new Error("Unknown account");
  const token = decrypt(a.access_token);
  let pageToken = token,
    capabilities: any = {};
  if (a.platform === "instagram") {
    const user = await getInstagramUser(token);
    if (
      String(user.userId) !== a.external_id ||
      item.subjectId !== String(user.userId)
    )
      throw new Error("Identity mismatch");
    capabilities = { accountType: user.accountType };
  } else {
    if ((await getFacebookUserId(token)) !== item.subjectId)
      throw new Error("Subject mismatch");
    const page = (await getFacebookAssets(token)).find(
      (p) => p.id === a.external_id,
    );
    if (!page) throw new Error("Page not accessible");
    pageToken = page.token;
    capabilities = { tasks: page.tasks };
  }
  prepared.push({ item, a, pageToken, capabilities });
}
if (process.argv[3] !== "--apply") {
  console.log({
    dryRun: true,
    verifiedAccounts: prepared.length,
    posts: input.reduce((n, x) => n + x.postIds.length, 0),
  });
  process.exit(0);
}
sqlite.transaction(() => {
  for (const { item, a, pageToken, capabilities } of prepared) {
    if (sqlite.prepare("SELECT id FROM grants WHERE account_id=?").get(a.id))
      throw new Error("Already mapped; inspect manually");
    const connection = randomUUID(),
      grant = randomUUID(),
      now = Math.floor(Date.now() / 1000);
    sqlite
      .prepare(
        "INSERT INTO connections(id,agency_id,provider,login_mode,app_id,subject_id,scopes,token,token_type,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        connection,
        item.agencyId,
        a.platform,
        `${a.platform}_login`,
        item.appId,
        item.subjectId,
        JSON.stringify(item.scopes),
        a.access_token,
        a.platform === "instagram" ? "instagram" : "user",
        a.token_expires_at,
        now,
        now,
      );
    sqlite
      .prepare("INSERT INTO grants VALUES(?,?,?,?,?,?,?,?)")
      .run(
        grant,
        a.id,
        connection,
        item.agencyId,
        item.clientId,
        encrypt(pageToken),
        a.platform === "instagram" ? "instagram" : "page",
        JSON.stringify(capabilities),
      );
    for (const postId of item.postIds) {
      if (
        !sqlite
          .prepare("SELECT id FROM posts WHERE id=? AND account_id=?")
          .get(postId, a.id)
      )
        throw new Error("Post/account mismatch");
      sqlite
        .prepare("INSERT INTO post_ownership VALUES(?,?,?,?)")
        .run(postId, item.agencyId, item.clientId, grant);
    }
    sqlite
      .prepare("INSERT INTO audit VALUES(?,?,?,?,?,?)")
      .run(
        randomUUID(),
        "operator",
        item.agencyId,
        "explicit-backfill",
        a.id,
        now,
      );
  }
})();
console.log({ assignedAccounts: prepared.length });
