# Backend rules

The root `AGENTS.md` also applies. Read the Notion invitations API contract before
changing request/response semantics or access rules.

## Boundaries and validation

- `app.ts` builds Fastify without opening a port; `server.ts` listens and handles
  shutdown. Validate environment configuration at startup.
- Use one `pg` pool per process and close it with Fastify. Never create a pool per
  request or feature module.
- Keep feature wiring in `modules/<feature>/index.ts`, HTTP declarations in
  `routes.ts`, TypeBox contracts in `schemas.ts`, business rules in `service.ts`,
  persistence in `repository.ts` and error translation in `errors.ts`.
- Use native Fastify validation with the installed TypeBox/provider versions.
  Reject unexpected fields and incorrect JSON types without coercion. Do not
  mix examples from `typebox` and `@sinclair/typebox`.
- Preserve first-name trimming before validation, the 50/1,000-character limits,
  attendance choices, conditional +1 requirement and normalization of absent +1
  and blank ideas. Do not silently change Unicode length semantics.

## Persistence and access

- Use parameterized Drizzle queries; never concatenate guest input into SQL or
  pass it to `sql.raw`. Keep response columns explicit and SQL checks in place.
- Preserve atomic UUID-keyed upserts and the distinction between an omitted idea
  in a full replacement and a partial update. First names are not unique keys.
- Keep invitation responses `Cache-Control: no-store`. Do not add collection
  listing, name search or admin endpoints without an explicit request.
- The random response UUID grants read/write access to one response. Treat it as
  sensitive; do not describe the design as authenticated guest accounts.
- Frontend and API share an origin. Do not open wildcard CORS permissions.
  Origin restrictions must compare the exact scheme, host and port; they are
  browser controls, not authentication against scripts or curl.
- Return actionable validation errors and generic server errors. Never expose
  SQL, stack traces or connection credentials to guests.

## Migrations and verification

Update the Drizzle schema, generate SQL, review it, then apply it in an appropriate
environment. Commit schema, SQL and metadata together. Do not use `drizzle-kit push`
in the standard workflow or edit a migration applied to a shared environment.
Production migrations require the explicit authorization defined in root rules.

Run API unit tests for validation and handler changes. Use real PostgreSQL
integration tests for persistence, constraints or migrations, with isolated data.
Root `pnpm test:db` starts local PostgreSQL and applies migrations; CI supplies
its own database and runs the workspace integration command directly. Include
type checks and the API build when changing TypeScript behavior.
