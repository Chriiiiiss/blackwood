import { isIP } from "node:net";
import { loadEnvFile } from "node:process";

export interface Config {
  databaseUrl: string;
  port: number;
  host: string;
  appOrigin: string;
}

export function parseEnv(env: NodeJS.ProcessEnv): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname ||
    url.pathname.length <= 1
  ) {
    throw new Error(
      "DATABASE_URL must be a PostgreSQL URL with a database name.",
    );
  }

  const rawPort = env.API_PORT ?? "3000";
  const port = Number(rawPort);
  if (
    !/^\d+$/.test(rawPort) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error("API_PORT must be an integer between 1 and 65535.");
  }

  const host = env.API_HOST ?? "127.0.0.1";
  if (!isIP(host)) {
    throw new Error("API_HOST must be an IPv4 or IPv6 address.");
  }

  let appUrl: URL;
  try {
    appUrl = new URL(env.APP_ORIGIN ?? "http://localhost:5173");
  } catch {
    throw new Error("APP_ORIGIN must be an HTTP or HTTPS origin.");
  }
  if (
    !["http:", "https:"].includes(appUrl.protocol) ||
    appUrl.username ||
    appUrl.password ||
    appUrl.pathname !== "/" ||
    appUrl.search ||
    appUrl.hash
  ) {
    throw new Error(
      "APP_ORIGIN must be an HTTP or HTTPS origin without a path.",
    );
  }

  return { databaseUrl, port, host, appOrigin: appUrl.origin };
}

export function loadConfig(): Config {
  try {
    loadEnvFile(new URL("../../../../.env", import.meta.url));
  } catch (error) {
    if (
      !(error instanceof Error && "code" in error && error.code === "ENOENT")
    ) {
      throw error;
    }
  }
  return parseEnv(process.env);
}
