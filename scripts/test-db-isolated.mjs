import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const name = `blackwood-db-test-${randomUUID().slice(0, 8)}`;
const env = {
  ...process.env,
  POSTGRES_PASSWORD: randomBytes(32).toString("hex"),
};
const docker = (args) =>
  execFileSync("docker", args, { env, encoding: "utf8", timeout: 120_000 });
let started = false;
try {
  docker([
    "run",
    "--detach",
    "--name",
    name,
    "--publish",
    "127.0.0.1::5432",
    "--tmpfs",
    "/var/lib/postgresql",
    "--env",
    "POSTGRES_PASSWORD",
    "--env",
    "POSTGRES_USER=blackwood",
    "--env",
    "POSTGRES_DB=blackwood",
    "postgres:18.6-trixie",
  ]);
  started = true;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      docker([
        "exec",
        name,
        "pg_isready",
        "-U",
        "blackwood",
        "-d",
        "blackwood",
      ]);
      ready = true;
      break;
    } catch {
      await setTimeout(1000);
    }
  }
  if (!ready) throw new Error("Isolated PostgreSQL did not become ready.");
  const port = docker(["port", name, "5432"]).trim().split(":").at(-1);
  const testEnv = {
    ...env,
    DATABASE_URL: `postgresql://blackwood:${env.POSTGRES_PASSWORD}@127.0.0.1:${port}/blackwood`,
    BLACKWOOD_ISOLATED_TEST_DB: "1",
    ORGANIZER_PASSWORD_HASH: "",
    APP_ORIGIN: "http://localhost:5173",
  };
  for (const args of [
    ["db:migrate"],
    ["--filter", "@blackwood/api", "test:db"],
  ]) {
    execFileSync("pnpm", args, {
      cwd: root,
      env: testEnv,
      stdio: "inherit",
      timeout: 180_000,
    });
  }
} finally {
  if (started) docker(["rm", "--force", name]);
}
