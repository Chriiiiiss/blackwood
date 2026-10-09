#!/usr/bin/python3
"""Restricted VPS entry point for deployment and scheduled database backups."""

import base64
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import urllib.request


REPOSITORY = "Chriiiiiss/blackwood"
ROOT = Path("/opt/blackwood")


def command_revision(command):
    match = re.fullmatch(r"deploy ([0-9a-f]{40})", command)
    if not match:
        raise ValueError("Only a deployment of a full commit identifier is allowed.")
    return match.group(1)


def github(path, token):
    request = urllib.request.Request(
        f"https://api.github.com/repos/{REPOSITORY}/{path}",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "blackwood-deployment",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def run(args, **kwargs):
    return subprocess.run(args, check=True, timeout=300, **kwargs)


def compose(release, env, args, **kwargs):
    return run(
        [
            "docker", "compose", "--project-name", "blackwood-production",
            "--env-file", str(ROOT / ".env.production"),
            "--file", str(release / "compose.production.yaml"), *args,
        ],
        env=env, **kwargs,
    )


def release_env(revision):
    return {
        **os.environ,
        "APP_VERSION": revision,
        "IMAGE_PREFIX": f"ghcr.io/{REPOSITORY.lower()}",
    }


def backup(release):
    revision = (release / "REVISION").read_text().strip()
    env = release_env(revision)
    compose(release, env, ["up", "-d", "--wait", "--wait-timeout", "60", "db"])
    folder = ROOT / "backups"
    folder.mkdir(mode=0o700, exist_ok=True)
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    temporary = folder / f".blackwood-{stamp}-{revision[:12]}.dump.partial"
    destination = folder / f"blackwood-{stamp}-{revision[:12]}.dump"
    try:
        with temporary.open("xb") as output:
            compose(release, env, [
                "exec", "-T", "db", "sh", "-c",
                'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc',
            ], stdout=output)
        if temporary.stat().st_size == 0:
            raise RuntimeError("The database backup is empty.")
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
    print(f"Database backup saved: {destination}", flush=True)
    return destination


def deploy(revision, token):
    print("Checking the requested main revision.", flush=True)
    if github("commits/main", token)["sha"] != revision:
        raise ValueError("Deployments must use the current main revision.")
    content = github(f"contents/compose.production.yaml?ref={revision}", token)
    manifest = base64.b64decode(content["content"], validate=False)
    release = ROOT / "releases" / revision
    release.mkdir(parents=True, mode=0o700, exist_ok=True)
    (release / "compose.production.yaml").write_bytes(manifest)
    (release / "REVISION").write_text(revision + "\n")
    environment_link = release / ".env.production"
    if not environment_link.exists():
        environment_link.symlink_to(ROOT / ".env.production")

    with tempfile.TemporaryDirectory(prefix="blackwood-registry-") as credentials:
        env = {**release_env(revision), "DOCKER_CONFIG": credentials}
        run([
            "docker", "login", "ghcr.io", "--username", REPOSITORY.split("/")[0],
            "--password-stdin",
        ], input=token.encode(), env=env)
        print("Pulling the versioned production images.", flush=True)
        compose(release, env, ["pull", "api", "web"])

        current = ROOT / "current"
        first_deployment = not current.exists()
        if not first_deployment:
            backup(current.resolve())

        print("Applying migrations before replacing the application services.", flush=True)
        compose(release, env, ["up", "-d", "--wait", "--wait-timeout", "60", "db"])
        compose(release, env, ["run", "--rm", "--pull", "never", "migrate"])
        print("Starting the new application services.", flush=True)
        compose(release, env, [
            "up", "-d", "--no-build", "--wait", "--wait-timeout", "120", "api", "web",
        ])

        link = ROOT / ".current-next"
        link.unlink(missing_ok=True)
        link.symlink_to(release, target_is_directory=True)
        link.replace(current)

        configuration = ROOT / ".env.production"
        lines = configuration.read_text().splitlines()
        lines = [line for line in lines if not line.startswith(("APP_VERSION=", "IMAGE_PREFIX="))]
        lines.extend([
            f"APP_VERSION={revision}",
            f"IMAGE_PREFIX=ghcr.io/{REPOSITORY.lower()}",
        ])
        staged = ROOT / ".env.production.next"
        staged.write_text("\n".join(lines) + "\n")
        staged.chmod(0o600)
        staged.replace(configuration)
        if first_deployment:
            backup(release)
    print(f"Production services started for {revision}.", flush=True)


def main():
    os.umask(0o077)
    ROOT.mkdir(mode=0o700, exist_ok=True)
    with (ROOT / ".deployment.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("A deployment or backup is already running.") from None
        command = os.environ.get("SSH_ORIGINAL_COMMAND")
        if command is not None:
            revision = command_revision(command)
            token = sys.stdin.readline(16385).removesuffix("\n").removesuffix("\r")
            # Accept opaque HTTP Bearer credentials, including stateless GitHub tokens.
            if len(token) > 16384 or not re.fullmatch(r"[A-Za-z0-9._~+/-]+=*", token):
                raise ValueError("A temporary GitHub token is required on standard input.")
            deploy(revision, token)
        elif sys.argv[1:] == ["backup"]:
            current = ROOT / "current"
            if current.exists():
                backup(current.resolve())
                for old in (ROOT / "backups").glob("blackwood-*.dump"):
                    if old.stat().st_mtime < time.time() - 14 * 86400:
                        old.unlink()
            else:
                print("No active deployment to back up yet.")
        else:
            raise ValueError("Use the restricted SSH deployment command or local backup mode.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Avoid exception payloads that could contain HTTP headers or credentials.
        print(f"Deployment failed ({type(error).__name__}); inspect the preceding step.", file=sys.stderr)
        sys.exit(1)
