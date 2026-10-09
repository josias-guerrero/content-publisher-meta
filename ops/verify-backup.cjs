"use strict";
if (!process.argv[2])
  throw new Error(
    "Usage: node ops/verify-backup.cjs BACKUP_DIRECTORY_WITH_MANIFEST",
  );
console.log(
  JSON.stringify(require("./runtime.cjs").verifyBackup(process.argv[2])),
);
