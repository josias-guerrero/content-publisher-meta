import { randomUUID } from 'node:crypto';
import { sqlite } from '../db/index.js';
import { config } from '../config.js';
import { signature } from '../security/context.js';
export function emit(
  eventType: string,
  scope: { agencyId: string; clientId: string },
  resource: Record<string, unknown>,
) {
  const id = randomUUID(),
    now = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({
    eventId: id,
    eventType,
    schemaVersion: 1,
    occurredAt: now,
    ...scope,
    resource,
  });
  sqlite
    .prepare(
      'INSERT INTO outbox(id,event_type,payload,created_at,next_attempt) VALUES(?,?,?,?,?)',
    )
    .run(id, eventType, body, now, now);
}
export function postEvent(id: string) {
  const p = sqlite
    .prepare(
      'SELECT p.id,p.status,p.remote_id,p.permalink,p.error_code,o.agency_id,o.client_id FROM posts p JOIN post_ownership o ON o.post_id=p.id WHERE p.id=?',
    )
    .get(id) as any;
  if (p)
    emit(
      'publication.updated',
      { agencyId: p.agency_id, clientId: p.client_id },
      {
        id: p.id,
        status: p.status,
        remoteId: p.remote_id,
        permalink: p.permalink,
        errorCode: p.error_code,
      },
    );
}
export async function deliverEvents() {
  if (!config.EVENT_DESTINATION || !config.EVENT_SIGNING_SECRET) return;
  const now = Math.floor(Date.now() / 1000);
  const rows = sqlite
    .prepare(
      'SELECT * FROM outbox WHERE delivered_at IS NULL AND next_attempt<=? AND (lease_until IS NULL OR lease_until<?) LIMIT 20',
    )
    .all(now, now) as any[];
  for (const row of rows) {
    const claim = sqlite
      .prepare(
        'UPDATE outbox SET lease_until=? WHERE id=? AND delivered_at IS NULL AND (lease_until IS NULL OR lease_until<?)',
      )
      .run(now + 60, row.id, now);
    if (!claim.changes) continue;
    try {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const res = await fetch(config.EVENT_DESTINATION, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'content-type': 'application/json',
          'x-publisher-timestamp': timestamp,
          'x-publisher-signature': signature(
            `${timestamp}.${row.payload}`,
            config.EVENT_SIGNING_SECRET,
          ),
        },
        body: row.payload,
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error('Delivery failed');
      await res.body?.cancel();
      sqlite
        .prepare('UPDATE outbox SET delivered_at=?,lease_until=NULL WHERE id=?')
        .run(now, row.id);
    } catch {
      sqlite
        .prepare(
          'UPDATE outbox SET attempts=attempts+1,next_attempt=?,lease_until=NULL WHERE id=?',
        )
        .run(
          now +
            Math.min(86400, 2 ** Math.min(row.attempts + 1, 16) * 30) +
            Math.floor(Math.random() * 30),
          row.id,
        );
    }
  }
}
