import { and, asc, eq, gt, lte, or, sql } from "drizzle-orm";
import type { createDatabase } from "../../db/client.ts";
import {
  invitationResponses,
  organizerLoginLimit,
  organizerSessions,
} from "../../db/schema.ts";

export function createOrganizerRepository(
  db: ReturnType<typeof createDatabase>["db"],
) {
  return {
    async cleanExpired(now: Date) {
      await db
        .delete(organizerSessions)
        .where(
          or(
            lte(organizerSessions.expiresAt, now),
            lte(
              organizerSessions.lastActivity,
              new Date(now.getTime() - 86_400_000),
            ),
          ),
        );
    },
    async consumeLoginAttempt(now: Date) {
      const windowStart = new Date(
        Math.floor(now.getTime() / 900_000) * 900_000,
      );
      const [row] = await db
        .insert(organizerLoginLimit)
        .values({ id: 1, windowStart, attempts: 1 })
        .onConflictDoUpdate({
          target: organizerLoginLimit.id,
          set: {
            windowStart: sql`greatest(${organizerLoginLimit.windowStart}, ${windowStart})`,
            attempts: sql`case when ${organizerLoginLimit.windowStart} >= ${windowStart} then least(${organizerLoginLimit.attempts} + 1, 21) else 1 end`,
          },
        })
        .returning({
          attempts: organizerLoginLimit.attempts,
          windowStart: organizerLoginLimit.windowStart,
        });
      return {
        allowed: (row?.attempts ?? 21) <= 20,
        retryAfter: Math.max(
          1,
          Math.ceil(
            ((row?.windowStart ?? windowStart).getTime() +
              900_000 -
              now.getTime()) /
              1000,
          ),
        ),
      };
    },
    async createSession(
      values: typeof organizerSessions.$inferInsert,
      previousTokenHash?: string,
    ) {
      await db.transaction(async (tx) => {
        if (previousTokenHash)
          await tx
            .delete(organizerSessions)
            .where(eq(organizerSessions.tokenHash, previousTokenHash));
        await tx.insert(organizerSessions).values(values);
      });
    },
    async touchSession(
      tokenHash: string,
      credentialFingerprint: string,
      now: Date,
    ) {
      const [row] = await db
        .update(organizerSessions)
        .set({
          lastActivity: sql`greatest(${organizerSessions.lastActivity}, ${now})`,
        })
        .where(
          and(
            eq(organizerSessions.tokenHash, tokenHash),
            eq(organizerSessions.credentialFingerprint, credentialFingerprint),
            gt(organizerSessions.expiresAt, now),
            gt(
              organizerSessions.lastActivity,
              new Date(now.getTime() - 86_400_000),
            ),
          ),
        )
        .returning({ expiresAt: organizerSessions.expiresAt });
      return row;
    },
    async revokeSession(tokenHash: string) {
      await db
        .delete(organizerSessions)
        .where(eq(organizerSessions.tokenHash, tokenHash));
    },
    async readResponses() {
      return db
        .select({
          firstName: invitationResponses.firstName,
          attendance: invitationResponses.attendance,
          plusOne: invitationResponses.plusOne,
          ideas: invitationResponses.ideas,
        })
        .from(invitationResponses)
        .orderBy(
          asc(invitationResponses.createdAt),
          asc(invitationResponses.id),
        );
    },
  };
}

export type OrganizerRepository = ReturnType<typeof createOrganizerRepository>;
