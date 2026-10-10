# Production and deployment rules

The root `AGENTS.md` also applies. Apply these rules when changing production
Compose, the Dockerfile or any deployment path, including files outside `deploy/`.

## Authorization and topology

- Do not change the VPS, trigger deployment, restart services, apply production
  migrations or write production data without Chris's explicit go-ahead for that
  operation. A request to prepare code or a PR is not permission to deploy.
- Keep deployment manual, restricted to validated `main` revisions. Do not add
  deployment on push, merge, image publication or workflow completion.
- The current public address is `https://halloween.sirhc.xyz`. Caddy serves static
  frontend files, routes `/api` and manages HTTPS. Only the proxy publishes ports;
  the API and PostgreSQL remain on private Docker networking.
- For a Traefik migration, consult the architecture and relevant Linear ticket
  first. Any dashboard and administration API must remain private. Do not enable
  an insecure public dashboard or expose the Docker socket publicly. A read-only
  socket mount does not restrict Docker API methods.
- Preserve the robots meta tag and global `X-Robots-Tag: noindex, nofollow`,
  including API/assets. Allow crawlers to read noindex directives; do not mistake
  search-engine exclusion for access control.

## Releases, credentials and data

- Build images in CI and pull full-commit-SHA versions from private GHCR. Do not
  build on the VPS or use mutable `latest` tags for deployment selection.
- Preserve host-key verification and the dedicated forced-command SSH key.
  Do not widen deployment access to an interactive shell or SSH forwarding.
- Keep database secrets in the private VPS env file. Send temporary registry
  credentials over stdin, keep Docker credentials in a private temporary directory
  and clean it on exit. Never print credentials or store permanent registry tokens.
- Back up before migrations, stop on backup/migration failure, and wait for
  healthchecks before recording the active release. Preserve the PostgreSQL volume.
- Preserve daily backups, retention and the deployment/backup lock. Backups on the
  VPS are not off-server disaster recovery; do not claim an external copy exists.
- Do not automatically reverse migrations or reset a production database after a
  failed deployment. Inspect partial failures before choosing a recovery action.
- Editing `deploy/remote.py` in Git does not update the installed VPS runner.
  Prepare and describe the required administrator update separately; applying it
  requires explicit authorization.

## Verification

Run the deployment safeguard tests with
`python3 -m unittest discover -s deploy -p 'test_*.py'` when changing the runner.
Use `pnpm test:production` for container, routing, migration or release changes;
it uses an isolated local Compose project. Verify relevant public HTTPS behavior
after an authorized deployment. Record the deployed SHA separately from PR/CI
status. The README holds operator commands; Notion holds architectural decisions.
