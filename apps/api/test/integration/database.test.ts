import assert from "node:assert/strict";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { buildApp } from "../../src/app.ts";
import { loadConfig } from "../../src/config/env.ts";
import { createDatabase } from "../../src/db/client.ts";

test("the API and Drizzle access real PostgreSQL after migrations", async (t) => {
  const config = loadConfig();
  const app = buildApp(config, { logger: false });
  t.after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(response.statusCode, 200);

  const { db, pool } = createDatabase(config.databaseUrl);
  t.after(() => pool.end());
  const result = await db.execute<{ relation: string | null }>(
    sql`select to_regclass('drizzle.__drizzle_migrations')::text as relation`,
  );
  assert.equal(result.rows[0]?.relation, "drizzle.__drizzle_migrations");
});
