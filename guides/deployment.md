# Deployment and backups

[Back to the project README](../README.md)

**Current status:** the original Blackwood deployment was taken offline on
1 November 2026. Its web, API and PostgreSQL containers are stopped, and its daily
backup timer is disabled. Data, media, configuration, current images and existing
backups were retained. A private off-server archive was copied to the operator's
Mac; it is not included in this repository.

The procedures below describe the deployment setup. They do not imply that the
original site is running. Production changes and reactivation require explicit
operator authorization. Check port and service ownership before reusing the VPS.

## VPS deployment

The provider firewall policy, activation steps, rollback and validation
commands are in [the network hardening runbook](../deploy/network-hardening.md).
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

### Local production-stack reference

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

For a separate local rehearsal, use a checkout with isolated volumes and ports.
The commands below build locally; the managed VPS uses published images through
the manual deployment workflow above. Do not run this build procedure on the VPS:

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

For VPS updates, create and copy a backup off the server and use the manual
deployment workflow with a validated revision. Schema changes must remain
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
