# Hotel Blackwood

A Halloween party web app with invitations, secret missions and a time capsule
for messages and photos, called the Coffre, projected as a Three.js scene on the TV. Guests use their phones; the
organizer manages access, the countdown and the display from one dashboard.
The guest and organizer interfaces are in French.

Built for Halloween 2026. The event is over and the original deployment is
offline; the application can still be run locally.

## What it does

- **Invitations:** attendance, one optional companion and an editable response.
- **Guest profiles:** a name, an optional avatar and personal four-digit access codes.
- **Coffre:** text and photo deposits, public/private visibility, a countdown and
  successive Coffres that preserve earlier memories.
- **Secret missions:** 75 missions, recipient-confirmed points and a live leaderboard.
- **TV projection:** public memories float through a full-screen Three.js scene
  after the Coffre opens. Scores and mission celebrations accompany the countdown.
- **Organizer dashboard:** invitations, guest access, Coffre controls and a
  profile-linked activity journal.
- **Optional Spotify integration:** a brief now-playing card when the song changes.
  Spotify handles playback on the usual device.

## Stack and layout

| Area | Tools | Location |
| --- | --- | --- |
| Web | React, TypeScript, Vite, TanStack Router/Query, Three.js, SCSS Modules | [`apps/web`](apps/web) |
| API | Fastify, TypeBox, Drizzle ORM, PostgreSQL 18 | [`apps/api`](apps/api) |
| Tooling | pnpm workspaces, Biome, Node test runner, Playwright | Root and application scripts |
| Deployment | Docker, Caddy, GitHub Actions, GHCR | [`deploy`](guides/deployment.md) |

In development, Vite and Fastify run on the host and PostgreSQL runs in Docker.
Vite proxies `/api` to Fastify. In production, Caddy serves the built frontend
and proxies the same API routes; the API and database stay on a private Docker
network. Uploaded media live in a separate persistent volume.

## Run locally

Prerequisites: Node.js from [`.nvmrc`](.nvmrc), pnpm from the `packageManager`
field in [`package.json`](package.json), and Docker with Compose v2 running.

```sh
git clone https://github.com/Chriiiiiss/blackwood.git
cd blackwood
nvm install
nvm use
cp .env.example .env
pnpm install --frozen-lockfile
pnpm db:up
pnpm db:migrate
pnpm dev
```

Open **<http://localhost:5173>**. The example `APP_ORIGIN` matches this address;
change it if you use another hostname or port. A different browser origin receives
403 responses. The credentials in `.env.example` are for local development only.

| Service | Address |
| --- | --- |
| Web | `http://localhost:5173` |
| API | `http://127.0.0.1:3000` |
| PostgreSQL | `127.0.0.1:5432` |
| Drizzle Studio, when started | `127.0.0.1:4983` |

Check connectivity with:

```sh
curl --fail http://localhost:5173/api/health
```

Expected response: `{"status":"ok"}`.

### Enable the organizer dashboard

Organizer access is disabled until its password hash is configured:

```sh
pnpm organizer:password
```

The command prompts privately and writes `.organizer-password.env`, ignored by
Git. Copy its **single-quoted assignment** into your private `.env`, preserving
the quotes, then restart the API. Open `/organisateur` to sign in.
See the [organizer guide](guides/organizer.md) for password and session rules.

The hub starts closed: submit an invitation, then enable **Accueil du site** in
the organizer dashboard to access the guest apps. Coffre and Missions also use
`PARTY_OPENS_AT`, whose example value is the original event date. Set it explicitly
when preparing another event. The TV pairs with its own four-digit organizer code.

For phone testing, see [HTTPS development](guides/development.md#https-development-on-a-phone).
Organizer sessions require HTTPS outside loopback. Native HEIC processing needs
`heif-info` and `heif-dec` locally; the production image includes them.

## Everyday commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start PostgreSQL and both applications with live reload |
| `pnpm db:down` | Stop local PostgreSQL while preserving its volume |
| `pnpm db:logs` | Follow PostgreSQL logs |
| `pnpm db:studio` | Open the local database interface |
| `pnpm db:generate` | Generate migrations after a schema change |
| `pnpm db:migrate` | Apply pending migrations to the configured database |
| `pnpm organizer:password` | Generate a private organizer password hash |
| `pnpm check` | Check formatting, lint and TypeScript |
| `pnpm format` | Apply formatting and safe lint fixes |
| `pnpm build` | Build both applications |

Only PostgreSQL runs in local Compose. Stop the host development processes with
Ctrl+C and run `pnpm db:down` when finished. Keep `.env`, `.media/`, private keys
and backups out of Git. Stopping Compose preserves data; do not remove its volumes
to perform routine cleanup.

## Verification

```sh
pnpm check
pnpm test
pnpm build
```

Additional checks:

| Command | Scope |
| --- | --- |
| `pnpm test:web` | Chromium and mobile WebKit flows, including accessibility checks |
| `pnpm test:db:isolated` | Database integration tests in a disposable PostgreSQL container |
| `pnpm test:db` | Integration tests against the configured local database; applies migrations |
| `pnpm test:production` | Real containers, browser submissions, persistence and backup restoration |

Install browsers before the first browser run:

```sh
pnpm --filter @blackwood/web exec playwright install chromium webkit
```

Use the isolated database command for the full database suite without touching
local development data. Container tests require Docker; production integration
uses a separate Compose project with its own data and loopback port.

## Documentation

| Guide | Contents |
| --- | --- |
| [Development](guides/development.md) | Code structure, routing, environment, phone testing and migrations |
| [Invitations and guest access](guides/guest-access.md) | Profiles, companions, personal codes and scheduled opening |
| [Coffre](guides/coffre.md) | Guest workflow, organizer controls and API contract |
| [Secret missions](guides/missions.md) | Assignments, confirmations, scoring and TV celebrations |
| [Media](guides/media.md) | Formats, upload limits, normalization, authorization and lifecycle |
| [Organizer](guides/organizer.md) | Password setup, sessions and the activity journal |
| [TV and Spotify](guides/tv-and-spotify.md) | Pairing, the 3D scene, wake lock and music metadata |
| [Continuous integration](guides/continuous-integration.md) | Checks, image publication and required repository secrets |
| [Deployment and backups](guides/deployment.md) | Manual releases, persistent storage, backup and recovery procedures |

CI validation, image publication and production deployment are separate steps.
GitHub Actions publishes the web and API container images to GHCR after successful
production verification on `main`. Deployment is a separate manual workflow.

## License

Application code is licensed under the [MIT License](LICENSE).

## Third-party assets

Bundled fonts retain their adjacent OFL license files. The HEIC test images have
separate attribution and licensing in the [fixture README](apps/api/test/fixtures/media/README.md).
Theme assets are documented with [One Wish Willow](apps/web/src/features/coffre/themes/one-wish-willow/README.md).
