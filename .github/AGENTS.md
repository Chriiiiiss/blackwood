# GitHub Actions rules

The root `AGENTS.md` also applies. For image publishing and deployment changes,
also read `deploy/AGENTS.md`.

- Preserve separate frontend and backend workflows with path filters. Changes to
  one app should run its checks; changes to both or shared dependencies/config
  should run both. Each workflow must remain manually runnable.
- Keep frontend checks independent of PostgreSQL and backend tests. Keep backend
  checks independent of browser installation and frontend tests.
- Production integration CI verifies assembled containers separately. PR filters
  cover deployment, dependencies and migrations; `main` filters also cover app
  code. Consider deletions and the complete PR diff when changing filters.
- Publish images only after successful production verification on `main`, tagged
  with the full commit SHA. PRs must not publish application images.
- Keep **Deploy production** manual-only and limited to the current validated
  `main` SHA. Preserve CI/publication checks, pinned SSH host verification,
  restricted SSH identity and public HTTPS verification.
- Ordinary front/back validation must not require deployment credentials or
  production data. Docker Hub read credentials are for base-image downloads;
  application images are stored in GHCR with temporary GitHub tokens.
- Keep workflow permissions minimal, package-write access limited to publication,
  third-party Actions pinned to commit SHAs, and dependency installs frozen.
- Cancel superseded validation runs independently. Do not cancel an in-progress
  production deployment in favor of another deployment.
- Never print secrets or include them in artifacts. Remove temporary SSH keys on
  success and failure; never disable host-key checking to unblock a workflow.

When changing workflow logic, verify event/branch/path conditions and permissions
alongside the commands affected. Use local deployment safeguards and the isolated
production test when relevant; never use the live VPS to test CI changes without
explicit authorization. Report skipped publication and manual deployment as
separate states rather than CI failures.
