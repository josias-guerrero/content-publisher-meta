import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
} from "node:fs";
import { createHmac, timingSafeEqual } from "node:crypto";
/** Independent, append-only journal. Never restore this file from a database backup. */
export function ledger(path: string, secret: string) {
  if (secret.length < 32)
    throw new Error(
      "Deletion ledger secret must contain at least 32 characters",
    );
  const sign = (body: string) =>
    createHmac("sha256", secret).update(body).digest("hex");
  function read(): any[] {
    const raw = readFileSync(path, "utf8");
    if (raw && !raw.endsWith("\n"))
      throw new Error(
        "Incomplete deletion ledger; recover the independent journal before starting",
      );
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const entry = JSON.parse(line),
          expected = Buffer.from(sign(entry.body)),
          actual = Buffer.from(String(entry.signature));
        if (
          expected.length !== actual.length ||
          !timingSafeEqual(expected, actual)
        )
          throw new Error("Invalid deletion ledger signature");
        return JSON.parse(entry.body);
      });
  }
  function append(value: unknown) {
    // Missing journals are never silently recreated after a restore.
    if (!existsSync(path))
      throw new Error(
        "Initialize the independent deletion ledger before starting",
      );
    read();
    const body = JSON.stringify(value),
      fd = openSync(path, "a", 0o600);
    try {
      appendFileSync(
        fd,
        JSON.stringify({ body, signature: sign(body) }) + "\n",
      );
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
  return { read, append };
}
