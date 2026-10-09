import assert from "node:assert/strict";
import { test } from "node:test";
import { parseEnv } from "../src/config/env.ts";

const databaseUrl = "postgresql://user:secret@127.0.0.1:5432/test";

test("configuration accepts PostgreSQL and the default port", () => {
  assert.deepEqual(parseEnv({ DATABASE_URL: databaseUrl }), {
    databaseUrl,
    port: 3000,
    host: "127.0.0.1",
  });
  assert.equal(
    parseEnv({ DATABASE_URL: databaseUrl, API_PORT: "4000" }).port,
    4000,
  );
});

test("configuration accepts container bind addresses and rejects invalid hosts", () => {
  for (const host of ["0.0.0.0", "::", "127.0.0.1"]) {
    assert.equal(
      parseEnv({ DATABASE_URL: databaseUrl, API_HOST: host }).host,
      host,
    );
  }
  for (const host of ["", "https://example.com", "not-an-address"]) {
    assert.throws(
      () => parseEnv({ DATABASE_URL: databaseUrl, API_HOST: host }),
      /API_HOST/,
    );
  }
});

test("missing or invalid database URLs never expose secrets", () => {
  for (const url of [
    undefined,
    "secret",
    "https://user:secret@example.com/db",
    "postgres://localhost",
  ]) {
    const env: NodeJS.ProcessEnv =
      url === undefined ? {} : { DATABASE_URL: url };
    assert.throws(
      () => parseEnv(env),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /DATABASE_URL/);
        assert.ok(!error.message.includes("secret"));
        return true;
      },
    );
  }
});

test("configuration rejects invalid ports", () => {
  for (const port of ["", "0", "65536", "3.5", "abc", "-1", "1e3", " 3000 "]) {
    assert.throws(
      () => parseEnv({ DATABASE_URL: databaseUrl, API_PORT: port }),
      /API_PORT/,
    );
  }
});
