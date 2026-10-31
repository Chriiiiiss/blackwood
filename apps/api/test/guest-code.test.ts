import assert from "node:assert/strict";
import { test } from "node:test";
import {
  generateGuestCode,
  normalizeGuestCode,
  validGuestCode,
} from "../src/modules/profiles/code.ts";
import { ProfileError } from "../src/modules/profiles/errors.ts";
import type { ProfileRepository } from "../src/modules/profiles/repository.ts";
import { createProfileService } from "../src/modules/profiles/service.ts";

test("new personal codes contain four digits and preserve leading zeros", () => {
  for (let index = 0; index < 100; index++)
    assert.match(generateGuestCode(), /^[0-9]{4}$/);
  assert.equal(normalizeGuestCode(" 00 07\n"), "0007");
  assert.equal(validGuestCode("0007"), true);
  for (const invalid of [
    "Alex",
    "123",
    "12345",
    "12.4",
    "１２３４",
    "151597a3-d728-414d-9b74-717386c10b01",
  ])
    assert.equal(validGuestCode(normalizeGuestCode(invalid)), false);
});
test("previously distributed personal codes remain valid until rotation", () => {
  assert.equal(
    validGuestCode(normalizeGuestCode(" abcd-efgh jkmn-pqrs-tvwx\n")),
    true,
  );
  for (const invalid of [
    "I".repeat(20),
    "O".repeat(20),
    "U".repeat(20),
    "A".repeat(19),
    "A".repeat(21),
  ])
    assert.equal(validGuestCode(invalid), false);
});
test("code issuance retries collisions and bounds allocation failure", async () => {
  let calls = 0;
  const repository = {
    async issueCode() {
      return ++calls > 2;
    },
  } as unknown as ProfileRepository;
  const service = createProfileService(repository);
  assert.match((await service.issueCode("profile")).code, /^[0-9]{4}$/);
  assert.equal(calls, 3);
  repository.issueCode = async () => {
    calls++;
    return false;
  };
  calls = 0;
  await assert.rejects(
    service.issueCode("profile"),
    (error) =>
      error instanceof ProfileError &&
      error.status === 503 &&
      error.code === "GUEST_CODE_UNAVAILABLE",
  );
  assert.equal(calls, 32);
});
