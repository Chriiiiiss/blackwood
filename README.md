# Hotel Blackwood

Halloween 2026 web-app monorepo: a React/Vite frontend and Fastify API in
TypeScript, with PostgreSQL in Docker and Drizzle in the backend. The invitations
API saves responses in PostgreSQL and supports retrieval and edits using a
browser-held identifier. The frontend currently contains a placeholder page;
the mobile form is covered by ENG-31.

## Initialization status

The scaffold is installed with a generated `pnpm-lock.yaml`. On October 9, 2026,
lint, type checks, seven unit tests, the PostgreSQL integration test and both
application builds passed. Local verification also covered Compose healthcheck
waiting, migrations on an empty database, persistence after Compose restart,
frontend/API startup, the Vite proxy, frontend HMR, backend reload and Studio SQL
access. Temporary verification data was removed.

Git is initialized with the GitHub remote configured and the scaffold committed.
A fresh Git clone passed `pnpm install --frozen-lockfile`, migrations, integration
testing and frontend/API startup through the Vite proxy, using a separate new
PostgreSQL volume. That verification volume was removed, and the original local
database was restarted with its data preserved.

Invitation persistence was verified on October 9, 2026: lint, types, 12 unit tests,
PostgreSQL integration (including six invitation scenarios) and both builds pass.
Verification covers edits, concurrent retries, validation, API restart persistence
and reading an API-created response through Studio. Temporary verification rows
were removed. The invitation migration is applied to the local database.

## Prerequisites

- Node.js **24.21.0**, pinned in `.nvmrc`; with nvm: `nvm install && nvm use`.
- pnpm **10.28.2**, pinned in `packageManager`. With Corepack already installed:
  run `corepack enable`, then `pnpm --version` from this directory.
- Docker with Compose v2 and a running engine, such as Docker Desktop.

Development uses local ports 5173 (web), 3000 (API), 5432 (PostgreSQL)
and 4983 (Studio). Make sure they are available.

## Local setup

```sh
cp .env.example .env
pnpm install --frozen-lockfile
pnpm db:up
pnpm db:migrate
pnpm dev
```

Open [the frontend](http://127.0.0.1:5173). Vite forwards `/api` to the API.
Check the healthcheck through this proxy:

```sh
curl --fail http://127.0.0.1:5173/api/health
```

The expected response is `{"status":"ok"}`. The API queries PostgreSQL at startup
and on every healthcheck request. An unreachable database prevents startup; an
outage after startup returns HTTP 503.

`pnpm dev` waits for the Docker healthcheck before starting both applications.
Vite reloads the frontend; `node --watch` restarts the backend. Node 24 runs the
backend TypeScript directly. `tsc` checks types and builds JavaScript, rewriting
`.ts` imports to `.js`.

## Commands

Biome handles linting and formatting. `pnpm check` also checks TypeScript types.

| Command | Effect |
| --- | --- |
| `pnpm dev` | Waits for PostgreSQL, then starts web and API with live reload |
| `pnpm db:up` | Starts PostgreSQL and waits until it is ready |
| `pnpm db:down` | Stops Compose while preserving the volume |
| `pnpm db:logs` | Follows PostgreSQL logs |
| `pnpm db:generate` | Generates SQL from the Drizzle schema |
| `pnpm db:migrate` | Applies pending migrations |
| `pnpm db:studio` | Starts Studio on `127.0.0.1:4983` |
| `pnpm check` | Checks formatting, lint and types |
| `pnpm format` | Applies formatting and safe fixes |
| `pnpm test` | Tests configuration, healthcheck, invitation validation, errors and pool shutdown |
| `pnpm test:db` | Waits for PostgreSQL, applies migrations and tests persistence, updates and concurrent submissions |
| `pnpm build` | Builds both applications in their `dist/` directories |

To run the compiled API: `pnpm --filter @blackwood/api start`.
To preview the compiled frontend: `pnpm --filter @blackwood/web preview`.
The `/api` proxy is a development setting; these commands do not provide a
complete deployment.

## Configuration and data

`.env` is local and ignored by Git. `.env.example` documents the variables:

- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` configure the container.
- `DATABASE_URL` configures the API and Drizzle; keep this URL consistent with
  the container credentials. Example values are for local development.
- `API_PORT` is shared by the API and Vite proxy; its default is 3000.

The API and Drizzle load the root `.env` regardless of their working directory.
Existing process environment variables take precedence. The API validates the
PostgreSQL URL and port before opening a connection. Secrets stay in the backend.
Changing credentials in `.env` does not change users in a database already
initialized in the volume.

PostgreSQL uses the `postgres:18.6-trixie` image, port `127.0.0.1:5432` and the
`postgres_data` named volume, mounted at `/var/lib/postgresql` for PostgreSQL 18.
The backend owns one `pg` pool, closed when Fastify shuts down.

## Schema and migrations

`apps/api/src/db/schema.ts` defines `invitation_responses`: a UUID primary key,
first name, attendance (`yes`, `no`, `to_confirm`), a boolean +1, optional ideas,
and creation/update timestamps. The first migration creates this table and its
attendance enum. SQL constraints enforce a nonempty name, text limits and no +1
when attendance is `no`. Names are not unique: different guests may share a name.

The workflow is: update the schema, run `pnpm db:generate`, review the SQL, run
`pnpm db:migrate`, then commit the schema, SQL and metadata in `apps/api/drizzle/`.
Do not use `push`. A migration applied to a shared environment is immutable;
corrections require a new migration.

To check persistence locally, create test data in Studio, run `pnpm db:down`
and `pnpm db:up`, then find the data again in Studio. The volume is preserved;
resetting it must be a separate, explicit action.

## Invitations API

Both routes use `/api/invitation-responses/:id`, where `id` is a random UUID v4.

| Method | Behavior |
| --- | --- |
| `PUT` | Creates or replaces the response for this identifier; returns HTTP 200 with the saved fields |
| `GET` | Returns this response, or HTTP 404 with `RESPONSE_NOT_FOUND` |

Example request body:

```json
{
  "firstName": "Chris",
  "attendance": "to_confirm",
  "plusOne": true,
  "ideas": "A haunted lobby!"
}
```

The server trims the first name before validating its 1–50 character length.
Attendance is required. `plusOne` must be a boolean and is required for `yes`
and `to_confirm`; for `no`, it may be omitted and is always saved as `false`.
`ideas` is an optional string of at most 1,000 characters; omitted, empty or
whitespace-only values are saved as `null`. Other idea text is preserved.
Lengths count Unicode code points. Unknown fields and incorrect JSON types are
rejected, without coercion. A success response contains `id` and the four fields
above; its `ideas` value can be `null`.

Invalid fields return HTTP 400, for example:

```json
{
  "code": "VALIDATION_ERROR",
  "message": "Please check your response.",
  "errors": [{ "field": "plusOne", "message": "must have required property 'plusOne'" }]
}
```

Malformed JSON returns HTTP 400 with `INVALID_REQUEST`. Database failures return
HTTP 500 with `RESPONSE_UNAVAILABLE`, without SQL or connection details. Invitation
responses include `Cache-Control: no-store`.

For ENG-31, generate an identifier with `crypto.randomUUID()` and keep it in
browser storage **before the first request**. Reuse it for retries, reloads and
edits. A single atomic PostgreSQL upsert prevents duplicate rows, including
concurrent first submissions or retries after a lost HTTP response. A new browser
identifier creates a new row; responses are never merged by first name. Retrieve
the saved response with `GET` to prefill the form. After switching attendance to
`no`, the frontend must clear the +1 choice and require a fresh choice if attendance
returns to `yes` or `to_confirm`, as specified in ENG-27.

The UUID acts as the secret granting read/write access to one response; keep it
out of the shared invitation link. There is no collection read route, name search,
admin API or separate +1 registration. Chris inspects rows directly in Studio.
This implements the browser identifier rule from
[ENG-27](https://linear.app/chriiiss/issue/ENG-27), with the validated rules in
[Form and user flow](https://app.notion.com/p/3f3fb89423768104a23dde016e2db5ae).

## Local database inspection

After `pnpm db:up`, run `pnpm db:studio`, then open
[Drizzle Studio](https://local.drizzle.studio). Studio listens only on
`127.0.0.1:4983`. Open `invitation_responses` to inspect responses, including the
timestamps. Remote access to actual responses will be defined with hosting.

## Structure and references

```text
apps/web/                React, Vite, placeholder page
apps/api/src/app.ts      Fastify construction without opening a port
apps/api/src/server.ts   Configuration, startup, shutdown
apps/api/src/config/     Environment loading and validation
apps/api/src/db/         Pool, Drizzle access and schema
apps/api/src/modules/    Invitations API routes and validation
apps/api/test/           Unit tests and PostgreSQL integration
apps/api/drizzle/        Migration SQL and metadata
compose.yaml            Local PostgreSQL
```

Reusable components and web features will be added in `apps/web/src/components/`
and `features/` when there is concrete content for them.

[Notion Web-app](https://app.notion.com/p/3f3fb8942376814c915ffc15aafc6b53) holds the
specifications; [Technical architecture](https://app.notion.com/p/3f3fb8942376815e9962da234554ed5a)
holds decisions. [ENG-29](https://linear.app/chriiiss/issue/ENG-29) tracks
initialization and its acceptance criteria.
[ENG-30](https://linear.app/chriiiss/issue/ENG-30) covers invitation persistence.

Official references: [TypeBox/Fastify](https://github.com/fastify/fastify-type-provider-typebox),
[Drizzle/PostgreSQL](https://orm.drizzle.team/docs/get-started/postgresql-new),
[PostgreSQL image](https://hub.docker.com/_/postgres),
[TypeScript in Node](https://nodejs.org/api/typescript.html).
