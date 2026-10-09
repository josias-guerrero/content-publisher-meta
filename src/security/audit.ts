import { randomUUID } from 'node:crypto';
import { sqlite } from '../db/index.js';
export function audit(
  actor: string,
  agencyId: string,
  action: string,
  resourceId: string,
) {
  sqlite
    .prepare('INSERT INTO audit VALUES(?,?,?,?,?,?)')
    .run(
      randomUUID(),
      actor,
      agencyId,
      action,
      resourceId,
      Math.floor(Date.now() / 1000),
    );
}
