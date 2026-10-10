# Hotel Blackwood — Agent instructions

## Working rules

- Read `/Users/chris/.codex/RTK.md` if available on this machine.
- Communicate with Chris in French. Explain consequential technical choices in
  plain language so the work can also serve as a learning resource.
- Write code, identifiers, test names, comments, commit/PR messages and repository
  documentation in English. Guest-facing UI copy is in French.
- Work in small steps within the requested scope. Preserve user changes and
  untracked files; do not delete or commit unrelated local artifacts.
- Keep `main` usable. Use short branches and reviewable PRs.
- **Do not deploy, change VPS configuration, restart production services, run
  production migrations, or write production data without Chris's explicit
  go-ahead for that operation.** Existing authorization covers only its stated
  scope. Read-only inspection is allowed when relevant; never expose secrets or
  unnecessary guest data.

## Sources and instruction scope

Notion holds specifications, decisions and rationale. Linear holds tasks,
acceptance criteria, dependencies and status. The README holds actual setup and
operator commands. Do not duplicate task lists or session histories here.
Read the relevant sources before changing behavior; distinguish implemented
behavior, accepted decisions and proposals. Record durable decisions in Notion
and keep the README aligned with actual commands.

- [Web-app](https://app.notion.com/p/3f3fb8942376814c915ffc15aafc6b53)
- [Technical architecture](https://app.notion.com/p/3f3fb8942376815e9962da234554ed5a)
- [Invitations API contract](https://app.notion.com/p/3f4fb894237681eb9768ed6228782025)
- [Invitations](https://app.notion.com/p/3f3fb894237681d482f0fa2dbb043413)
- [Form and user flow](https://app.notion.com/p/3f3fb89423768104a23dde016e2db5ae)
- [Linear project](https://linear.app/chriiiss/project/hotel-blackwood-9eda871bf955)

Root rules apply to every directory. Additional rules live in `apps/web/AGENTS.md`,
`apps/api/AGENTS.md`, `deploy/AGENTS.md` and `.github/AGENTS.md`. Read the applicable
file before editing that area. For production-related root files such as
`Dockerfile` and `compose.production.yaml`, also read `deploy/AGENTS.md`.

## Product boundaries

This repository covers the Hotel Blackwood Halloween 2026 party web-app.
The mobile invitation MVP is implemented: first name, attendance, at most one
unnamed +1, and an optional idea. Responses can be edited from the same browser;
the organizer currently reads them in PostgreSQL through SSH.

Do not add guest accounts, an admin UI/API, email/phone collection, dietary or
drink preferences, games or Spotify unless requested. Preserve the established
form rules; resolve behavior changes against the product sources rather than
making silent assumptions.

## Shared foundation

- pnpm workspaces: `apps/web` and `apps/api`; pinned Node.js 24 and pnpm versions.
- React, TypeScript, Vite, TanStack Query and SCSS Modules in the frontend.
- Fastify 5, TypeBox, Drizzle ORM and `pg` in the backend; PostgreSQL 18.
- Biome for supported formatting/linting; TypeScript for type checking.
- Keep direct dependencies pinned and commit lockfile changes with manifest
  changes. Read installed versions before following library examples.
- Drizzle and secrets stay in the backend. Add shared packages only for a
  concrete need; avoid speculative abstractions and generic API layers.

## Local development and data

Only PostgreSQL runs in local Compose. Vite, the API and Studio run on the host;
Vite proxies `/api`. Setup and ports are documented in the README and env examples.
Keep local PostgreSQL bound to `127.0.0.1`, wait for its healthcheck, and preserve
the PostgreSQL 18 volume mounted at `/var/lib/postgresql`.

Stopping services must preserve data. Database resets and destructive commands
require an explicit request. Use isolated projects and temporary volumes for
destructive verification. Keep `.env`, private keys, tokens and backups out of
Git, Docker build contexts and tool output; document variable names in examples.
Studio is a local tool, not a public production database interface.

## Verification and completion

Use the smallest meaningful checks for the changed behavior. Add regression tests
for fixes at the responsible layer; documentation-only changes do not require
application tests. Inspect the diff and report what passed, what was not run and
any material limitation. Do not expand scope after relevant checks pass.

Root commands include `pnpm check`, `pnpm test`, `pnpm test:web`, `pnpm test:db`,
`pnpm build` and `pnpm test:production`; consult scoped instructions and the README
before running them. `pnpm test:db` applies migrations to the configured local
database. Keep existing local data intact.

CI validation, image publication, PR merging and production deployment are
separate states. Report them accurately; passing CI or publishing images does
not mean a version is deployed. Production deployment remains manually triggered.
