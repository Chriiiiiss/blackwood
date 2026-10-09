import { sql } from "drizzle-orm";
import {
  boolean,
  check,
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
