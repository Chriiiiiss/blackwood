# Frontend rules

The root `AGENTS.md` also applies.

## UI and architecture

- Preserve French guest-facing copy, dark mode by default, purple accents and a
  restrained Halloween orange. Keep the mobile form compact, personal and playful;
  avoid corporate copy, oversized sections and unsolicited decorative logos.
- Preserve accessible labels, fieldsets, keyboard focus, error announcements and
  reduced-motion behavior. Animation must not obstruct form controls.
- Organize domain behavior in `src/features/<feature>/`; extract shared components
  only when concrete reuse warrants them. Keep components focused on rendering.
- Use colocated `.module.scss` files for component styles. Reserve `styles.scss`
  for shared tokens, resets and application-wide rules. Preserve existing tokens
  rather than introducing a second theme system.
- Use the existing TanStack Query client and feature query/mutation options for
  server state. Keep HTTP transport in feature `requests.ts` modules and form
  drafts in local state; do not add a generic `api.ts` or duplicate query caching.
- Call relative `/api` URLs through Vite or the production reverse proxy. Never
  embed credentials or a privileged API key in frontend code or Vite variables.

## Invitation behavior and safety

- Keep the response UUID in browser storage before the first save and reuse it
  for retries and edits. Do not introduce automatic mutation retries or merge
  responses by first name.
- Preserve drafts after failed submissions and the single-submission guard.
  Attendance `no` clears the +1 choice; returning to another attendance value
  requires a new choice.
- Render guest input as text. Do not use raw HTML insertion for response fields.
  Client validation improves feedback; the API remains authoritative.
- Preserve the robots meta tag and `robots.txt`. Search-engine exclusion does
  not make the app private.

## Verification

For frontend behavior changes, run the relevant Playwright cases, frontend type
checking and build. Use `pnpm test:web` for the Chromium/mobile WebKit suite.
Use `pnpm test:production` for changes that affect the real frontend/API contract
or production routing; mocked frontend tests alone do not prove persistence.
Biome does not validate SCSS syntax; the Vite build does.
