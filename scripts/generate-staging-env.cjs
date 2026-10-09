"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const output = path.resolve(process.argv[2] || ".secrets/staging");
const publisher = process.argv[3] || "https://publisher-staging.tikocloud.com",
  tiko = process.argv[4] || "https://staging.tikocloud.com";
for (const origin of [publisher, tiko]) {
  const u = new URL(origin);
  if (u.protocol !== "https:" || u.origin !== origin)
    throw new Error(
      "Use an HTTPS origin without path, credentials or trailing slash",
    );
}
const secret = () => crypto.randomBytes(32).toString("hex");
const api = secret(),
  context = secret(),
  events = secret();
const pub = `NODE_ENV=production
HOST=0.0.0.0
PORT=3000
DATABASE_PATH=/app/data/publisher.db
PUBLIC_BASE_URL=${publisher}
API_KEY=${api}
CONTEXT_SIGNING_SECRET=${context}
EVENT_SIGNING_SECRET=${events}
EVENT_DESTINATION=${tiko}/api/integrations/publisher/events
TOKEN_ENCRYPTION_KEY=${secret()}
TOKEN_ENCRYPTION_KEY_ID=v1
TOKEN_PREVIOUS_KEYS={}
META_INSTAGRAM_APP_ID=REEMPLAZAR_ID_APP_INSTAGRAM
META_INSTAGRAM_APP_SECRET=REEMPLAZAR_SECRET_APP_INSTAGRAM
META_GRAPH_API_VERSION=REEMPLAZAR_VERSION_GRAPH
META_HTTP_TIMEOUT_MS=15000
MEDIA_ALLOWED_HOSTS=${new URL(tiko).hostname}
MEDIA_MAX_BYTES=268435456
WORKERS_ENABLED=false
VERIFIED_FORMATS=
TRUST_PROXY=
LOG_LEVEL=info
STAGING_ONLY=true
BOOTSTRAP_NEW_INSTALLATION=true
DELETION_LEDGER_PATH=/deletion-ledger/events.jsonl
DELETION_LEDGER_SECRET=${secret()}
BACKUP_DIRECTORY=/backups
DELETION_REPLICA_DIRECTORY=/deletion-replica
`;
const app = `NODE_ENV=production
PORT=3005
BASE_URL=${tiko}
PUBLISHER_URL=${publisher}
PUBLISHER_API_KEY=${api}
PUBLISHER_CONTEXT_SIGNING_SECRET=${context}
PUBLISHER_EVENT_SIGNING_SECRET=${events}
MEDIA_SHARE_SIGNING_SECRET=${secret()}
TIKO_DELETION_LEDGER_PATH=/deletion-ledger/events.jsonl
TIKO_DELETION_LEDGER_SECRET=${secret()}
BOOTSTRAP_NEW_INSTALLATION=true
BACKUP_DIRECTORY=/backups
DELETION_REPLICA_DIRECTORY=/deletion-replica
RESPALDO_CARPETA=false
GOOGLE_CLIENT_ID=
GOOGLE_API_KEY=
OPENAI_API_KEY=
`;
fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
fs.mkdirSync(output, { mode: 0o700 }); // Refuse to overwrite or silently rotate an existing environment.
for (const [name, body] of [
  ["publisher.env", pub],
  ["tiko.env", app],
])
  fs.writeFileSync(path.join(output, name), body, { mode: 0o600, flag: "wx" });
console.log(
  "Created private environment files in " +
    output +
    ". Complete Meta placeholders in Coolify; never commit these files.",
);
