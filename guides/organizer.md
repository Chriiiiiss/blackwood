# Organizer

[Back to the project README](../README.md)

Password setup, sessions, profile administration and activity reporting.

## Organizer access

Open `/organisateur` to reach `/organisateur/invitations` and consult invitation
responses and confirmed attendance, pending attendance and confirmed companion
totals, alongside the total number of responses received. The desktop dashboard
places application navigation in a sidebar, responses in the main workspace and
the hub setting in a separate control panel. On phones the blocks stack without
horizontal scrolling. `/organisateur/connexion` accepts the single organizer
password. Private sections share a session-checked layout with navigation and logout; direct URLs
and reloads also verify access before loading section data. Coffre management is available at `/organisateur/coffre`. Invitations
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

## Profile-linked activity journal

Organizer → **Activité** (`/organisateur/activite`) shows reported page visits,
API actions and HTTP/network/uncaught JavaScript errors, with timestamps in Paris
time. Filter by profile, page or errors; older entries use cursor pagination.
The view refreshes every ten seconds and requires the existing organizer session.

`POST /api/activity/events` resolves the current profile from the protected guest
cookie. Before identification, events remain anonymous; earlier anonymous visits
are not retrospectively attributed. Client-supplied profile IDs and timestamps are
rejected. A UUID makes a repeated report idempotent. Recording is best effort,
limited to 60 events per minute per recognized profile (one shared anonymous
budget), and must not block application actions if the collector is unavailable.

The browser reports route templates, HTTP status/method, a bounded error category
and an optional script filename/line/column. It never sends form fields, photos,
mission text, access codes, query/hash values, raw exception messages or stacks.
Organizer and paired-TV pages are excluded. These are browser observations for
diagnosis, not a tamper-proof security audit or a recording of visitors' screens.
Only events occurring after this version is installed can appear; blocked scripts
or a completely unavailable collector cannot be reconstructed later.

Migration `0013_activity_log.sql` adds the indexed `activity_events` table without
changing existing invitation, profile, media or mission data. The journal is held
in the application database and follows its backup/access policy; this change
does not introduce an automatic purge or erase earlier data.
