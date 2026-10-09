# Hotel Blackwood

Invitation web-app built with React, Vite, Fastify and PostgreSQL in a pnpm
workspaces monorepo. Application code runs on the host; PostgreSQL runs in Docker.

## Prerequisites

- Node.js: use the version in `.nvmrc` (`nvm install && nvm use`).
- pnpm: use the version in `package.json` under `packageManager`.
- Docker with Compose v2 and a running engine.

## Local setup

```sh
cp .env.example .env
pnpm install --frozen-lockfile
pnpm db:up
pnpm db:migrate
pnpm dev
```

Open [the frontend](http://127.0.0.1:5173). Vite proxies `/api` to the backend.
`pnpm dev` waits for the PostgreSQL healthcheck and starts both applications with
live reload.

| Service | Local address |
| --- | --- |
| Web | `http://127.0.0.1:5173` |
| API | `http://127.0.0.1:3000` |
| PostgreSQL | `127.0.0.1:5432` |
| Studio | `127.0.0.1:4983` |

Check application and database connectivity:

```sh
curl --fail http://127.0.0.1:5173/api/health
```

Expected response: `{"status":"ok"}`.

## Commands

| Command | Effect |
| --- | --- |
| `pnpm dev` | Starts PostgreSQL, web and API with live reload |
| `pnpm db:up` | Starts PostgreSQL and waits for its healthcheck |
| `pnpm db:down` | Stops Compose and preserves data |
| `pnpm db:logs` | Follows PostgreSQL logs |
| `pnpm db:generate` | Generates SQL migrations from the Drizzle schema |
| `pnpm db:migrate` | Applies pending migrations |
| `pnpm db:studio` | Starts the local database interface |
| `pnpm check` | Checks formatting, lint and types |
| `pnpm format` | Applies formatting and safe lint fixes |
| `pnpm test` | Runs unit tests |
| `pnpm test:web` | Tests the invitation form in Chromium and mobile WebKit |
| `pnpm test:db` | Starts PostgreSQL, applies migrations and runs integration tests |
| `pnpm build` | Builds web and API in their `dist/` directories |

Run the compiled API with `pnpm --filter @blackwood/api start` and preview the
frontend with `pnpm --filter @blackwood/web preview`. The API proxy is configured
for development only.

## Continuous integration

GitHub Actions runs `.github/workflows/ci.yml` for pull requests, pushes to `main`
and manual runs. The workflow uses the Node.js and pnpm versions declared in the
repository and installs dependencies with the frozen lockfile.

The job checks formatting, lint and types, runs API unit tests, applies migrations
to an empty PostgreSQL 18.6 service, runs database integration tests, tests the
form in Chromium and mobile WebKit, and builds both applications. The temporary
database uses CI-only credentials and is discarded with the runner. No production
secrets or deployment access are required. Browser failure traces are retained
for seven days. Superseded runs on the same pull request or branch are cancelled.

The workflow calls the API integration-test command directly because GitHub
provides PostgreSQL as a service; the root `pnpm test:db` command starts local
Docker Compose instead. CI verifies the application and does not deploy it.

## Invitation form

The interface is in French and uses a dark theme.
The home page collects a first name, attendance, a conditional +1 choice and an
optional idea. A saved response can be reopened with **Modifier ma réponse** in the
same browser. The browser stores only its random response identifier; another
browser creates a separate response, even for the same first name.

The form uses the existing invitations API through the Vite proxy. Failed saves
preserve the draft and reuse the identifier on retry. Browser storage must be
available so a saved response can be recovered after a reload.

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

## Code organization

```text
apps/web/
  src/
    App.tsx                       # Site header, footer and page composition
    App.module.scss               # Scoped site shell styles
    query-client.ts               # Shared in-memory TanStack Query client
    styles.scss                   # Theme variables, base styles and accessibility utilities
    features/invitations/
      index.ts                    # Feature entry point
      InvitationPage.tsx          # Invitation introduction and layout
      InvitationPage.module.scss  # Scoped page layout styles
      InvitationResponse.tsx      # Loading, form and confirmation screens
      InvitationForm.tsx          # Fields and accessible form interactions
      InvitationConfirmation.tsx  # Saved response summary
      invitations.module.scss     # Scoped form, loading and confirmation styles
      useInvitationResponse.ts    # Server state and local form draft coordination
      model.ts                    # Types, validation and input/response conversion
      queries.ts                  # Query keys, read options and save mutation
      requests.ts                 # HTTP requests, timeouts and response validation
      response-storage.ts         # Browser response identifier persistence
      AttendanceReaction.tsx      # Decorative reaction image
      AttendanceReaction.module.scss # Scoped reaction styles and animation
      useAttendanceReaction.ts    # Reaction timing, separate from response persistence
      assets/                     # Feature-owned images
  test/                           # Browser behavior and accessibility tests
  playwright.config.ts
apps/api/src/
  app.ts                          # Application composition without opening a port
  server.ts                       # Process startup
  config/                         # Validated environment configuration
  db/                             # Database connection and schema
  modules/invitations/             # Routes, schemas, service and repository
```

The web app composes features through their entry points. Invitation state and
side effects stay in the lifecycle hook; rendering components handle markup and
focus. TanStack Query manages server reads, mutations and the in-memory cache
through the application provider. The model has no React, network or
browser-storage dependency. HTTP and storage adapters remain separate so
persistence rules do not depend on rendering or decorative effects.

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
and the Vite proxy, with a default of 3000.

The `postgres_data` volume preserves data when Compose stops. Changing `.env`
credentials does not change users in an initialized database. Resetting data
requires a separate, explicit operation.

## Migrations and inspection

Update `apps/api/src/db/schema.ts`, run `pnpm db:generate`, review the generated
SQL, then run `pnpm db:migrate`. Commit the schema, SQL and metadata in
`apps/api/drizzle/`. Do not use `push` or modify a migration already applied to a
shared environment; create a new migration instead.

Run `pnpm db:studio` and open [Drizzle Studio](https://local.drizzle.studio) to
inspect `invitation_responses`. Studio listens only on `127.0.0.1:4983`.

## Documentation

- [Product specifications](https://app.notion.com/p/3f3fb8942376814c915ffc15aafc6b53)
- [Technical architecture](https://app.notion.com/p/3f3fb8942376815e9962da234554ed5a)
- [Invitations API contract](https://app.notion.com/p/3f4fb894237681eb9768ed6228782025)
