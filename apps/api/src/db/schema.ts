import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const attendance = pgEnum("attendance", ["yes", "no", "to_confirm"]);

export const invitationResponses = pgTable(
  "invitation_responses",
  {
    id: uuid("id").primaryKey(),
    firstName: varchar("first_name", { length: 50 }).notNull(),
    attendance: attendance("attendance").notNull(),
    plusOne: boolean("plus_one").notNull(),
    ideas: text("ideas"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("first_name_not_empty", sql`length(btrim(${table.firstName})) > 0`),
    check(
      "ideas_length",
      sql`${table.ideas} IS NULL OR length(${table.ideas}) <= 1000`,
    ),
    check(
      "absent_without_plus_one",
      sql`${table.attendance} <> 'no' OR NOT ${table.plusOne}`,
    ),
  ],
);

export const organizerSessions = pgTable("organizer_sessions", {
  tokenHash: varchar("token_hash", { length: 64 }).primaryKey(),
  credentialFingerprint: varchar("credential_fingerprint", {
    length: 64,
  }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  lastActivity: timestamp("last_activity", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const organizerLoginLimit = pgTable(
  "organizer_login_limit",
  {
    id: integer("id").primaryKey(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull(),
  },
  (table) => [check("single_login_limit", sql`${table.id} = 1`)],
);
