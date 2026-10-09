# Tokens and encryption

AES-256-GCM with random IV and authentication tag. New ciphertext: `keyId:iv:tag:ciphertext`; legacy three-part ciphertext is still readable. TOKEN_ENCRYPTION_KEY is exactly 64 hexadecimal characters. TOKEN_ENCRYPTION_KEY_ID identifies its version. TOKEN_PREVIOUS_KEYS maps previous version IDs to hex keys; during legacy rotation use the `legacy` entry for the original key. All key values are runtime secrets.

Custody: store an independently protected backup of the key versions separately from encrypted databases, with restricted operator access and restore testing. Losing a required key makes its tokens unrecoverable. Do not delete an old key while any database backup still needs it, except as part of an explicitly approved cryptographic erasure policy.

Rotation: stop workers, create a consistent DB backup, configure new key/version plus previous keys, run `tsx scripts/rotate-tokens.ts --apply`, verify decryption on an isolated restored copy, then resume. The rewrite is one transaction and covers account legacy tokens, connections, grants and OAuth encrypted assets. Keep previous keys through the backup retention period. API/context/event/app-secret rotations are separate coordinated operations.

Instagram long-lived tokens are refreshed in the seven-day expiry window while still valid. Compare-and-set prevents a refresh result from reviving a revoked connection. Facebook user tokens may be exchanged during OAuth; scheduled indefinite refresh is not assumed. Page tokens live on grants, while authorizing user identity/token live on connections. Expired connections and explicit auth/permission errors transition to reauth_required and cancel pending jobs. Transient network failures do not revoke credentials.

States: active, reauth_required, revoked, disconnected. Revocation/disconnect preserves history and does not delete remote posts. Reconnect creates a fresh authorization and requires selection. Jobs previously cancelled are not resumed automatically.
