import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { createDatabase } from "../../db/client.ts";
import { activityEvents as events, profiles } from "../../db/schema.ts";
import type { ActivityFilters } from "./schemas.ts";

type Database = ReturnType<typeof createDatabase>["db"];
export function createActivityRepository(db: Database) {
  return {
    async record(event: typeof events.$inferInsert) {
      await db.insert(events).values(event).onConflictDoNothing();
    },
    async feed(filters: ActivityFilters) {
      const [cursor] = filters.before
        ? await db
            .select({
              id: events.id,
              createdAt: sql<string>`${events.createdAt}::text`,
            })
            .from(events)
            .where(eq(events.id, filters.before))
        : [];
      if (filters.before && !cursor) return { events: [], nextCursor: null };
      const rows = await db
        .select({
          id: events.id,
          profileId: events.profileId,
          firstName: profiles.firstName,
          kind: events.kind,
          page: events.page,
          route: events.route,
          method: events.method,
          status: events.status,
          code: events.code,
          source: events.source,
          createdAt: events.createdAt,
        })
        .from(events)
        .leftJoin(profiles, eq(profiles.id, events.profileId))
        .where(
          and(
            filters.profileId === "anonymous"
              ? isNull(events.profileId)
              : filters.profileId
                ? eq(events.profileId, filters.profileId)
                : undefined,
            filters.page ? eq(events.page, filters.page) : undefined,
            filters.onlyErrors
              ? inArray(events.kind, [
                  "api_error",
                  "client_error",
                  "network_error",
                ])
              : undefined,
            cursor
              ? or(
                  lt(events.createdAt, sql`${cursor.createdAt}::timestamptz`),
                  and(
                    eq(events.createdAt, sql`${cursor.createdAt}::timestamptz`),
                    lt(events.id, cursor.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(desc(events.createdAt), desc(events.id))
        .limit(51);
      return {
        events: rows
          .slice(0, 50)
          .map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
        nextCursor: rows.length > 50 ? (rows[49]?.id ?? null) : null,
      };
    },
  };
}
export type ActivityRepository = ReturnType<typeof createActivityRepository>;
