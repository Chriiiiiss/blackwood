# Development

[Back to the project README](../README.md)

Local configuration, application structure, routing and database workflow.

## Code organization

```text
apps/web/
  src/routes/                # Typed, file-based page composition
  src/features/              # Guest, organizer and TV interfaces by domain
  src/components/            # Shared interface components
  src/lib/                   # Small browser utilities
  test/                      # Browser flows and accessibility checks
  test-production/           # Real container and persistence checks
apps/api/
  src/config/                # Validated environment configuration
  src/db/                    # Connection, schema and migration entry point
  src/modules/               # Domain routes, schemas, services and repositories
  drizzle/                   # Committed SQL migrations and metadata
  test/                      # Unit and database integration tests
```

The web app composes features through their entry points. Invitation state and
side effects stay in the lifecycle hook; rendering components handle markup and
focus. TanStack Query manages server reads, mutations and the in-memory cache
through the application provider. The model has no React, network or
browser-storage dependency. HTTP and storage adapters remain separate so
persistence rules do not depend on rendering or decorative effects.

### Frontend routing

TanStack Router uses file-based routes in `apps/web/src/routes/`. `__root.tsx`
defines the shared shell and unknown-page component; `index.tsx` gates the hub
at `/`, and `invitation.tsx` composes the invitation feature. Keep route files
focused on composition and put domain components, requests and state in
`features/`. Internal navigation uses
the router's typed `Link` API. A root route context exposes the same `queryClient`
instance used by `QueryClientProvider`, ready for future route loaders.

The Vite router plugin generates `apps/web/src/routeTree.gen.ts` during development
and builds. This generated file and the `.tanstack/` working directory are ignored
by Git; Biome also excludes the generated file. Do not edit it manually. The web
`typecheck` command runs the generator before TypeScript, so `pnpm check` and
`pnpm build` work immediately after a fresh `pnpm install --frozen-lockfile`.
To generate the tree alone, run `pnpm --filter @blackwood/web routes:generate`.
Shared generator settings live in `apps/web/tsr.config.json`.

Vite serves the app for direct frontend URLs in development. Production Caddy's
existing `try_files` fallback serves `index.html`, then the router displays either
the matching page or the French unknown-page message. Caddy handles `/api` and
`/api/*` separately through Fastify and returns real 404s for missing assets.
`pnpm test:web` covers internal navigation, browser history, unknown URLs and
reloads alongside the invitation flow. `pnpm test:production` verifies the same
fallback with Caddy and the real API in isolated local containers.

Reference: [TanStack Router Vite integration](https://tanstack.com/router/latest/docs/installation/with-vite).

Invitation queries use the response identifier as their cache key. Successful
saves update that cache directly; editing uses a separate local draft. Automatic
retries and refetches on focus or reconnect are disabled for this flow to preserve
explicit retries and prevent background reads from disrupting edits. Requests
run immediately even when the browser reports offline, so failures remain visible
and retryable instead of leaving the form paused. The 15-second timeout applies to
reads and writes. Only the response identifier is persisted in browser storage;
the query cache stays in memory.

SCSS modules live beside their owner: the site shell, invitation page, response
form and reaction. Vite scopes `.module.scss` class names to their module;
components reference them through their imported style map. The response screens
share one invitation module. Theme values, base styles and the visually hidden
utility stay global in `styles.scss`. Vite compiles SCSS with the pinned Sass
development dependency. Nesting groups component selectors. Biome checks
the supported source files; SCSS syntax is validated by the production build,
since Biome does not yet support SCSS formatting or linting.
Browser tests and their development dependencies belong to `apps/web`, with root
commands delegating to the workspace. The API retains its existing invitations
module and PostgreSQL migration workflow.

## Configuration and data

Copy `.env.example` to the root `.env`. The API, Drizzle and Compose load this
file; existing process environment variables take precedence. Keep `.env` out of
Git and database credentials out of the frontend.

`POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB` configure PostgreSQL.
`DATABASE_URL` must match these credentials. `API_PORT` configures the backend
and the Vite proxy, with a default of 3000. `API_HOST` defaults to `127.0.0.1`
for local development; containers bind to `0.0.0.0` on their private network.

`APP_ORIGIN` is the exact browser origin allowed to access the API, including
scheme and port. It defaults to `http://localhost:5173`; set it to
`http://127.0.0.1:5173` when using that address instead. Frontend requests use the
same-origin Vite proxy locally and Caddy in production, so no cross-origin CORS
permissions are issued. Requests with a different `Origin`, or a `Sec-Fetch-Site`
value of `same-site` or `cross-site`, receive 403 before accessing the database.
Requests without browser origin headers remain available to healthchecks and
command-line clients. These headers restrict browsers; they do not authenticate
clients and can be omitted or forged by scripts.

The `postgres_data` volume preserves data when Compose stops. Changing `.env`
credentials does not change users in an initialized database. Resetting data
requires a separate, explicit operation.

## HTTPS development on a phone

Organizer sessions require HTTPS outside loopback. Set `APP_ORIGIN` to the exact
HTTPS network URL and configure `DEV_TLS_CERT` and `DEV_TLS_KEY` in the root `.env`
with absolute paths to a local certificate and private key outside the repository.
The certificate must include the network hostname/IP in its subject alternative
names and its issuing authority must be trusted on the test device. Then start
Vite with `pnpm --filter @blackwood/web dev --host 0.0.0.0 --port YOUR_PORT`.
Keep the API bound to loopback and use a separate development database when
another checkout is running. These host-only TLS variables are never exposed to
the client bundle or used for production deployment. Leave both unset for HTTP
development on localhost.

## Migrations and inspection

Update `apps/api/src/db/schema.ts`, run `pnpm db:generate`, review the generated
SQL, then run `pnpm db:migrate`. Commit the schema, SQL and metadata in
`apps/api/drizzle/`. Do not use `push` or modify a migration already applied to a
shared environment; create a new migration instead.

Run `pnpm db:studio` and open [Drizzle Studio](https://local.drizzle.studio) to
inspect `invitation_responses`. Studio listens only on `127.0.0.1:4983`.

## Browser tests

Install the test browsers once, then run the frontend checks:

```sh
pnpm --filter @blackwood/web exec playwright install chromium webkit
pnpm test:web
```

The browser suite starts Vite on `127.0.0.1:5174` and simulates API responses;
PostgreSQL is not required. It covers conditional fields, validation, save and
restore failures, editing, storage, keyboard navigation and an automated
accessibility audit. `pnpm check` also type-checks these tests. Physical-phone
verification remains separate; public-link verification requires a deployed URL.
