# ADR 001 — Preserve login modes and require scoped service context

Status: implementation choice following the plan's recommendation; operator must confirm the Meta product configuration before rollout.

Preserve Instagram Login for Instagram and Facebook Login for Pages. Do not revoke existing credentials or change apps. Keep the configured Graph version, default v21.0, until every enabled operation is validated against a supported version in the actual app.

A shared API key identifies Tiko, and an HMAC context identifies agency/client/user/session. Tiko signs only server-derived IDs. Separate asset identity from connection credentials and client grants. Global legacy credentials cannot establish ownership. Assign explicitly, retaining all IDs and historical statuses.

Alternative: user-scoped asymmetric JWTs allow more independent issuers and rotation but require key distribution infrastructure. The current single trusted service uses separate context and event HMAC secrets. Rotate keys in a coordinated maintenance window; expire contexts within five minutes.

Uncertain remote mutations fail closed into reconciliation; automatic retry risks duplicate public content. Format flags default off because mocked HTTP does not meet the required real-account verification gate.
