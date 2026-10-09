import { loadEnvFile } from "node:process";

export interface Config {
  databaseUrl: string;
  port: number;
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

  return { databaseUrl, port };
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
