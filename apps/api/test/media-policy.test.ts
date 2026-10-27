import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canDepositContributionMedia,
  canReadContributionMedia,
  type MediaActor,
} from "../src/modules/media/policy.ts";

test("Coffre media never grants authors, anonymous viewers or TV an exception to visibility", () => {
  const actors: MediaActor[] = [
    { kind: "anonymous" },
    { kind: "guest", profileId: "author" },
    { kind: "organizer" },
  ];
  for (const actor of actors) {
    assert.equal(canReadContributionMedia(actor, null), false);
    for (const visibility of ["private", "public"] as const)
      for (const revealed of [false, true])
        for (const deleted of [false, true])
          for (const current of [false, true])
            assert.equal(
              canReadContributionMedia(actor, {
                visibility,
                revealed,
                deleted,
                current,
              }),
              !deleted &&
                (actor.kind === "organizer" ||
                  (actor.kind === "guest" &&
                    visibility === "public" &&
                    revealed &&
                    current)),
            );
  }
});

test("Coffre deposits close exactly at the deadline and remain organizer-only before launch", () => {
  const now = new Date("2026-10-31T20:00:00Z");
  const guest: MediaActor = { kind: "guest", profileId: "author" };
  assert.equal(canDepositContributionMedia(guest, null, now), false);
  assert.equal(
    canDepositContributionMedia(
      guest,
      { state: "prepared", deadline: null },
      now,
    ),
    false,
  );
  assert.equal(
    canDepositContributionMedia(
      { kind: "organizer" },
      { state: "prepared", deadline: null },
      now,
    ),
    true,
  );
  for (const kind of ["anonymous", "guest", "organizer"] as const) {
    const actor: MediaActor = kind === "guest" ? guest : { kind };
    for (const offset of [-1, 0, 1])
      assert.equal(
        canDepositContributionMedia(
          actor,
          { state: "collecting", deadline: new Date(now.getTime() + offset) },
          now,
        ),
        kind !== "anonymous" && offset > 0,
      );
    assert.equal(
      canDepositContributionMedia(
        actor,
        { state: "revealed", deadline: new Date(now.getTime() + 1) },
        now,
      ),
      false,
    );
  }
});
