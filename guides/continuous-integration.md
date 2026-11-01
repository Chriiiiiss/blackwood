# Continuous integration

[Back to the project README](../README.md)

Validation workflows, container publication and repository configuration.

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
this repository. Container package visibility is managed separately on GitHub. PRs and manual runs on other branches never publish.
The full commit identifier selects a version; no mutable `latest` tag is used.
