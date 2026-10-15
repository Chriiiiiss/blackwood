import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Pool } from "pg";
import { loadConfig } from "../../src/config/env.ts";

test("profile migration preserves legacy response values and backfills idempotently", {
  skip: process.env.BLACKWOOD_ISOLATED_TEST_DB !== "1",
}, async () => {
  const config = loadConfig();
  const admin = new Pool({ connectionString: config.databaseUrl });
  const name = `migration_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(config.databaseUrl);
  url.pathname = `/${name}`;
  const database = new Pool({ connectionString: url.toString() });
  try {
    // This generated identifier belongs to the explicitly isolated test instance.
    await admin.query(`CREATE DATABASE "${name}"`);
    for (const migration of [
      "0000_foamy_stryfe.sql",
      "0001_daffy_gabe_jones.sql",
    ]) {
      await database.query(
        await readFile(
          new URL(`../../drizzle/${migration}`, import.meta.url),
          "utf8",
        ),
      );
    }
    const ids = [randomUUID(), randomUUID()];
    for (const [index, id] of ids.entries()) {
      await database.query(
        "INSERT INTO invitation_responses (id,first_name,attendance,plus_one,ideas,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [
          id,
          "Same name",
          index ? "no" : "to_confirm",
          !index,
          index ? null : " Untouched idea ",
          "2026-10-01T12:00:00Z",
          "2026-10-02T14:00:00Z",
        ],
      );
    }
    const before = (
      await database.query("SELECT * FROM invitation_responses ORDER BY id")
    ).rows;
    const migration = await readFile(
      new URL("../../drizzle/0002_bizarre_grim_reaper.sql", import.meta.url),
      "utf8",
    );
    await database.query(migration);
    assert.deepEqual(
      (await database.query("SELECT * FROM invitation_responses ORDER BY id"))
        .rows,
      before,
    );
    const links = (
      await database.query(
        "SELECT * FROM profile_response_links ORDER BY response_id",
      )
    ).rows;
    assert.equal(links.length, 2);
    assert.ok(links.every((link) => link.profile_id !== link.response_id));
    const profiles = (
      await database.query("SELECT * FROM profiles ORDER BY id")
    ).rows;
    assert.equal(profiles.length, 2);
    assert.ok(
      profiles.every(
        (profile) =>
          profile.first_name === "Same name" && profile.role === "main",
      ),
    );
    const backfill = migration.slice(migration.indexOf("-- Backfill links"));
    await database.query(backfill);
    await database.query(backfill);
    assert.deepEqual(
      (await database.query("SELECT * FROM profiles ORDER BY id")).rows,
      profiles,
    );
    assert.deepEqual(
      (
        await database.query(
          "SELECT * FROM profile_response_links ORDER BY response_id",
        )
      ).rows,
      links,
    );
    assert.deepEqual(
      (await database.query("SELECT * FROM invitation_responses ORDER BY id"))
        .rows,
      before,
    );
    await assert.rejects(
      database.query("DELETE FROM invitation_responses WHERE id=$1", [ids[0]]),
    );
    await assert.rejects(
      database.query("DELETE FROM profiles WHERE id=$1", [profiles[0]?.id]),
    );
  } finally {
    await database.end();
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    await admin.end();
  }
});
