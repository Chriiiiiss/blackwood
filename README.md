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
| `pnpm test:web` | Tests public and organizer flows in Chromium and mobile WebKit |
| `pnpm test:db` | Starts PostgreSQL, applies migrations and runs integration tests |
| `pnpm test:db:isolated` | Runs all database tests in a temporary PostgreSQL container, without using local data |
| `pnpm organizer:password` | Prompts for a password and writes its hash to a private ignored file |
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
`/invitation` collects a first name, attendance, a conditional +1 choice and an
optional idea. A saved response can be reopened with **Modifier ma réponse** in the
same browser. The browser preserves its random response identifier and exchanges
it for a separate protected guest cookie. Each response links to an independent
profile UUID; first names are never used to merge profiles. Recognized guests
edit their linked response through their cookie, including when the hub is closed.

The form uses the existing invitations API through the Vite proxy. Failed saves
preserve the draft and reuse the identifier on retry. Browser storage must be
available so a saved response can be recovered after a reload.

### Guest hub and access

The distributed root URL remains valid. `/` opens the hub only for a recognized
guest while the organizer's **Accueil du site** switch enables it; otherwise it
redirects to `/invitation`. The switch defaults to Invitations and persists in
PostgreSQL. Closing the hub preserves guest access and invitation editing.
Guest cookies last 90 fixed days without inactivity expiry. They are HttpOnly,
SameSite=Strict and Secure over HTTPS; only token fingerprints are stored in the
database. Guest and organizer sessions are independent.

The hub uses the current profile first name. `/profiles` lets recognized guests
edit that name inline next to their avatar; the save control appears only after
a name change. Guests can import or take a photo, then preview/crop it in a modal,
replace it or remove it. Name
changes update Invitations without changing attendance, +1 or ideas. Avatar
previews use browser decoding. The modal supports mouse/touch dragging, wheel
zoom and two-finger pinch, with keyboard and +/- button alternatives. Camera
streams stop after capture or cancellation, including late permission responses.
On HTTP LAN development origins, the camera action uses native mobile capture
instead of getUserMedia. A browser that cannot preview HEIC still allows
upload with the server's centered square crop. Processing and format/size limits
remain authoritative on the API. `/profiles` redirects to Invitations while the
hub is closed. Coffre is available from the hub at `/coffre`.

Eligible main guests (attendance other than no, +1 selected) can create and copy
a seven-day companion link from their profile. The companion opens it on their
own browser, enters their name, then optionally adds an avatar. This creates an
independent profile/session without a personal invitation response. The route is
`/companions/$mainProfileId#token=SECRET`; the secret stays in the fragment and is
sent only in the claim JSON body, never in an HTTP URL or browser storage. It is
removed from the address bar after successful creation. Generating a replacement
link invalidates the previous one; a claimed companion is displayed by name and
prevents a second creation. Reloading restores access from the guest cookie.
An already recognized browser keeps its identity and offers to continue with it.
Existing guests who lost access can use `/login` instead of creating a new profile.

`GET /api/profiles/me/companion` requires a guest session and open hub. It returns
`{ eligible, companion: { firstName } | null }` for that guest's relation only;
it grants no editing or media access to the other person. The existing claim
endpoint atomically rechecks eligibility, uniqueness and link expiry.

The [guest access contract](https://app.notion.com/p/3f9fb89423768126bfdade067dcea4c1)
holds the profile, companion, session and code-login decisions. Profile deletion
remains separate; merging code does not perform a production operation.

Action confirmations and request failures use themed [Sonner](https://sonner.emilkowal.ski/)
toasts shared by guest and organizer pages. Field validation remains attached to
its input; loading states, saved-response summaries and required recovery
instructions remain on the page. Photo modals have their own notification host
so feedback stays accessible above the native dialog's backdrop. Camera photos
remain local until the guest confirms upload.

HTTP LAN previews generate a secure UUID v4 with `crypto.getRandomValues()` when
`crypto.randomUUID()` is unavailable. The identifier is still persisted before
the first request and reused on retry. A phone preview requires an exact
`APP_ORIGIN` matching its network URL and Vite `--host`; organizer access must
remain disabled for a non-loopback HTTP origin or use HTTPS. This does not change
the production origin or cookie rules.

### Personal guest codes

In the protected organizer dashboard, open **Clés des invités**
(`/organisateur/acces`). Every main or companion profile has its own entry.
Generate a code and transmit it to that person through your chosen channel;
the app does not send messages. The clear code is shown only after generation,
can be selected/copied, and disappears on hiding it or leaving the page.
It cannot be retrieved later: regenerate it if lost.

Guests follow **Retrouver mon profil par code** from Invitations or open
`/login`. A successful login restores the existing profile and its linked
response without a new submission. It opens the hub if enabled, otherwise
Invitations. Recognized browsers can continue with their current identity;
the API refuses to switch silently to another profile (`409
PROFILE_ALREADY_IDENTIFIED`). Companions retain their independent access
without a personal Invitations response.

Codes contain 20 uniformly random Crockford base32 characters (100 bits),
displayed in five groups of four. Input ignores case, whitespace and hyphens;
other characters are rejected. Only the SHA-256 fingerprint and enabled state
are stored. Codes are reusable until replaced or disabled. Login establishes
the existing protected 90-day guest session; codes never enter guest URLs,
localStorage or profile responses.

Regenerating invalidates the old code and preserves open sessions.
**Désactiver l’accès** disables the code, revokes every session of that profile,
and blocks legacy response-UUID exchange. Historical invitation access does not
re-enable it. Generating a new code enables access again; revoked sessions do
not return. These operations do not delete the profile, response, companion
relation or media.

API operations:

| Method | Endpoint | Result |
| --- | --- | --- |
| POST | `/api/guest-access/login` | JSON `{ "code": "…" }`; guest access envelope and protected session cookie |
| GET | `/api/organizer/profile-access` | Profile IDs/names/roles and code/access status; no code or fingerprint |
| POST | `/api/organizer/profiles/:profileId/code` | Generate or replace; returns the clear code once |
| DELETE | `/api/organizer/profiles/:profileId/code` | Disable code/access and revoke sessions; HTTP 204 |

Guest login requires the exact `Origin`, `X-Guest-Request: 1` and JSON.
Organizer operations require the organizer session and
`X-Organizer-Request: 1`; writes also require the exact `Origin`.
All responses use `Cache-Control: no-store`. Invalid and disabled codes return
the same `401 INVALID_GUEST_CODE`. Malformed JSON/fields are rejected before
credential lookup. Database failures remain generic errors.

PostgreSQL enforces atomic budgets of five attempts per normalized candidate
fingerprint and 100 total attempts in each fixed UTC five-minute window.
Successful attempts count too. Exceeding either budget returns
`429 LOGIN_RATE_LIMITED` with `Retry-After` until the window ends. Counters
survive API restarts; expired candidate rows are removed on the next admitted
attempt, and the global budget bounds their growth.

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
      index.tsx                   # Guest hub or redirect to /invitation
      invitation.tsx              # Public invitation and linked response editing
      profiles.tsx                # Guarded profile editor
      coffre.tsx                  # Guest deposits and revealed public memories
    routeTree.gen.ts              # Generated route types and tree, ignored by Git
    NotFoundPage.tsx               # Unknown-page message and typed return link
    NotFoundPage.module.scss       # Scoped unknown-page styles
    query-client.ts               # Shared in-memory TanStack Query client
    styles.scss                   # Theme variables, base styles and accessibility utilities
    features/guest-access/         # Current guest identity and legacy browser exchange
    features/hub/                  # Guest hub, route guards and unavailable app states
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

## Coffre guest interface

`/coffre` requires a recognized guest and open hub. Unknown visitors go to the
personal-code login; closing the hub returns recognized guests to Invitations.
Before launch, Coffre displays a waiting screen without loading contributions.
The approved layout foregrounds the framed 3D scene, compact frame choices and
a short composer for text, one photo, or both.
A live preview shows the selected frame with the draft text/photo without uploading.
Guests then review the draft and select public/private visibility in a modal before sending.
The countdown explicitly separates open deposits from future revelation, uses
server time and closes new deposits at the deadline. After a receipt, a success
toast confirms the save and a fresh, empty draft is ready immediately. Its new
identity also replaces the model viewer so saved content is cleared from the scene.

The existing photo camera modal is reused on supported origins; HTTP LAN/mobile
uses the native capture picker. File imports remain available. Browser previews
that cannot decode HEIC display an explanation and keep the original file for
server validation. Both composer and confirmation previews use a lazy-loaded
Three.js viewer with drag/pinch, mouse-wheel zoom and keyboard navigation, without an action toolbar.
The viewer owns camera/light/resource lifecycle; each model owns its geometry
and printed content. `plain` is a flat card for text/photos; `one-wish-willow`
reuses the retained ENG-46 triangular-prism model for text only. The complete
500-character API limit is preserved, with fitted print and readable text in
confirmation. An explicitly labeled illustrated fallback handles unavailable or
lost WebGL. Final artwork approval and the TV renderer remain separate;
attribution/font licensing ship with the theme.

Draft content and files stay in component memory, not localStorage. Retrying an
unconfirmed submission keeps the exact UUID and payload; editing is locked until
its outcome is confirmed or explicitly rejected. There are no automatic write
retries. A successful receipt clears the draft and preview; the guest can start
another deposit but receives no individual content/read/edit/delete link.

After revelation, the same route displays public memories without names or
avatars, with an explicit next-page button. Content and photos remain behind the
existing guest/API access checks. Query errors hide stale content, and access
loss redirects to code login or Invitations. Public query caches are scoped to
the profile and discarded on unmount. Organizer management and TV UI remain
separate work.

## Coffre API

The backend supports successive Coffres for the event. Its guest deposit/public-list
and organizer management interfaces are available; the TV interface remains separate work.
The [Coffre specification and API contract](https://app.notion.com/p/3f8fb8942376814ca6e0d313633cb11d)
describes the shared rules. TypeBox contracts live in
`apps/api/src/modules/coffre/schemas.ts`.

| Request | Result |
| --- | --- |
| `GET /api/coffre` | Guest/TV state: `unprepared`, `prepared`, `collecting` or `revealed`, with `serverNow`, `durationSeconds`, `startedAt` and `deadline` |
| `GET /api/organizer/coffre` | Same state for the organizer |
| `GET /api/organizer/coffres?before=ID` | Organizer-only history, newest first; metadata only, pages of 50 |
| `POST /api/organizer/coffres` | Prepare the successor with `{ "previousCoffreId": 1 }`, only after its predecessor is revealed |
| `PUT /api/organizer/coffre` | Create/configure before launch with `{ "durationSeconds": 21600 }`; allowed bounds are 1–604800 seconds |
| `POST /api/organizer/coffre/start` | Start with `{}`; retries preserve the original deadline |
| `POST /api/organizer/coffre/advance` | Shorten the collecting period with `{ "deadline": "ISO_DATE_TIME" }`; must be future and earlier than the current deadline |
| `POST /api/organizer/coffre/open` | Open immediately with `{}` while collecting; repeated calls preserve the opening time |
| `POST /api/coffre/contributions` | Guest deposit while collecting |
| `POST /api/organizer/coffre/contributions` | Organizer deposit while prepared or collecting |
| `GET /api/coffre/contributions?after=UUID` | Public content after revelation; no authors or private data |
| `GET /api/organizer/coffre/contributions?visibility=private&after=UUID` | Metadata only; both filters are optional |
| `GET /api/organizer/coffre/contributions/:id` | Explicit content read |
| `DELETE /api/organizer/coffre/contributions/:id` | Idempotent deletion without a prior content read |

State responses also contain `id` (null before the first preparation). A state
read without `coffreId` selects the latest Coffre. Add `?coffreId=ID` to state,
configuration, timing, deposit, contribution-list, detail and deletion requests
to target a specific Coffre. For compatibility, requests other than state reads
keep targeting Coffre 1 when the selector is omitted; stale clients cannot
silently submit to a successor. Both list cursors remain independent: `before`
for Coffres, `after` for contributions.

Creating a successor preserves all previous records and copies the predecessor’s
configured duration, editable before manual launch. It locks that predecessor
and creates at most one successor, so repeated or concurrent creation requests
return the same Coffre. A prepared/collecting Coffre cannot create a successor.
The UI keeps each draft and explicit retry bound to its original Coffre. Only
the organizer can browse previous Coffres. Guests automatically follow the latest
Coffre and cannot read older states, content or direct photo URLs after successor
creation, including previously public photos. Private photos remain organizer-only. Retention is still tracked in ENG-59. Migration
0007 removes the singleton restriction without moving or deleting memories.

Guest routes require a valid guest cookie and open hub. Organizer routes use the
existing independent organizer session and `X-Organizer-Request: 1`. Every write
requires the exact configured `Origin`; guest writes also require
`X-Guest-Request: 1`. All responses are private/no-store.

A text deposit is JSON: `{ "id": "UUID_V4", "text": "A wish", "visibility":
"public", "frameId": "one-wish-willow" }`. Generate the ID once per draft and
retain it when retrying. The same normalized content/actor/photo bytes returns
the same `200 { "id": "UUID_V4", "received": true }` receipt, including after
closure. Reusing the ID with different content returns `409 CONTRIBUTION_CONFLICT`.
Receipts contain no content or individual read URL.

For a photo, send multipart with one `file` and one plain string `contribution`
field containing that JSON. Either order is supported. `text` is optional, at
most 500 Unicode code points before trimming; blank text becomes null. At least
text or a photo is required. `plain` supports text/photos; `one-wish-willow` is
text-only. No client-supplied media ID or standalone photo upload is accepted.
Use the [shared media limits](#shared-media) and existing protected image routes.

Lists return `{ contributions, nextCursor }`, with at most 50 items ordered by
UUID. Pass `nextCursor` as `after` until it is null. Organizer list items contain
only ID/date/visibility/frame, content-presence booleans and author metadata;
they do not load messages, thumbnails or photo IDs.

The organizer interface at `/organisateur/coffre` prepares the duration, launches
the countdown, shortens the remaining time or opens immediately after confirmation.
It also accepts organizer deposits before launch, filters metadata by visibility,
reads content only after **Consulter**, and deletes after confirmation without
reading the content first. Private content remains reserved to the organizer.

The PostgreSQL clock and persisted deadline govern acceptance and revelation.
Timing commands and deposits lock the same Coffre row: an upload finishing after
opening cannot insert a new contribution. The configured duration stays unchanged
after advancement; the deadline is the shared authority. Advancing to the exact
current deadline acknowledges a retry; extension, pause, reset and reopening are
not supported. Immediate opening before launch returns `409 COFFRE_NOT_COLLECTING`.
Uploads recheck guest access, hub status and time in the insertion/attachment
transaction. Public reads before revelation return `409 COFFRE_NOT_REVEALED`;
new deposits after closure return `409 COFFRE_REVEALED`. There are no guest
individual-read/edit/delete or pause/reset/reopen commands. Deletion clears
content and revokes media immediately; a content-free tombstone prevents retry
resurrection. No retention purge is scheduled (ENG-59).

Verify the backend without touching local development data:

```sh
pnpm test
pnpm test:db:isolated
```

The isolated suite covers prepared/collecting/revealed access, repeated and
concurrent deposits, real photo processing, deadline lock waits, restart
persistence, pagination and deletion. It creates and removes its own temporary
PostgreSQL container and media directory.

## Shared media

The API stores only normalized JPEGs. JPEG, PNG, WebP and still HEIC/HEIF inputs
are limited to 20 MiB, 60 million pixels and 12,000 pixels per side. Animated
images, SVG and unsupported formats are refused based on their contents, not
their filename or declared MIME type. Photos fit within 1,920 pixels with a
480-pixel thumbnail; avatars are 512 × 512. Initial JPEG qualities are 82 for
photos and 80 for thumbnails/avatars. Orientation is applied, colors become
sRGB, transparency becomes white, and EXIF/GPS/XMP metadata is removed.

`MEDIA_ROOT` optionally selects an absolute local directory; its default is
`.media/` at the repository root. Production Compose mounts `media_data` at
`/media`, outside Caddy's static files. PostgreSQL stores media IDs, dimensions,
ownership and lifecycle state in `media_assets`; clients never receive disk paths.
The runtime includes `heif-info` and `heif-dec` from Debian trixie's maintained
`libheif-examples` package, including its security updates. Exact Debian security
revisions are not pinned against live mirrors: superseded versions can disappear.
The build logs record the installed `libheif-examples`/`libheif1` versions, and
`apt-get update` fails if any configured repository cannot be refreshed.
Rebuilding a commit can therefore select newer Debian security packages;
deployments still use the already-published image tagged with the commit SHA.
Native local HEIC processing requires those tools on `PATH`; the reproducible
HEIC check is `pnpm test:production`, which uses the shipped Docker runtime.

| Operation | Contract |
| --- | --- |
| `PUT /api/profiles/me/avatar` | Guest cookie, open hub, exact `Origin` and `X-Guest-Request: 1`; multipart file named `file`, optionally one JSON `crop` field; returns the current profile with `avatarMediaId` |
| `DELETE /api/profiles/me/avatar` | Same access requirements; removes the avatar reference and returns `avatarMediaId: null`, which selects the frontend default |
| `GET /api/media/:id/image` | Current avatar owner or organizer; Coffre photo visibility requires authoritative server context |
| `GET /api/media/:id/thumbnail` | Same photo access rules; avatars have no thumbnail variant |

Crop coordinates are fractions of the oriented image: `left` and `top` are in
`[0, 1]`; `size` is in `(0, 1]` and scales the shorter side. The entire square
must fit inside the image. Without a crop, the avatar uses a centered square.
The multipart limits allow one file, one field and two parts. Caddy additionally
rejects requests above 21 MiB. Upload/processing is serialized per API instance;
a competing upload receives `429 MEDIA_BUSY` with `Retry-After: 2`. The worker
has a 30-second deadline. Compose caps the API and decoder processes together at
512 MiB and one CPU; the JavaScript heap limit alone does not bound native memory.
Validation errors use stable codes, including `MEDIA_TOO_LARGE`,
`IMAGE_DIMENSIONS_EXCEEDED`, `INVALID_CROP` and `UNSUPPORTED_IMAGE`.

Media reads use `Cache-Control: private, no-store`. Unknown and inaccessible
media return the same 404. Closing the hub blocks guest media reads without
revoking sessions. Organizer reads remain independently authenticated. A media
ID or knowledge of a former file URL never replaces authorization.

### Coffre integration contract

The Coffre module owns the contribution record, deadline and validated `frameId`.
It composes a single media service for avatars and contributions:

1. Authenticate before reading uploads, then use `preparePhoto(ownerProfileId,
   receive)` with the bounded multipart receiver. This returns a tracked,
   unreadable `staged` photo.
2. In the contribution transaction, recheck the deadline/rights and call
   `attachPhoto(tx, mediaId, ownerProfileId)` together with the contribution insert.
   A failed transaction leaves the photo staged; call `discardPhoto` on rejection.
3. Supply `contributionContext(mediaId)` to the shared media service, reading the saved
   contribution and server revelation state. Missing/deleted context denies reads.
   Private media are organizer-only; public photos and thumbnails require an
   authenticated guest after revelation, including on TV. Authors get no separate
   read permission before revelation or for a private deposit.
4. On organizer deletion, call `markPhotoDeleting(tx, mediaId)` in the same
   transaction as clearing the contribution's content/media reference; cleanup
   can retry physical removal.

Frames remain separate UI overlays and are never baked into these JPEGs. There
is no standalone guest photo-upload route; the Coffre module owns launch and deposits.
The service cleans temporary originals after success/failure and retries media
marked `deleting`, plus abandoned `pending`/`staged` uploads older than 15 minutes,
at startup and every minute. Ready souvenirs are not age-purged; ENG-59 owns
retention. Run only one API instance against a media root: the upload guard is
process-local, and shared-volume multi-instance operation is not supported.

`pnpm test` covers conversion and policy boundaries. `pnpm test:db:isolated`
covers real HTTP handlers, ownership, lifecycle transactions and crash leftovers.
`pnpm test:production` checks real iPhone HEIC fixtures through Caddy/libheif,
proxy limits, volume persistence on API recreation and matching dump/archive
restoration. Fixture attribution and checksums are in
`apps/api/test/fixtures/media/README.md`.

## Organizer access

Open `/organisateur` to reach `/organisateur/invitations` and consult invitation
responses and confirmed attendance, pending attendance and confirmed companion
totals, alongside the total number of responses received. The desktop dashboard
places application navigation in a sidebar, responses in the main workspace and
the hub setting in a separate control panel. On phones the blocks stack without
horizontal scrolling. `/organisateur/connexion` accepts the single organizer
password. Private sections share a session-checked layout with navigation and logout; direct URLs
and reloads also verify access before loading section data. Coffre is marked
“À venir” and disabled until its management feature is delivered. Invitations
remain read-only; guest response UUIDs are excluded from the private API. The
public form stays at `/invitation`; `/` follows the guest hub setting.

Access is disabled (503) until `ORGANIZER_PASSWORD_HASH` is configured. To enable
it locally, apply migrations with `pnpm db:migrate`, then run:

```bash
pnpm organizer:password
```

Use a randomly generated password of 20–128 characters (at most 512 UTF-8 bytes)
from your password manager. Input is hidden and confirmed. The command writes
`.organizer-password.env` at the repository root with mode 0600, replacing a
previous generated file. Copy its **single-quoted assignment** into your private
root `.env`, then restart the API. Keep the quotes: the encoding contains dollar
signs. The generated file is ignored by Git and excluded from Docker contexts.
Do not pass passwords through command arguments, shell variables or Vite config.

Sessions use opaque random cookies and hashed tokens in PostgreSQL. They survive
API restarts, expire after seven days at most or 24 hours without authenticated
private activity, and are revoked server-side on logout. HTTPS uses a `Secure`,
`HttpOnly`, `SameSite=Strict`, host-only cookie; HTTP development is allowed only
on loopback with a separate cookie name. The frontend hides private data while
revalidating access and clears only organizer state on logout/expiration, keeping
the public invitation identifier intact.

For a forgotten password or lost device, generate a new hash, replace the private
backend assignment and restart the API. A new salt invalidates all prior sessions,
even for the same password. There is no public password-reset endpoint. After a
database backup restoration, generate a fresh hash before reopening private
access so restored sessions cannot become usable again. On the VPS, configuration
changes, migrations and API recreation require separate explicit authorization;
use the personal SSH key or the established recovery console. Generating a local
hash does not configure or deploy production.

The login endpoint admits 20 attempts per fixed 15-minute global window, stored
atomically in PostgreSQL, and at most one password derivation per API process.
429 responses carry `Retry-After`. The global limit avoids trusting proxy IP
headers, but an attacker can temporarily exhaust the quota for new logins.
Existing sessions and the public form remain available. API origin checks and
the required `X-Organizer-Request: 1` header supplement session authentication.

`pnpm test:db:isolated` creates its own loopback-only PostgreSQL container with
temporary memory storage, applies migrations and removes the container afterward.
Organizer database tests use the global login counter and therefore run only
with `BLACKWOOD_ISOLATED_TEST_DB=1`, set by that command and backend CI's empty
database. Ordinary `pnpm test:db` preserves that guard and skips those tests on
the configured local database. Integration files run sequentially because the
private collection endpoint reads the whole event's current response set.
`pnpm test:production` also verifies real login, cookie use, private counters,
updates, session persistence and logout through Caddy in its isolated project.

The approved [organizer access contract](https://app.notion.com/p/3f7fb89423768124bdc3fb0fb2bf6afb)
holds the rationale and HTTP details.

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

### Consistent database and media backup

A database dump alone cannot restore uploaded images. The existing daily VPS
runner backs up PostgreSQL only; it has not been extended or installed by this
media work. Until a separate authorized operator change includes media, use a
paired dump/archive backup when uploads are enabled. This procedure briefly
stops API writes; running it on production requires explicit authorization.

After loading the reviewed Compose configuration and `dc` helper above, choose
a private backup directory outside Git. The commands preserve service volumes:

```sh
umask 077
media_backup_dir="backups/blackwood-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$media_backup_dir"
dc stop api
if dc exec -T db sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$media_backup_dir/database.dump" &&
   dc run --rm --no-deps -T --entrypoint tar api -C /media -cf - . > "$media_backup_dir/media.tar" &&
   test -s "$media_backup_dir/database.dump" && test -s "$media_backup_dir/media.tar" &&
   (cd "$media_backup_dir" && sha256sum database.dump media.tar > SHA256SUMS); then
  echo "Paired backup complete: $media_backup_dir"
else
  echo "Backup incomplete: do not use this pair for restoration." >&2
fi
dc start api
```

Do not run deployments, migrations or other database writers during the snapshot.
Keep the API stopped only for the dump and archive, then check its health before
reopening writes. Record the application SHA, migration version and Compose
project with the pair. Copy the complete directory to private off-server storage;
no automatic external copy is configured. Upload cleanup is stopped with the API,
so referenced files cannot change between snapshots.

Restore into a **new isolated Compose project with empty database/media volumes**.
Keep its API stopped; restore `database.dump` with `pg_restore --exit-on-error
--no-owner --no-privileges`, extract the matching `media.tar` into its `/media`
volume and preserve ownership by `node:node`. Never overlay an archive onto an
active production volume. Verify archive checksums, the database avatar/media
references, file presence and authenticated image reads before switching traffic.
The production test exercises the paired restoration and byte equality without
using any production data. A retention purge/export policy remains ENG-59.

### Database-only backup and response inspection

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
creates a unique temporary Compose project, pulls base images and builds both
runtime images without cache so stale dependency layers cannot hide fresh-build
failures. It applies migrations twice to an empty database and tests the real
frontend/API/database flow. It also checks cache headers, API routing, unpublished database/API ports,
restart persistence and dump restoration. It removes only its own containers and
volumes after the run. Existing local and production data are not used.
The test binds HTTP to a random loopback port; public DNS, TLS issuance and
physical-phone behavior must be verified after deployment.

## Documentation

- [Product specifications](https://app.notion.com/p/3f3fb8942376814c915ffc15aafc6b53)
- [Technical architecture](https://app.notion.com/p/3f3fb8942376815e9962da234554ed5a)
- [Invitations API contract](https://app.notion.com/p/3f4fb894237681eb9768ed6228782025)
- [Organizer access decision and API contract](https://app.notion.com/p/3f7fb89423768124bdc3fb0fb2bf6afb)
