import { isIP } from "node:net";
import { isAbsolute } from "node:path";
import { loadEnvFile } from "node:process";
import { parsePasswordHash } from "../modules/organizer/password.ts";

export interface Config {
  databaseUrl: string;
  port: number;
  host: string;
  appOrigin: string;
  organizerPasswordHash?: string;
  mediaRoot?: string;
  partyOpensAt?: string;
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

  const organizerPasswordHash = env.ORGANIZER_PASSWORD_HASH;
  const mediaRoot = env.MEDIA_ROOT;
  if (mediaRoot !== undefined && (!mediaRoot || !isAbsolute(mediaRoot))) {
    throw new Error("MEDIA_ROOT must be an absolute filesystem path.");
  }
  if (organizerPasswordHash !== undefined && organizerPasswordHash !== "") {
    parsePasswordHash(organizerPasswordHash);
    if (
      appUrl.protocol !== "https:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(appUrl.hostname)
    ) {
      throw new Error(
        "Organizer access requires an HTTPS APP_ORIGIN outside loopback.",
      );
    }
  }
  const partyOpensAt = env.PARTY_OPENS_AT;
  if (
    partyOpensAt &&
    (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      partyOpensAt,
    ) ||
      !Number.isFinite(Date.parse(partyOpensAt)))
  ) {
    throw new Error(
      "PARTY_OPENS_AT must be an ISO date-time with an explicit timezone.",
    );
  }
  return {
    databaseUrl,
    port,
    host,
    appOrigin: appUrl.origin,
    ...(organizerPasswordHash ? { organizerPasswordHash } : {}),
    ...(mediaRoot ? { mediaRoot } : {}),
    ...(partyOpensAt
      ? { partyOpensAt: new Date(partyOpensAt).toISOString() }
      : {}),
  };
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
