import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { loadConfig } from "../config/env.ts";
import { createDatabase } from "./client.ts";

const { db, pool } = createDatabase(loadConfig().databaseUrl);

try {
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
  });
  console.log("Database migrations applied successfully.");
} finally {
  await pool.end();
}
