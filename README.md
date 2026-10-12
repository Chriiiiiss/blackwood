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
| `pnpm test:production` | Builds containers and verifies real browser submissions, persistence and backup restoration |
| `pnpm build` | Builds web and API in their `dist/` directories |

Run the compiled API with `pnpm --filter @blackwood/api start` and preview the
frontend with `pnpm --filter @blackwood/web preview`. The API proxy is configured
for development only.

## Continuous integration

GitHub Actions uses two independent workflows for pull requests and pushes to
`main`. Native path filters select the affected application. Both workflows can
also be launched manually, regardless of changed files.

| Changed files | Frontend CI | Backend CI |
| --- | --- | --- |
| `apps/web/**` | Runs | Skips |
| `apps/api/**` or `compose.yaml` | Skips | Runs |
| Both application directories | Runs | Runs |
| Shared configuration or dependencies | Runs | Runs |
| `README.md` only | Skips | Skips |

Shared files are `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc`,
`.nvmrc`, `.env.example`, `tsconfig.base.json` and `biome.json`. Editing a workflow
also runs that workflow. PR filters consider the complete diff against the base
branch, including deletions and earlier commits; push filters consider the files
changed by that push.

`ci-front.yml` checks frontend formatting, lint and types, runs Chromium and mobile
WebKit tests, and builds the frontend. It starts no database and runs no backend
tests. Browser failure traces are retained for seven days.

`ci-back.yml` checks backend formatting, lint and types, runs API unit tests,
applies migrations to an empty PostgreSQL 18.6 service, runs database integration
tests, and builds the API. It installs no browsers and runs no frontend tests.
The temporary database uses CI-only credentials and is discarded with the runner.
The workflow calls the API integration-test command directly because GitHub
provides PostgreSQL as a service; root `pnpm test:db` starts local Compose instead.

Both workflows use repository-pinned Node.js and pnpm versions, frozen lockfile
installation and read-only permissions. Superseded runs of the same workflow on
the same pull request or branch are cancelled independently. CI requires no
production secrets or deployment access and does not deploy the application.

`ci-production.yml` verifies the assembled application separately. On PRs, it runs
for deployment files (`Dockerfile`, `.dockerignore`, `compose.production.yaml`,
`deploy/**`, `.env.production.example`), either application manifest, API migrations,
shared configuration/dependencies, or its own workflow. On pushes to `main`, any
frontend or backend change also runs it. Manual runs remain available before
merging changes that affect the frontend/API contract.

The production workflow builds both runtime images and verifies real browser
submissions, edits, persistence after restart, routing/cache headers and PostgreSQL
backup restoration in an isolated Compose project. It installs only Chromium and
does not repeat the frontend browser suite or backend unit-test suite. It accesses
neither the VPS nor production secrets. An application-only PR can pass its
individual checks while an integration regression is detected after merging;
the manual production run can be used before merging when needed.

Both production jobs authenticate Docker Hub downloads before building images.
Configure the `DOCKERHUB_USERNAME` repository Actions secret with the Docker Hub
username and `DOCKERHUB_TOKEN` with a personal access token granting only **Read**
access. Create the token in Docker Hub account settings, then add both secrets
under GitHub **Settings → Secrets and variables → Actions**. Never commit the token
or use the account password. Authentication avoids relying on anonymous download
quotas shared by runner IP addresses; registry availability and abuse limits still
apply. These credentials grant no VPS access, and application images continue to
be published to GHCR with the temporary GitHub Actions token.

After successful production verification on `main`, a separate job publishes
`ghcr.io/chriiiiiss/blackwood-api:COMMIT_SHA` and
`ghcr.io/chriiiiiss/blackwood-web:COMMIT_SHA`. This job alone has package-write
permission. It uses the temporary GitHub Actions token and links the packages to
this private repository. PRs and manual runs on other branches never publish.
The full commit identifier selects a version; no mutable `latest` tag is used.

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
    router.ts                     # Typed router with the shared QueryClient in context
    routes/
      __root.tsx                  # Shared site shell and unknown-page handling
      index.tsx                   # Public invitation route at /
    routeTree.gen.ts              # Generated route types and tree, ignored by Git
    NotFoundPage.tsx               # Unknown-page message and typed return link
    NotFoundPage.module.scss       # Scoped unknown-page styles
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

### Frontend routing

TanStack Router uses file-based routes in `apps/web/src/routes/`. `__root.tsx`
defines the shared shell and unknown-page component; `index.tsx` maps `/` to the
existing invitation feature. Keep route files focused on composition and put
domain components, requests and state in `features/`. Internal navigation uses
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

## Migrations and inspection

Update `apps/api/src/db/schema.ts`, run `pnpm db:generate`, review the generated
SQL, then run `pnpm db:migrate`. Commit the schema, SQL and metadata in
`apps/api/drizzle/`. Do not use `push` or modify a migration already applied to a
shared environment; create a new migration instead.

Run `pnpm db:studio` and open [Drizzle Studio](https://local.drizzle.studio) to
inspect `invitation_responses`. Studio listens only on `127.0.0.1:4983`.

## VPS deployment

The provider firewall policy, activation steps, rollback and validation
commands are in [the network hardening runbook](deploy/network-hardening.md).
Chris confirms `vps-public` is active on `srv2048665`, including after the approved
reboot; the runbook records the completed checks and their limits. Further changes
require separate approval and hPanel access; documenting them does not authorize
production operations.

### Deployment through GitHub Actions

The production integration workflow validates and publishes images; the separate
**Deploy production** workflow installs them on the VPS. Deployment is manually
triggered so the operator chooses when the public application changes. Neither
merging a PR nor publishing an image starts a deployment automatically.

One-time VPS setup installs `deploy/remote.py` as the root-owned executable
`/usr/local/sbin/blackwood-deploy`, creates `/opt/blackwood/.env.production` with a
new database password and mode `0600`, and registers a dedicated Ed25519 public
key in root's `authorized_keys`. The key entry must use
`restrict,command="/usr/local/sbin/blackwood-deploy"`; it permits only
`deploy FULL_COMMIT_SHA`, with no interactive shell, forwarding or PTY. Existing
administrator keys remain separate. Updating the installed runner is an explicit
administrator operation when `deploy/remote.py` changes.

SSH access on `srv2048665` is key-only. The host policy lives in
`/etc/ssh/sshd_config.d/00-local-hardening.conf`:

```text
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
PermitRootLogin prohibit-password
```

Preserve this drop-in during provisioning. It is read before `50-cloud-init.conf`,
which sets `PasswordAuthentication yes` and previously overrode the later
`60-cloudimg-settings.conf`. Check the effective configuration in read-only mode:

```sh
sudo sshd -t
sudo sshd -T | grep -E '^(passwordauthentication|kbdinteractiveauthentication|pubkeyauthentication|permitrootlogin) '
```

Chris verified a new Mac key login and rejection of root password authentication
after reloading SSH. This verifies the reported SSH change, not the overall VPS
security. The deployment workflow already selects its dedicated key explicitly
with `IdentitiesOnly=yes` and `BatchMode=yes`; preserve its forced-command
restriction. [Deployment run 38303636723](https://github.com/Chriiiiiss/blackwood/actions/runs/38303636723)
successfully used the restricted key after SSH hardening and firewall activation
on 2026-10-12, deploying `a45e4636e45f8c3e4030e6cfd66c2bb0fb0890fe`.

Configure these repository settings:

| Kind | Name | Value |
| --- | --- | --- |
| Actions secret | `VPS_SSH_KEY` | Private half of the dedicated restricted key |
| Actions variable | `VPS_HOST` | `186.241.19.228` |
| Actions variable | `VPS_KNOWN_HOSTS` | Verified SSH host-key entry for the VPS |

Host keys are pinned before deployment; the workflow does not disable SSH host
verification. Database credentials stay on the VPS. A temporary Actions token
with repository/package read access is sent over SSH, used to fetch the exact
Compose file from GitHub and pull the private images, then discarded. No permanent
registry token is stored on the server.

For a release:

1. Merge reviewed code into `main` and wait for the relevant CI workflows and
   image publication to succeed. If a documentation-only commit did not trigger
   production CI, run **Production integration CI** manually on `main` first.
2. In GitHub Actions, select **Deploy production**, choose **Run workflow**, and
   keep branch `main`. The workflow refuses deployment while relevant CI is
   missing, running or failing.
3. The restricted runner verifies that the revision is still the current `main`,
   pulls both versioned images and backs up the active database before migrations.
   A failed backup or migration stops the deployment before replacing the API/web
   services. Initial deployment creates its first backup after startup.
4. Migrations run explicitly, then the API and Caddy start. After Compose reports
   readiness, `/opt/blackwood/current` selects the release and the private
   configuration records its version. GitHub verifies the public HTTPS health
   endpoint and homepage.

Releases under `/opt/blackwood/releases/COMMIT_SHA` contain the matching Compose
file and revision, with a link to the shared private environment file. The VPS
downloads images and does not compile the application. The workflow does not
automatically roll back a database migration or a partially completed service
replacement. A failed public HTTPS check also requires inspection of the running
services; it does not undo their startup.

The root-owned `blackwood-backup.service` and `blackwood-backup.timer` run the same
runner in local backup mode daily around 03:00 UTC, retaining 14 days of completed
dumps under `/opt/blackwood/backups`. Partial and empty dumps are rejected.
Deployments and backups share a lock to avoid overlapping operations. These are
on-server backups; automatic off-server storage is not configured.

Useful operator commands:

```sh
ssh root@186.241.19.228 'systemctl list-timers blackwood-backup.timer'
ssh root@186.241.19.228 'journalctl -u blackwood-backup.service --no-pager -n 30'
ssh root@186.241.19.228 '/usr/local/sbin/blackwood-deploy backup'
```

Deployment safeguards use Python's standard library, already present on the VPS.
Run `python3 -m unittest discover -s deploy -p 'test_*.py'` locally; production CI
runs the same tests before its container verification.

### Manual build reference

Production uses `compose.production.yaml`: Caddy serves the built frontend and
proxies `/api` to Fastify. Only Caddy publishes ports (80 TCP, 443 TCP/UDP).
PostgreSQL and the API remain on the Compose network. Database files and Caddy
certificates use persistent volumes, separate from local development volumes.
The API image runs as the unprivileged Node user and contains compiled code,
production dependencies and SQL migrations. Node.js and pnpm are required only
inside the build image, not on the VPS.

Search indexing is disabled by the frontend `robots` meta tag and a global
`X-Robots-Tag: noindex, nofollow` header in Caddy, including API and asset responses.
`robots.txt` allows crawling so search engines can read these directives; blocking
crawling could leave a linked URL indexed without its content. These directives
control cooperating search engines and do not restrict public access to the site.

Prerequisites: Docker Engine with Compose, an SSH-accessible server, an A record
for `halloween.sirhc.xyz` pointing to the VPS, and inbound ports 80 and 443 allowed
by the server and provider firewalls. Publish an AAAA record only if IPv6 is
configured and reachable. Caddy obtains and renews HTTPS certificates when DNS
and these ports are ready. Do not install another web server on the same ports.

Production Compose defaults `APP_ORIGIN` to `https://${SITE_ADDRESS}`. Set an
explicit `APP_ORIGIN` when using a different scheme or port, and keep it aligned
with the public frontend address. The API has no public port mapping; Caddy
proxies public `/api` requests to its private Docker port.

From a checkout of the reviewed application revision on the VPS:

```sh
cp .env.production.example .env.production
chmod 600 .env.production
openssl rand -hex 32
```

Set `POSTGRES_PASSWORD` in `.env.production` to the generated value. Keep the
default database/user names; the constructed connection URL requires URL-safe
credentials. The environment file stays outside Git and Docker build contexts.
Define this shell helper in the repository directory for the commands below:

```sh
dc() {
  docker compose --file compose.production.yaml --env-file .env.production "$@"
}
dc build api web
dc up -d --wait db
dc run --rm migrate
dc up -d --wait api web
dc ps
curl --fail https://halloween.sirhc.xyz/api/health
```

Migrations run explicitly before the API starts; restarting a container does not
change the database schema. Re-running the migration command applies only pending
migrations. Existing database credentials are not changed by editing the
environment file. `dc down` preserves data; never add `--volumes` during normal
operation. Review logs with `dc logs --tail 100 api web`.

Before an update, create and copy a backup off the VPS, check out the reviewed
revision, then repeat build, migration and startup. Schema changes must remain
compatible with the running API until its replacement starts. Stopping containers
and replacing images does not undo migrations; recovery requires an explicitly
reviewed schema correction or backup restoration.

### Backups and response inspection

Create a PostgreSQL custom-format dump with restricted local permissions:

```sh
umask 077
mkdir -p backups
dc exec -T db sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "backups/blackwood-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

Keep backups outside Git and copy them to a separate machine or storage service.
The Compose configuration does not schedule backups or off-server transfers.
The GitHub deployment setup installs the daily timer described above. A standalone
manual installation must configure its own backup scheduling and retention.
To verify restoration without replacing live data, use a new database name:

```sh
dc exec -T db sh -c 'createdb -U "$POSTGRES_USER" blackwood_restore'
dc exec -T db sh -c 'exec pg_restore -U "$POSTGRES_USER" -d blackwood_restore --exit-on-error --no-owner --no-privileges' < backups/CHOSEN_BACKUP.dump
dc exec -T db sh -c 'psql -U "$POSTGRES_USER" -d blackwood_restore -c "SELECT count(*) FROM invitation_responses"'
```

Inspect actual responses through SSH without exposing PostgreSQL publicly:

```sh
dc exec db sh -c 'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

The local Drizzle Studio setup does not provide remote database access.

### Production verification

`pnpm test:production` requires Docker and the installed Chromium browser. It
creates a unique temporary Compose project, builds both runtime images, applies
migrations twice to an empty database and tests the real frontend/API/database
flow. It also checks cache headers, API routing, unpublished database/API ports,
restart persistence and dump restoration. It removes only its own containers and
volumes after the run. Existing local and production data are not used.
The test binds HTTP to a random loopback port; public DNS, TLS issuance and
physical-phone behavior must be verified after deployment.

## Documentation

- [Product specifications](https://app.notion.com/p/3f3fb8942376814c915ffc15aafc6b53)
- [Technical architecture](https://app.notion.com/p/3f3fb8942376815e9962da234554ed5a)
- [Invitations API contract](https://app.notion.com/p/3f4fb894237681eb9768ed6228782025)
