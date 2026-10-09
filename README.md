# Content Publisher API

Fastify/TypeScript publisher for Instagram Login and Facebook Pages. SQLite stores encrypted connections, explicit agency/client grants, OAuth attempts, durable publication jobs and an event outbox. This revision requires a coordinated Tiko rollout; it is not a claim of Meta approval or production readiness.

## Local development

1. Install the lockfile dependencies with `bun install --frozen-lockfile`.
2. Copy `.env.example` to `.env`; populate service/context secrets, a 64-hex AES key and app configuration. Keep credentials out of commits and build arguments.
3. Create the data directory. Run `npm run db:migrate` explicitly against an isolated database first. Existing databases receive a consistent SQLite backup before migration.
4. Assign legacy ownership explicitly with the backfill runbook. No accounts are assigned by name, and no historical jobs are replayed.
5. Run `npm run dev`. Workers and unverified formats are disabled by default. `GET /health` is public; `/ready` and `/metrics` require signed service context.

`npm test` uses isolated SQLite (memory and temporary restore files), fake credentials and simulated Meta responses. `npm run typecheck` checks production TypeScript. Tests never load the local `.env` or publish to Meta.

## Contract and operation

- [Architecture and ERD](docs/architecture.md)
- [OpenAPI](docs/openapi.yaml), [Tiko integration](docs/integration-tiko.md)
- [Configuration and operations](docs/operations.md), [migrations/backfill](docs/migrations.md)
- [Meta setup](docs/meta-setup.md), [external endpoints](docs/meta-endpoints.md), [media formats](docs/media-formats.md)
- [Tokens and rotation](docs/token-lifecycle.md), [data deletion](docs/data-deletion.md)
- [Testing](docs/testing.md), [App Review evidence](docs/app-review.md), [delivery status](docs/implementation-status.md)

Private requests require `X-API-Key` plus signed `X-Publisher-Context`. Only explicit health, ticketed OAuth, state-protected callbacks and signed Meta callbacks are public. Responses never contain tokens. A ready container is not a published post; uncertain mutations enter `reconciling` and are never blindly retried.

All formats are implemented behind operator-controlled verification gates. Real permission/format evidence, staging E2E, production restore, retention decisions and reviewer credentials remain external acceptance gates. This change does not deploy or submit the Meta apps.

## Probar esta implementación

Seguir la [guía paso a paso en español](docs/guia-pruebas.md). Empezar por pruebas locales y dos previews HTTPS con bases nuevas; publicar únicamente en activos designados de staging. `npm run check:staging` revisa prerrequisitos locales sin publicar.

Para configurar los recursos tú mismo con repositorios privados, consultar la [guía manual de Coolify y GitHub App](docs/guia-coolify-manual.md), con ambos bloques de variables y la decisión de almacenamiento.
