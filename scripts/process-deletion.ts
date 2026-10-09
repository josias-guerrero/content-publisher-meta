import { readFileSync } from "node:fs";
import {
  deletionScope,
  processDeletion,
  replayDeletions,
} from "../src/modules/meta-callbacks/deletion.js";
const [id, receiptFile, backupEvidence] = process.argv.slice(2);
if (!id)
  throw new Error(
    "Usage: tsx scripts/process-deletion.ts REQUEST_ID [RECEIPTS_JSON PUBLISHER_BACKUP_EVIDENCE]",
  );
replayDeletions();
if (receiptFile)
  console.log(
    processDeletion(
      id,
      JSON.parse(readFileSync(receiptFile, "utf8")),
      backupEvidence || "",
    ),
  );
else {
  const { request, connections, scopes } = deletionScope(id);
  console.log({
    id: request.id,
    status: request.status,
    connectionIds: connections.map((c) => c.id),
    scopes,
    dryRun: true,
  });
}
