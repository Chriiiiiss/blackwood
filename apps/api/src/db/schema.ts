import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
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

export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id").primaryKey(),
    firstName: varchar("first_name", { length: 50 }).notNull(),
    role: varchar("role", { length: 9 })
      .$type<"main" | "companion">()
      .notNull(),
    avatarMediaId: uuid("avatar_media_id").references(
      (): AnyPgColumn => mediaAssets.id,
      { onDelete: "restrict" },
    ),
    legacyAccessEnabled: boolean("legacy_access_enabled")
      .default(true)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "profile_first_name_not_empty",
      sql`length(btrim(${table.firstName})) > 0`,
    ),
    check("profile_role", sql`${table.role} IN ('main', 'companion')`),
  ],
);

export const profileResponseLinks = pgTable("profile_response_links", {
  profileId: uuid("profile_id")
    .primaryKey()
    .references(() => profiles.id, { onDelete: "restrict" }),
  responseId: uuid("response_id")
    .notNull()
    .unique()
    .references(() => invitationResponses.id, { onDelete: "restrict" }),
});

export const guestCompanions = pgTable(
  "guest_companions",
  {
    mainProfileId: uuid("main_profile_id")
      .primaryKey()
      .references(() => profiles.id, { onDelete: "restrict" }),
    companionProfileId: uuid("companion_profile_id")
      .notNull()
      .unique()
      .references(() => profiles.id, { onDelete: "restrict" }),
  },
  (table) => [
    check(
      "distinct_companion_profiles",
      sql`${table.mainProfileId} <> ${table.companionProfileId}`,
    ),
  ],
);

export const guestSessions = pgTable("guest_sessions", {
  tokenHash: varchar("token_hash", { length: 64 }).primaryKey(),
  profileId: uuid("profile_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const companionInvitations = pgTable(
  "companion_invitations",
  {
    mainProfileId: uuid("main_profile_id")
      .primaryKey()
      .references(() => profiles.id, { onDelete: "restrict" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    claimedProfileId: uuid("claimed_profile_id").references(() => profiles.id, {
      onDelete: "restrict",
    }),
  },
  (table) => [unique("companion_invitation_token_unique").on(table.tokenHash)],
);

export const hubSettings = pgTable(
  "hub_settings",
  {
    id: integer("id").primaryKey(),
    hubEnabled: boolean("hub_enabled").notNull().default(false),
  },
  (table) => [check("single_hub_setting", sql`${table.id} = 1`)],
);

export const mediaAssets = pgTable(
  "media_assets",
  {
    id: uuid("id").primaryKey(),
    ownerProfileId: uuid("owner_profile_id").references(
      (): AnyPgColumn => profiles.id,
      { onDelete: "restrict" },
    ),
    purpose: varchar("purpose", { length: 6 })
      .$type<"avatar" | "photo">()
      .notNull(),
    status: varchar("status", { length: 8 })
      .$type<"pending" | "staged" | "ready" | "deleting">()
      .notNull(),
    width: integer("width"),
    height: integer("height"),
    bytes: integer("bytes"),
    thumbnailWidth: integer("thumbnail_width"),
    thumbnailHeight: integer("thumbnail_height"),
    thumbnailBytes: integer("thumbnail_bytes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("media_purpose", sql`${table.purpose} IN ('avatar', 'photo')`),
    check(
      "media_status",
      sql`${table.status} IN ('pending', 'staged', 'ready', 'deleting')`,
    ),
    check(
      "avatar_owner",
      sql`${table.purpose} <> 'avatar' OR ${table.ownerProfileId} IS NOT NULL`,
    ),
    check(
      "media_dimensions",
      sql`${table.status} IN ('pending', 'deleting') OR (${table.width} IS NOT NULL AND ${table.height} IS NOT NULL AND ${table.bytes} IS NOT NULL AND ${table.width} > 0 AND ${table.width} <= 1920 AND ${table.height} > 0 AND ${table.height} <= 1920 AND ${table.bytes} > 0)`,
    ),
  ],
);
