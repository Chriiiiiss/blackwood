import { and, asc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import type { createDatabase } from "../../db/client.ts";
import {
  hubSettings,
  invitationResponses,
  organizerLoginLimit,
  organizerSessions,
  profileResponseLinks,
  profiles,
} from "../../db/schema.ts";

export function createOrganizerRepository(
  db: ReturnType<typeof createDatabase>["db"],
) {
  return {
    async readHubSettings() {
      const [row] = await db
        .select({ hubEnabled: hubSettings.hubEnabled })
        .from(hubSettings)
        .where(eq(hubSettings.id, 1));
      return row ?? { hubEnabled: false };
    },
    async saveHubSettings(hubEnabled: boolean) {
      const [row] = await db
        .insert(hubSettings)
        .values({ id: 1, hubEnabled })
        .onConflictDoUpdate({ target: hubSettings.id, set: { hubEnabled } })
        .returning({ hubEnabled: hubSettings.hubEnabled });
      return row;
    },
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
        .leftJoin(
          profileResponseLinks,
          eq(profileResponseLinks.responseId, invitationResponses.id),
        )
        .leftJoin(profiles, eq(profiles.id, profileResponseLinks.profileId))
        .where(isNull(profiles.deletedAt))
        .orderBy(
          asc(invitationResponses.createdAt),
          asc(invitationResponses.id),
        );
    },
  };
}

export type OrganizerRepository = ReturnType<typeof createOrganizerRepository>;
