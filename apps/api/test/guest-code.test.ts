import assert from "node:assert/strict";
import { test } from "node:test";
import {
  generateGuestCode,
  normalizeGuestCode,
  validGuestCode,
} from "../src/modules/profiles/code.ts";

test("personal codes accept case and separators without treating public identifiers as credentials", () => {
  const normalized = normalizeGuestCode(" abcd-efgh jkmn-pqrs-tvwx\n");
  assert.equal(normalized, "ABCDEFGHJKMNPQRSTVWX");
  assert.equal(validGuestCode(normalized), true);
  for (const invalid of [
    "Alex",
    "151597a3-d728-414d-9b74-717386c10b01",
    "I".repeat(20),
    "O".repeat(20),
    "U".repeat(20),
    "A".repeat(19),
    "A".repeat(21),
  ]) {
    assert.equal(validGuestCode(normalizeGuestCode(invalid)), false);
  }
  const generated = generateGuestCode();
  assert.match(
    generated,
    /^[0-9A-HJKMNP-TV-Z]{4}(?:-[0-9A-HJKMNP-TV-Z]{4}){4}$/,
  );
  assert.equal(validGuestCode(normalizeGuestCode(generated)), true);
  assert.notEqual(generated, generateGuestCode());
});
