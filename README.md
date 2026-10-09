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
| `pnpm test:db` | Starts PostgreSQL, applies migrations and runs integration tests |
| `pnpm build` | Builds web and API in their `dist/` directories |

Run the compiled API with `pnpm --filter @blackwood/api start` and preview the
frontend with `pnpm --filter @blackwood/web preview`. The API proxy is configured
for development only.

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
