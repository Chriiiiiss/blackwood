import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonicalActivityRoute,
  createActivityService,
} from "../src/modules/activity/service.ts";

test("activity stores route templates without access identifiers, queries or fragments", () => {
  assert.equal(
    canonicalActivityRoute(
      "/api/invitation-responses/61601657-b814-4a20-af61-8cfe57a679a3?code=SECRET#token=PRIVATE",
    ),
    "/api/invitation-responses/:id",
  );
  assert.equal(
    canonicalActivityRoute("/api/coffre/contributions"),
    "/api/coffre/contributions",
  );
  assert.equal(
    canonicalActivityRoute("/api/organizer/session?password=SECRET"),
    null,
  );
  assert.equal(
    canonicalActivityRoute("https://unrelated.example/api/coffre"),
    null,
  );
});

test("activity resolves identity on the server and bounds telemetry without rejecting business actions", async () => {
  let count = 0;
  let now = 1000;
  const service = createActivityService(
    {
      record: async (row) => {
        assert.equal(row.profileId, null);
        count++;
      },
      feed: async () => ({ events: [], nextCursor: null }),
    },
    { access: async () => ({ profile: null, hubEnabled: false }) },
    () => now,
  );
  for (let i = 0; i < 65; i++)
    await service.record({
      id: "61601657-b814-4a20-af61-8cfe57a679a3",
      kind: "page_view",
      page: "hub",
    });
  assert.equal(count, 60);
  now += 60_000;
  await service.record({
    id: "61601657-b814-4a20-af61-8cfe57a679a3",
    kind: "page_view",
    page: "hub",
  });
  assert.equal(count, 61);
});
