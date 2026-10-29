import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";

export async function pairTv(
  app: FastifyInstance,
  admin: { origin: string; cookie: string },
) {
  const pairing = await app.inject({
    method: "POST",
    url: "/api/organizer/tv/pairing",
    headers: { ...admin, "x-organizer-request": "1" },
    payload: {},
  });
  assert.equal(pairing.statusCode, 200, pairing.body);
  const login = await app.inject({
    method: "POST",
    url: "/api/tv/session",
    headers: { origin: admin.origin, "x-tv-request": "1" },
    payload: { code: pairing.json().code },
  });
  assert.equal(login.statusCode, 200, login.body);
  const cookie = login.cookies.find((value) =>
    value.name.includes("blackwood-tv"),
  );
  assert.ok(cookie, login.body);
  return { cookie: `${cookie.name}=${cookie.value}` };
}
