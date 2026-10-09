import base64
from contextlib import redirect_stdout
import io
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import remote


OLD = "a" * 40
NEW = "b" * 40


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        root_patch = patch.object(remote, "ROOT", self.root)
        root_patch.start()
        self.addCleanup(root_patch.stop)
        self.configuration = self.root / ".env.production"
        self.configuration.write_text("POSTGRES_PASSWORD=fixture-password\nAPP_VERSION=local\n")
        self.old = self.root / "releases" / OLD
        self.old.mkdir(parents=True)
        (self.old / "REVISION").write_text(OLD)
        (self.root / "current").symlink_to(self.old, target_is_directory=True)
        self.events = []

    def github(self, path, token):
        self.assertEqual(token, "temporary_token")
        if path == "commits/main":
            return {"sha": NEW}
        self.assertEqual(path, f"contents/compose.production.yaml?ref={NEW}")
        return {"content": base64.b64encode(b"services: {}\n").decode()}

    def compose(self, release, env, args, **kwargs):
        self.events.append(args)
        return subprocess.CompletedProcess(args, 0)

    def backup(self, release):
        self.events.append(["backup", release.name])

    def execute(self, compose=None, backup=None):
        with (
            patch.object(remote, "github", side_effect=self.github),
            patch.object(remote, "run") as run,
            patch.object(remote, "compose", side_effect=compose or self.compose),
            patch.object(remote, "backup", side_effect=backup or self.backup),
            redirect_stdout(io.StringIO()),
        ):
            remote.deploy(NEW, "temporary_token")
            return run

    def test_restricted_command_rejects_shell_commands_and_partial_revisions(self):
        self.assertEqual(remote.command_revision("deploy " + NEW), NEW)
        for command in ["bash", "deploy main", "deploy abc123", "deploy " + NEW + "; id", "deploy " + NEW + "\n"]:
            with self.subTest(command=command), self.assertRaises(ValueError):
                remote.command_revision(command)

    def test_ssh_entry_point_passes_legacy_and_stateless_tokens_unchanged(self):
        for token in [
            "ghs_legacy123",
            "ghs_123_eyJhbGciOiJIUzI1NiJ9.eyJpbnN0YWxsYXRpb24iOjF9.signature-with_underscore",
            "ghs_" + "a" * 5000,
        ]:
            with (
                self.subTest(length=len(token), stateless="." in token),
                patch.dict(os.environ, {"SSH_ORIGINAL_COMMAND": "deploy " + NEW}),
                patch.object(remote.os, "umask"),
                patch.object(remote.sys, "stdin", io.StringIO(token + "\n")),
                patch.object(remote, "deploy") as deploy,
            ):
                remote.main()
                deploy.assert_called_once_with(NEW, token)

    def test_ssh_entry_point_rejects_empty_malformed_or_oversized_credentials(self):
        for token in ["", " ", "ghs_token with spaces", "ghs_token\rheader", "ghs_token\x00", "a" * 16385]:
            with (
                self.subTest(length=len(token)),
                patch.dict(os.environ, {"SSH_ORIGINAL_COMMAND": "deploy " + NEW}),
                patch.object(remote.os, "umask"),
                patch.object(remote.sys, "stdin", io.StringIO(token + "\n")),
                patch.object(remote, "deploy") as deploy,
            ):
                with self.assertRaises(ValueError):
                    remote.main()
                deploy.assert_not_called()

    def test_non_main_revision_is_rejected_before_docker_or_release_writes(self):
        with patch.object(remote, "github", return_value={"sha": OLD}), patch.object(remote, "run") as run:
            with self.assertRaises(ValueError), redirect_stdout(io.StringIO()):
                remote.deploy(NEW, "temporary_token")
            run.assert_not_called()
        self.assertFalse((self.root / "releases" / NEW).exists())

    def test_migration_options_are_accepted_by_the_installed_compose_cli(self):
        self.execute()
        migration = next(event for event in self.events if event[0] == "run")
        result = subprocess.run(
            ["docker", "compose", *migration[:-1], "--help"],
            capture_output=True, text=True, timeout=15,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_backup_precedes_migrations_and_success_activates_the_version(self):
        run = self.execute()
        self.assertEqual(self.events[0], ["pull", "api", "web"])
        backup_index = self.events.index(["backup", OLD])
        migration_index = self.events.index(["run", "--rm", "--pull", "never", "migrate"])
        self.assertLess(backup_index, migration_index)
        self.assertEqual((self.root / "current").resolve().name, NEW)
        text = self.configuration.read_text()
        self.assertIn("POSTGRES_PASSWORD=fixture-password", text)
        self.assertIn("APP_VERSION=" + NEW, text)
        self.assertEqual(self.configuration.stat().st_mode & 0o777, 0o600)
        self.assertEqual(run.call_args.kwargs["input"], b"temporary_token")
        self.assertNotIn("temporary_token", str(run.call_args.args))
        self.assertFalse(Path(run.call_args.kwargs["env"]["DOCKER_CONFIG"]).exists())

    def test_pull_failure_preserves_the_current_version_and_skips_migrations(self):
        def fail_pull(release, env, args, **kwargs):
            self.events.append(args)
            raise subprocess.CalledProcessError(1, "docker pull")

        with self.assertRaises(subprocess.CalledProcessError):
            self.execute(compose=fail_pull)
        self.assertEqual(self.events, [["pull", "api", "web"]])
        self.assertEqual((self.root / "current").resolve().name, OLD)

    def test_failed_backup_stops_before_schema_or_application_changes(self):
        def fail_backup(release):
            raise RuntimeError("Fixture backup failure")

        with self.assertRaises(RuntimeError):
            self.execute(backup=fail_backup)
        self.assertEqual(self.events, [["pull", "api", "web"]])
        self.assertEqual((self.root / "current").resolve().name, OLD)

    def test_failed_migration_does_not_replace_services_or_activate_the_version(self):
        def fail_migration(release, env, args, **kwargs):
            self.compose(release, env, args, **kwargs)
            if args[0] == "run":
                raise subprocess.CalledProcessError(1, "migrate")

        with self.assertRaises(subprocess.CalledProcessError):
            self.execute(compose=fail_migration)
        self.assertFalse(any("web" in event for event in self.events if event[0] == "up"))
        self.assertEqual((self.root / "current").resolve().name, OLD)
        self.assertNotIn("APP_VERSION=" + NEW, self.configuration.read_text())

    def test_failed_start_does_not_mark_the_new_version_as_active(self):
        def fail_start(release, env, args, **kwargs):
            self.compose(release, env, args, **kwargs)
            if args[0] == "up" and "web" in args:
                raise subprocess.CalledProcessError(1, "start")

        with self.assertRaises(subprocess.CalledProcessError):
            self.execute(compose=fail_start)
        self.assertEqual((self.root / "current").resolve().name, OLD)

    def test_first_deployment_creates_a_backup_after_startup(self):
        (self.root / "current").unlink()
        self.execute()
        self.assertEqual(self.events[-1], ["backup", NEW])
        self.assertTrue("web" in self.events[-2])

    def test_partial_or_empty_backup_never_becomes_a_completed_dump(self):
        def fail_dump(release, env, args, **kwargs):
            if args[0] == "exec":
                kwargs["stdout"].write(b"partial")
                raise subprocess.CalledProcessError(1, "pg_dump")

        with patch.object(remote, "compose", side_effect=fail_dump):
            with self.assertRaises(subprocess.CalledProcessError):
                remote.backup(self.old)
        self.assertEqual(list((self.root / "backups").iterdir()), [])

        with patch.object(remote, "compose"):
            with self.assertRaises(RuntimeError):
                remote.backup(self.old)
        self.assertEqual(list((self.root / "backups").iterdir()), [])


if __name__ == "__main__":
    unittest.main()
