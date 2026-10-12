# VPS network hardening runbook

**ENG-40 verification completed on 2026-10-12.** Chris reports that he activated the Hostinger
managed firewall group `vps-public` on `srv2048665` on 2026-10-12 with the rules
below. The group name reflects its intended use for future applications on the
same VPS. After the approved reboot, Chris confirmed the group remains active in
hPanel; its UI did not show a synchronization status. hPanel was not independently
inspected by the agent. No UFW or Docker policy changes were made.

Further firewall changes, production writes, deployments, service restarts and a
VPS reboot require their own explicit approval. The operator needs hPanel access;
this repository does not contain Hostinger credentials or a provisioning client.

## Target and configured policy

Target: Hostinger `srv2048665`, IPv4 `186.241.19.228`, IPv6
`2a02:4780:79:5105::1`, external interface `eth0`.

Use the Hostinger managed firewall group `vps-public` for this VPS. Filter incoming
traffic before it reaches Docker. Review the policy before adding applications or
attaching it to other servers, because edits affect every attachment. Keep the
current host and Docker rules, SSH drop-in, Caddy publications and deployment
workflow. No additional host firewall service is part of this change.

Chris reports the following **Accept** rules are configured. For future setup,
prepare rules while the group is inactive. Use **Custom**
source and the exact CIDR below rather than assuming that **Anywhere** covers a
specific address family. ICMP rules have no TCP/UDP port field.

| Protocol | Destination port | Source | Purpose |
| --- | --- | --- | --- |
| TCP | 22 | `0.0.0.0/0` | Personal and restricted GitHub key access over IPv4 |
| TCP | 22 | `::/0` | Preserve current IPv6 key access |
| TCP | 80 | `0.0.0.0/0` | HTTP redirect and certificate validation |
| TCP | 443 | `0.0.0.0/0` | Website and public API through Caddy |
| UDP | 443 | `0.0.0.0/0` | Preserve the existing HTTP/3 publication |
| ICMP | Not applicable | `0.0.0.0/0` | Network errors, path MTU and diagnostics |
| ICMPv6 | Not applicable | `::/0` | Preserve IPv6 control traffic and path MTU |

Use the managed firewall's default drop for unmatched incoming traffic. Do not add
an all-ports Accept rule. There is no IPv6 website listener or DNS AAAA record, so
this policy does not add IPv6 web access. ICMP/ICMPv6 remain deliberately broad;
fine-grained message filtering would need a separate host policy.

SSH stays reachable from arbitrary source addresses because Chris's address can
change and GitHub-hosted deployment runners do not have a dedicated fixed source
address in this project. Authentication remains key-only, with the GitHub key
limited to its existing forced command. Closing public SSH or changing its port
is outside this plan.

Do not allow direct Fastify (3000), PostgreSQL (5432), Docker API (2375/2376),
Studio (4983), Caddy admin (2019), monitoring/admin ports (8080/8443/9090), or
Monarx's loopback port (65529). Public `/api` requests continue through port 443.
Leave outgoing traffic and private Docker networking unchanged, including DNS,
HTTPS registry/GitHub/ACME access, time synchronization and API-to-database traffic.

## Initial read-only results after activation — 2026-10-12

**Reported by Chris:** `vps-public` activated with the seven Accept rules above
and default Drop; fresh Mac key login and website access succeeded; IPv4 TCP
3000/5432/2019/8080 timed out. SSH hardening remains in place; no UFW or Docker
rules were modified. Activation time, group ID and hPanel synchronization were
not independently captured.

**Independently checked in read-only mode:** from Chris's workstation outside
the VPS, on the same network as the pre-activation baseline. Internal SSH checks
at 20:02:14 UTC; external measurements at 20:02:47–20:03:13 UTC:

| Check | Result | Interpretation |
| --- | --- | --- |
| Fresh SSH IPv4 and IPv6 | Success; `srv2048665`, root; trusted host key checked, multiplexing disabled | Personal key access works over both IP families |
| SSH configuration | `sshd -t` passed; four effective settings match the policy | Password authentication remains disabled |
| Container inventory | API and database healthy; only Caddy publishes IPv4 TCP 80/443 and UDP 443 | No direct API/database publication observed |
| HTTP IPv4 | 308 to `https://halloween.sirhc.xyz/` | Redirect preserved |
| HTTPS IPv4 | HTTP/2 200; TLS verification passed | Website and certificate work |
| `/api/health` IPv4 | HTTP/2 200, `{"status":"ok"}` | Public API healthcheck works |
| HTTP/3 IPv4 | Website and healthcheck both HTTP/3 200, TLS verified; health body `{"status":"ok"}` | Actual HTTP/3 requests succeeded using `--http3-only`, without TCP fallback |
| UDP 443 IPv4 | Valid QUIC version negotiation with matching connection IDs | QUIC endpoint reachable |
| DNS | A `186.241.19.228`, no AAAA | Public website remains IPv4-only |
| IPv6 web TCP 80/443 | Direct probes and forced-address HTTP/HTTPS timed out | Connections failed as expected for the policy; not a website regression |
| Sensitive TCP ports, both IPs | 2019/2375/2376/3000/4983/5432/8080/8443/9090/65529 all timed out | No connection observed; a timeout does not identify the blocking layer |
| UDP 443 IPv6 | No response | Consistent with no publication/allow rule, but silence alone is inconclusive |

The HTTP/3 client already installed at `/opt/homebrew/opt/curl/bin/curl` advertises
HTTP3 support; the system curl does not. No tool installation was needed.
Sanitized local evidence is retained outside Git in
`docs/audits/eng-40-after-network-2026-10-12.json`, alongside the pre-activation
network and UDP evidence. The status table above preserves the results in the
operator documentation; ENG-40 also records the measurements.

**Unavailable or unverified at that point:** authenticated hPanel inspection of
attachment, group ID and sync state; browser recovery-console validation; a second
external network; ICMP/ICMPv6 behavior and the outbound connectivity checklist.
No unexpected failure was observed among the allowed public flows tested.
At this stage, the invitation write/edit, GitHub deployment and restart-persistence
tests had not yet run. Their subsequent approved results are recorded below.

### Additional read-only checks — 20:13–20:15 UTC

- ICMP echo IPv4 and IPv6 from the same external workstation: three replies from
  three packets for each address, no loss. This verifies echo, not every ICMP type
  or path MTU behavior.
- Host and existing API container: DNS resolution and verified-TLS HTTPS to
  `api.github.com` (200), `ghcr.io/v2/` (401, expected without credentials), and the
  Let's Encrypt ACME directory (200). The GHCR response proves network/TLS access,
  not permission to pull private images. No registry credentials were used.
- Existing Caddy container: HTTPS access to the Let's Encrypt directory succeeded,
  without forcing certificate issuance or renewal.
- API container: private `db` name resolves; `SELECT 1` succeeds through the
  existing database connection. No invitation records were read or modified.
- Time synchronization: `NTP=yes`, `NTPSynchronized=yes`.
- API/database healthy, all three containers running with `unless-stopped` restart
  policies; PostgreSQL and Caddy mounts preserved. Configuration inspection does
  not prove recovery after restart.
- SSH key metadata: two ED25519 entries, one personal and one with `restrict` and
  the expected forced command; authorized_keys mode 0600. Installed deployment
  runner is root-owned, mode 0700, and its SHA256 matches `deploy/remote.py`.
  This does not prove a fresh GitHub runner login with its secret key.
- GitHub read-only inspection: latest production deployment remains the successful
  2026-10-10 run for `452ba7ee43efe2dd05c5d4e2b046f58929537ed6`, also confirmed
  as active on the VPS. Current `main` is
  `a45e4636e45f8c3e4030e6cfd66c2bb0fb0890fe`; frontend, backend and production CI
  succeeded. Changes include application origin checks, not just documentation.
  Running the existing deployment workflow would install a newer version; it is
  not a harmless connection test or a redeployment of the active revision.

Additional local evidence, outside Git:
`docs/audits/eng-40-additional-checks-2026-10-12.json` and
`docs/audits/eng-40-internal-readonly-2026-10-12.json`.
No unexpected failure occurred in these read-only checks. The remaining production
operations were subsequently approved and completed as recorded below.

### Approved production verification procedure

Chris explicitly approved these operations and the recovery precondition in
response to the concrete plan on 2026-10-12. They were executed separately, with
recovery checks between them. The one marked test response was retained until
after reboot to prove data persistence, then removed. Future reruns need their own
approval and functioning hPanel recovery; do not batch interrupting steps.

1. **Disposable invitation write/edit and cleanup:** generate a fresh UUID;
   PUT `/api/invitation-responses/:id` with firstName `ENG40 Network Check`,
   attendance `yes`, plusOne true and ideas `ENG-40 temporary verification record`.
   Require 200 and an exact GET match. PUT the same ID with attendance `no` and
   plusOne false, then GET and verify the edit. Remove only this UUID/marker pair
   using a parameterized database DELETE, since there is no DELETE API. Require
   one deleted row and a final API GET 404. Never enumerate or modify guest records.
   Approval must cover both the temporary writes and this targeted cleanup.
2. **GitHub restricted-key deployment:** recheck the exact current `main` SHA and
   successful CI/image publication, then run the existing manual `deploy.yml`
   workflow only after approval for that release. The candidate observed above is
   `a45e4636e45f8c3e4030e6cfd66c2bb0fb0890fe`; if main changes, review the new
   revision before execution. This workflow pulls images, backs up, runs migrations
   and starts services. Verify its success, active SHA, public health/TLS and keys.
3. **Persistence, in an approved maintenance window:** record the active revision
   and persistent volumes. Recreate API/web using that same release and existing
   Compose configuration, with no build, pull, migration or volume removal; verify
   all public checks and private database connectivity. Separately restart Docker,
   verify again, then separately reboot the VPS and verify again. Keep hPanel open
   and confirm its firewall attachment/sync after each step. These operations can
   interrupt the website; each must be explicitly approved. Do not claim durability
   from restart policies or the provider architecture alone.

### Completed production checks — 20:20–20:26 UTC

| Operation | Evidence and outcome |
| --- | --- |
| Temporary invitation, 20:20:52 | Fresh UUID; PUT 200, GET 200, edit with the same UUID PUT 200, exact GET 200 |
| GitHub deployment, 20:21:02–20:21:32 | [Run 38303636723](https://github.com/Chriiiiiss/blackwood/actions/runs/38303636723) succeeded through the restricted key; active revision `a45e4636e45f8c3e4030e6cfd66c2bb0fb0890fe` independently verified |
| Backup before migrations | `blackwood-20261012T202117Z-452ba7ee43ef.dump`, 5396 bytes; backup, migration and startup workflow step succeeded |
| After deployment, 20:21:50–20:22:09 | Full outside checks passed; marked test response persisted |
| API/web recreation, 20:22:34–20:22:41 | Same revision, no build/pull/migration; API/web container IDs changed, DB ID and all persistent volume names unchanged |
| After recreation, 20:23:02–20:23:22 | Full outside checks passed; marked test response persisted |
| Docker restart, 20:23:25–20:23:28 | `systemctl restart docker` succeeded |
| After Docker restart, 20:23:49–20:24:08 | Full outside checks passed; container IDs and volume names unchanged; marked test response persisted |
| VPS reboot requested, 20:24:15 | Boot ID changed from `6b39398b-9b3e-4050-a10d-b9169dc0914f` to `291716d6-6c04-4922-8f24-ab1823ba950f`; Docker active by 20:24:44 |
| After reboot, 20:25:01–20:25:22 | Full outside checks passed; container IDs and volume names unchanged; marked test response persisted |
| Targeted cleanup, 20:25:28 | Parameterized DELETE matched UUID, first-name marker and ideas marker; exactly one row removed; final API GET 404 |
| Final checks, 20:26:03–20:26:05 | Docker and backup timer active, UFW inactive; same-origin health 200, foreign Origin and cross-site health requests 403 `ORIGIN_NOT_ALLOWED` |
| Provider attachment after reboot | Chris confirms `vps-public` active in hPanel; synchronization status not shown |

The full outside checks after each operation covered fresh trusted-key SSH over
IPv4/IPv6, the four effective SSH hardening values, healthy API/database and private
`SELECT 1`, HTTP 308 to HTTPS, HTTPS 200, health 200 with the expected body, and
actual HTTP/3 200 for site and health without TCP fallback. TCP 22/80/443 connected
on IPv4, TCP 22 connected on IPv6. IPv6 web ports and TCP
2019/2375/2376/3000/4983/5432/8080/8443/9090/65529 on both addresses timed out.
The tested allowed/blocked behavior, SSH policy, data and volume attachments
survived all three lifecycle operations. No guest records were inspected or changed
by the verification queries;
the sole marked test response was removed from the live database. The pre-migration
backup contains that temporary response; no backup was altered to remove it.

Sanitized evidence outside Git: `docs/audits/eng-40-stage-*-2026-10-12.json`,
`eng-40-operation-*-2026-10-12.json`, `eng-40-production-events-2026-10-12.jsonl`,
deployment result/summary, reboot recovery and final-check reports in the same
directory. This section and ENG-40 preserve the results without requiring those
ignored files.

Limits: these are selected-port probes from one external network, not a complete
security audit or a test of every ICMP message. Timeouts do not identify a filtering
layer. Provider attachment is reported by Chris; synchronization is not displayed.
The recovery console is not independently inspected by the agent and no intentional
lockout or firewall rollback was performed. The documented hPanel rollback remains
the recovery procedure. These limits do not invalidate the successful acceptance
checks above or authorize further production operations.

## Why this layer

The read-only baseline on 2026-10-12 at 19:25–19:26 UTC confirmed Docker's
**iptables backend through iptables-nft**, not its native nftables backend. UFW
was inactive; Docker's IPv4 forwarding policy was DROP and `DOCKER-USER` was empty.
Only IPv4 Caddy TCP 80/443 and UDP 443 were published. API and database healthchecks
were healthy. Effective SSH settings matched Chris's four hardening values.

An on-host iptables implementation would need separate host INPUT filtering and
Docker forwarding rules in `DOCKER-USER`, including original destination matching
after DNAT. UFW alone would not cover the published-container path. The chosen
provider filter applies before either path and covers both IP families; it avoids
changing Docker-owned chains. Its configuration lives in hPanel, so Docker or
container recreation should not remove it. The post-recreation, Docker restart and
reboot checks above preserve the tested policy behavior; Chris also confirmed the
provider attachment after reboot.

Do not enable the existing `nftables.service`: its observed stop action flushes the
whole ruleset, including Docker rules. Do not change Docker's firewall backend,
disable iptables/ip6tables, or restore an old full ruleset over Docker's live rules.

## Before a future activation or policy change

Chris has already reported activation. This checklist remains an operator
procedure for future changes; it does not claim that recovery access was tested.

1. Obtain Chris's explicit approval for activating this exact group on this VPS.
2. In **VPS → srv2048665**, confirm the server and both addresses in hPanel. Record
   the current firewall attachment and rules. If a group is already active,
   preserve its identity and rules for rollback and reconcile differences first.
3. Review all applications and server attachments affected by `vps-public` before
   editing it. Do not modify a group shared with other servers without approval
   for that scope. Record the group ID and its seven rules without secrets.
4. Keep a personal SSH session open. Open hPanel's browser console separately and
   verify a root shell with `id -un`. Confirm that firewall deactivation is
   available in hPanel independently of SSH. If either recovery path is unavailable,
   postpone activation. The console path must work without re-enabling SSH passwords.
5. Capture the outside measurements below before activation. Reconfirm published
   ports, container health and key-only SSH from the existing SSH session:

   ```sh
   date -u +%FT%TZ
   hostname
   ip -brief address show scope global
   docker ps --format '{{.Names}} {{.Status}} {{.Ports}}'
   sudo sshd -t
   sudo sshd -T | grep -E '^(passwordauthentication|kbdinteractiveauthentication|pubkeyauthentication|permitrootlogin) '
   ```

6. In **Security → Firewall**, prepare `vps-public` inactive if creating it, add the seven
   Accept rules and check the default drop. Confirm that the UI supports both
   CIDRs and ICMPv6. If the actual interface differs or cannot represent the policy,
   do not substitute an all-protocol/all-port rule; resolve that gap first.

## Activation and immediate verification

For a future activation, after approval and the preconditions above, activate `vps-public` on
`srv2048665` only. Allow up to two minutes for synchronization, and verify hPanel
shows the group active and synchronized. Do not change host configuration in the
same operation. Established connections may survive a bad rule, so test new ones.

From Chris's Mac, open fresh SSH connections with multiplexing disabled:

```sh
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ControlMaster=no -o ControlPath=none root@186.241.19.228 'id -un'
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o HostKeyAlias=186.241.19.228 -o ControlMaster=no -o ControlPath=none root@2a02:4780:79:5105::1 'id -un'
```

`HostKeyAlias` checks IPv6 against the already trusted key for the same server;
it does not disable host-key verification. Both commands must print `root`.
The following read-only HTTP checks run outside the VPS:

```sh
curl --noproxy '*' --silent --show-error --connect-timeout 5 --max-time 10 --output /dev/null --write-out '%{http_code}\n' http://halloween.sirhc.xyz/
curl --noproxy '*' --fail --silent --show-error --connect-timeout 5 --max-time 10 --output /dev/null --write-out '%{http_code}\n' https://halloween.sirhc.xyz/
curl --noproxy '*' --fail --silent --show-error --connect-timeout 5 --max-time 10 https://halloween.sirhc.xyz/api/health
```

Expected: 308 redirect, HTTPS 200 with successful certificate verification, then
`{"status":"ok"}`. Roll back immediately if either fresh SSH connection, the site,
or the healthcheck regresses. Do not wait for the later reboot/deployment checks.

From the Mac, use Python's standard library for bounded TCP probes:

```sh
python3 - <<'PY'
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import socket

targets = ["186.241.19.228", "2a02:4780:79:5105::1"]
ports = [22, 80, 443, 2019, 2375, 2376, 3000, 4983, 5432, 8080, 8443, 9090, 65529]

def probe(item):
    target, port = item
    try:
        with socket.create_connection((target, port), timeout=3):
            result = "CONNECTED"
    except ConnectionRefusedError:
        result = "REFUSED"
    except TimeoutError:
        result = "TIMEOUT (filter or path; cause unproven)"
    except OSError as error:
        result = f"UNVERIFIED: {error}"
    return target, port, result

print(datetime.now(timezone.utc).isoformat(), "measurement point: Chris Mac")
with ThreadPoolExecutor(max_workers=4) as pool:
    for result in pool.map(probe, [(target, port) for target in targets for port in ports]):
        print(*result)
PY
```

Expect connections only to IPv4 TCP 22/80/443 and IPv6 TCP 22. Any sensitive-port
connection is a stop condition. A timeout alone cannot locate the blocking layer;
correlate it with the active provider policy and internal publication inventory.
If IPv6 routing is unavailable at the measurement point, mark IPv6 unverified and
repeat from an IPv6-capable network. Repeat the checks from a second outside
network, such as a mobile connection, when available.

For UDP 443, run this bounded QUIC check from outside the VPS. It sends one padded
unsupported-version packet per address without writing application data:

```sh
python3 - <<'PY'
from datetime import datetime, timezone
import os
import socket

print(datetime.now(timezone.utc).isoformat(), "measurement point: Chris Mac")
for target in ["186.241.19.228", "2a02:4780:79:5105::1"]:
    family = socket.AF_INET6 if ":" in target else socket.AF_INET
    client_id, server_id = os.urandom(8), os.urandom(8)
    packet = b"\xc0\xfa\xce\xb0\x0c\x08" + server_id + b"\x08" + client_id
    with socket.socket(family, socket.SOCK_DGRAM) as connection:
        connection.settimeout(3)
        try:
            connection.connect((target, 443))
            connection.send(packet.ljust(1200, b"\x00"))
            reply = connection.recv(2048)
            expected = b"\x00\x00\x00\x00\x08" + client_id + b"\x08" + server_id
            valid = reply[1:23] == expected and len(reply) >= 27
            print(target, "QUIC version negotiation" if valid else "unexpected UDP reply")
        except TimeoutError:
            print(target, "NO RESPONSE (open/filtered/unreachable unresolved)")
        except OSError as error:
            print(target, f"UNVERIFIED: {error}")
PY
```

Require a version-negotiation response from IPv4. IPv6 UDP 443 is not allowed and
has no current publication; silence alone is inconclusive. An HTTP/3-capable
client can additionally use `curl --http3-only` against the website; it must not
silently fall back to TCP. Do not install another server for this check.

On Chris's Mac, the existing Homebrew client can verify actual HTTP/3 responses:

```sh
/opt/homebrew/opt/curl/bin/curl --noproxy '*' --http3-only -4 --fail --silent --show-error --connect-timeout 5 --max-time 10 --output /dev/null --write-out '%{http_code} HTTP/%{http_version} TLS=%{ssl_verify_result}\n' https://halloween.sirhc.xyz/
/opt/homebrew/opt/curl/bin/curl --noproxy '*' --http3-only -4 --fail --silent --show-error --connect-timeout 5 --max-time 10 --write-out '\n%{http_code} HTTP/%{http_version} TLS=%{ssl_verify_result}\n' https://halloween.sirhc.xyz/api/health
```

Require HTTP 200, version 3, TLS verification 0 and the expected health body.

## Rollback and recovery

Trigger rollback on loss of a fresh SSH connection, website/API health regression,
newly exposed sensitive ports, or broken outbound/private application traffic.

1. In the still-open hPanel session, open **VPS → srv2048665 → Security → Firewall**.
2. Deactivate `vps-public` on this server. If there was a previous active
   group, restore that exact attachment and its recorded rules.
3. Wait for synchronization and repeat fresh SSH, website and healthcheck tests.
4. Preserve the unsuccessful group's rules and sanitized evidence for diagnosis.
   Keep the key-only SSH drop-in. Do not reset SSH, passwords, Docker, volumes or
   the host ruleset as a response to a provider firewall problem.

Host rules cannot undo provider-side drops: `ufw disable` or `nft flush ruleset`
is not the rollback. If hPanel is unavailable, use the verified provider recovery
channel/support to detach or restore the group. Do not start a disruptive emergency
reboot or OS reinstall as an automatic fallback. There is no automatic rollback
timer for this provider-side operation; Chris must remain available in hPanel.

## Checklist for future verification runs

Firewall activation should require no service restart. The approved ENG-40 run
above is complete. Any future production verification run needs its own explicit
approval and must preserve the following requirements:

- Verify a disposable invitation submission and edit in the real application, with
  an agreed cleanup plan. This writes production data and is not part of read-only checks.
- Verify the restricted GitHub key from a GitHub runner. A complete deployment
  exercises backups, migrations and service replacement, so it needs separate
  deployment approval. A successful personal key login does not prove the CI key.
- In an approved maintenance window, check policy attachment, fresh SSH, web/API,
  private connectivity and outside probes after Docker restart, service recreation
  and VPS reboot. Preserve the PostgreSQL and Caddy volumes and key-only SSH policy.
  Do not invent an unreviewed Compose command or revision for these operations.
- Verify DNS resolution and outbound HTTPS from the host and existing application
  environment, plus API/database health and certificate validity. Do not force
  certificate renewal or create test responses without approval.

Record UTC timestamps, exact target and measurement network, group ID/rules and
sync state, before/after results, recovery validation and every unverified item in
ENG-40. Keep guest data, credentials, private keys and complete request logs out of
reports. Distinguish Chris's hPanel/recovery confirmations from independent agent
inspection, and use actual lifecycle measurements to prove the tested persistence
behavior rather than assuming it from the provider architecture.

## Sources

- [Hostinger managed VPS firewall](https://www.hostinger.com/support/8172641-how-to-use-a-managed-vps-firewall-at-hostinger/): provider filtering, IP families, default drop, activation and synchronization.
- [Docker packet filtering](https://docs.docker.com/engine/network/packet-filtering-firewalls/): Docker/UFW interaction and preservation of Docker rules.
- [Docker iptables](https://docs.docker.com/engine/network/firewall-iptables/): `DOCKER-USER` and original destination matching after DNAT.
- [RFC 4890](https://www.rfc-editor.org/info/rfc4890/): IPv6 control traffic considerations.
