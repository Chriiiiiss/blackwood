import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../src/app.ts";

const config = {
  databaseUrl: "postgresql://user:secret@127.0.0.1:5432/test",
  port: 3000,
};
const url = `/api/invitation-responses/${randomUUID()}`;
const valid = { firstName: "Chris", attendance: "yes", plusOne: false };

test("invalid invitation fields are rejected before accessing PostgreSQL", async (t) => {
  const query = t.mock.method(Pool.prototype, "query", async () => ({
    rows: [],
  }));
  t.mock.method(Pool.prototype, "end", async () => {});
  const app = buildApp(config, { logger: false });
  t.after(() => app.close());
  await app.ready();
  const startupQueries = query.mock.callCount();

  const cases = [
    { payload: {}, field: "firstName" },
    ...["", " \t\n ", "a".repeat(51), null, 42, true, ["Chris"]].map(
      (firstName) => ({ payload: { ...valid, firstName }, field: "firstName" }),
    ),
    ...["maybe", "Yes", "", null, true].map((attendance) => ({
      payload: { ...valid, attendance },
      field: "attendance",
    })),
    { payload: { firstName: "Chris", plusOne: false }, field: "attendance" },
    ...["yes", "to_confirm"].map((attendance) => ({
      payload: { firstName: "Chris", attendance },
      field: "plusOne",
    })),
    ...["false", 0, 1, null, []].map((plusOne) => ({
      payload: { ...valid, plusOne },
      field: "plusOne",
    })),
    ...["a".repeat(1001), 42, null, ["idea"]].map((ideas) => ({
      payload: { ...valid, ideas },
      field: "ideas",
    })),
    { payload: { ...valid, email: "unexpected@example.com" }, field: "email" },
  ];
  for (const { payload, field } of cases) {
    const response = await app.inject({ method: "PUT", url, payload });
    assert.equal(response.statusCode, 400, JSON.stringify(payload));
    const error = response.json();
    assert.equal(error.code, "VALIDATION_ERROR");
    assert.ok(
      error.errors.some((issue: { field: string }) => issue.field === field),
      field,
    );
    assert.equal(response.headers["cache-control"], "no-store");
  }
  for (const payload of [null, [], "invalid"]) {
    const response = await app.inject({
      method: "PUT",
      url,
      payload: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
    });
    assert.equal(response.statusCode, 400);
  }
  assert.equal(query.mock.callCount(), startupQueries);
});

test("invalid response identifiers are refused for reads and writes", async (t) => {
  const query = t.mock.method(Pool.prototype, "query", async () => ({
    rows: [],
  }));
  t.mock.method(Pool.prototype, "end", async () => {});
  const app = buildApp(config, { logger: false });
  t.after(() => app.close());
  await app.ready();
  const startupQueries = query.mock.callCount();
  for (const id of ["1", "chris", "00000000-0000-0000-0000-000000000000"]) {
    for (const method of ["GET", "PUT"] as const) {
      const response = await app.inject({
        method,
        url: `/api/invitation-responses/${id}`,
        payload: valid,
      });
      assert.equal(response.statusCode, 400);
      assert.ok(
        response
          .json()
          .errors.some((issue: { field: string }) => issue.field === "id"),
      );
    }
  }
  assert.equal(query.mock.callCount(), startupQueries);
});

test("invitation responses cannot be listed and unknown identifiers return 404", async (t) => {
  t.mock.method(Pool.prototype, "query", async () => ({ rows: [] }));
  t.mock.method(Pool.prototype, "end", async () => {});
  const app = buildApp(config, { logger: false });
  t.after(() => app.close());
  const list = await app.inject({
    method: "GET",
    url: "/api/invitation-responses",
  });
  assert.equal(list.statusCode, 404);
  const response = await app.inject({ method: "GET", url });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().code, "RESPONSE_NOT_FOUND");
  assert.equal(response.headers["cache-control"], "no-store");
});

test("database errors expose no SQL or credentials to guests", async (t) => {
  t.mock.method(Pool.prototype, "query", async () => ({ rows: [] }));
  t.mock.method(Pool.prototype, "end", async () => {});
  const app = buildApp(config, { logger: false });
  t.after(() => app.close());
  await app.ready();
  t.mock.method(Pool.prototype, "query", async () => {
    throw new Error(
      "postgresql://user:secret@localhost/test insert into invitation_responses",
    );
  });
  for (const method of ["GET", "PUT"] as const) {
    const response = await app.inject({ method, url, payload: valid });
    assert.equal(response.statusCode, 500);
    assert.equal(response.json().code, "RESPONSE_UNAVAILABLE");
    assert.ok(!response.body.includes("secret"));
    assert.ok(!response.body.includes("insert into"));
  }
});

test("malformed JSON returns an actionable request error", async (t) => {
  t.mock.method(Pool.prototype, "query", async () => ({ rows: [] }));
  t.mock.method(Pool.prototype, "end", async () => {});
  const app = buildApp(config, { logger: false });
  t.after(() => app.close());
  const response = await app.inject({
    method: "PUT",
    url,
    payload: "{",
    headers: { "content-type": "application/json" },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().code, "INVALID_REQUEST");
});
