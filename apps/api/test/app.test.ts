import assert from "node:assert/strict";
import { test } from "node:test";
import { Type } from "@fastify/type-provider-typebox";
import { Pool } from "pg";
import { buildApp } from "../src/app.ts";

const config = {
  databaseUrl: "postgresql://user:secret@127.0.0.1:5432/test",
  appOrigin: "http://localhost:5173",
  port: 3000,
};

test("healthcheck needs no port and shutdown closes the pool", async (t) => {
  t.mock.method(Pool.prototype, "query", async () => ({ rows: [] }));
  const end = t.mock.method(Pool.prototype, "end", async () => {});
  const app = buildApp(config, { logger: false });
  t.after(() => app.close());

  const response = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ok" });
  assert.equal(app.server.listening, false);
  await app.close();
  assert.equal(end.mock.callCount(), 1);
});

test("a PostgreSQL outage after startup returns 503", async (t) => {
  t.mock.method(Pool.prototype, "query", async () => ({ rows: [] }));
  t.mock.method(Pool.prototype, "end", async () => {});
  const app = buildApp(config, { logger: false });
  t.after(() => app.close());
  await app.ready();
  t.mock.method(Pool.prototype, "query", async () => {
    throw new Error("database offline");
  });

  const response = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { status: "unavailable" });
});

test("the API refuses to start when PostgreSQL is unreachable", async (t) => {
  t.mock.method(Pool.prototype, "query", async () => {
    throw new Error("database offline");
  });
  const end = t.mock.method(Pool.prototype, "end", async () => {});
  const app = buildApp(config, { logger: false });
  await assert.rejects(async () => {
    await app.ready();
  });
  await app.close();
  assert.equal(end.mock.callCount(), 1);
});

test("Fastify validates TypeBox schemas before running the handler", async (t) => {
  t.mock.method(Pool.prototype, "query", async () => ({ rows: [] }));
  t.mock.method(Pool.prototype, "end", async () => {});
  const app = buildApp(config, { logger: false });
  t.after(() => app.close());
  let calls = 0;
  app.post(
    "/validation-test",
    {
      schema: { body: Type.Object({ message: Type.String({ minLength: 1 }) }) },
    },
    async (request) => {
      calls += 1;
      return { message: request.body.message };
    },
  );

  for (const payload of [{}, { message: "" }, { message: { invalid: true } }]) {
    const response = await app.inject({
      method: "POST",
      url: "/validation-test",
      payload,
    });
    assert.equal(response.statusCode, 400);
  }
  assert.equal(calls, 0);
  const response = await app.inject({
    method: "POST",
    url: "/validation-test",
    payload: { message: "ok" },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { message: "ok" });
  assert.equal(calls, 1);
});
