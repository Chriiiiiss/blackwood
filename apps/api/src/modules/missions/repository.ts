import { randomInt } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { createDatabase } from "../../db/client.ts";
import {
  missionAssignments as assignments,
  missionClaims as claims,
  guestSessions,
  hubSettings,
  missionSettings,
  profiles,
} from "../../db/schema.ts";
import { missionCatalog } from "./catalog.ts";
import { MissionError } from "./errors.ts";

type Database = ReturnType<typeof createDatabase>["db"];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type MissionActor = { profileId: string; sessionHash: string };
const timestamp = sql`clock_timestamp()`;

export function createMissionRepository(db: Database) {
  async function requireActor(
    tx: Transaction,
    actor: MissionActor,
    other?: string,
  ) {
    const [settings] = await tx
      .select()
      .from(hubSettings)
      .where(eq(hubSettings.id, 1))
      .for("share");
    if (!settings?.hubEnabled) throw new MissionError(403, "HUB_CLOSED");
    // Lock main profiles before companions, then sessions, matching profile removal.
    const rows = await tx
      .select({
        id: profiles.id,
        enabled: profiles.legacyAccessEnabled,
        deletedAt: profiles.deletedAt,
      })
      .from(profiles)
      .where(
        inArray(
          profiles.id,
          [...new Set([actor.profileId, ...(other ? [other] : [])])].sort(),
        ),
      )
      .orderBy(desc(profiles.role), asc(profiles.id))
      .for("share");
    const own = rows.find((row) => row.id === actor.profileId);
    if (!own?.enabled || own.deletedAt)
      throw new MissionError(401, "GUEST_UNAUTHENTICATED");
    if (
      other &&
      !rows.some((row) => row.id === other && row.enabled && !row.deletedAt)
    )
      throw new MissionError(409, "PLAYER_UNAVAILABLE");
    const [session] = await tx
      .select({ hash: guestSessions.tokenHash })
      .from(guestSessions)
      .where(
        and(
          eq(guestSessions.profileId, actor.profileId),
          eq(guestSessions.tokenHash, actor.sessionHash),
          gt(guestSessions.expiresAt, timestamp),
        ),
      )
      .for("share");
    if (!session) throw new MissionError(401, "GUEST_UNAUTHENTICATED");
  }
  async function requireLiveSession(tx: Transaction, actor: MissionActor) {
    const [session] = await tx
      .select({ hash: guestSessions.tokenHash })
      .from(guestSessions)
      .where(
        and(
          eq(guestSessions.tokenHash, actor.sessionHash),
          eq(guestSessions.profileId, actor.profileId),
          gt(guestSessions.expiresAt, timestamp),
        ),
      );
    if (!session) throw new MissionError(401, "GUEST_UNAUTHENTICATED");
  }
  async function lockAssignment(tx: Transaction, id: string) {
    const [row] = await tx
      .select()
      .from(assignments)
      .where(eq(assignments.id, id))
      .for("update");
    if (!row) throw new MissionError(404, "MISSION_NOT_FOUND");
    return row;
  }
  return {
    async own(profileId: string) {
      const rows = await db
        .select()
        .from(assignments)
        .where(eq(assignments.profileId, profileId))
        .orderBy(desc(assignments.assignedAt));
      const pending = await db
        .select({
          id: claims.id,
          assignmentId: claims.assignmentId,
          recipient: profiles.firstName,
        })
        .from(claims)
        .innerJoin(assignments, eq(assignments.id, claims.assignmentId))
        .innerJoin(profiles, eq(profiles.id, claims.recipientProfileId))
        .where(
          and(
            eq(assignments.profileId, profileId),
            eq(claims.status, "pending"),
          ),
        );
      return { rows, pending };
    },
    async draw(actor: MissionActor, id: string, after: string | null) {
      return db.transaction(async (tx) => {
        await requireActor(tx, actor);
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${actor.profileId}, 0))`,
        );
        const [replay] = await tx
          .select()
          .from(assignments)
          .where(eq(assignments.id, id));
        if (replay) {
          if (replay.profileId !== actor.profileId)
            throw new MissionError(409, "MISSION_CONFLICT");
          return;
        }
        const previous = await tx
          .select()
          .from(assignments)
          .where(eq(assignments.profileId, actor.profileId));
        if (previous.some((row) => !row.completedAt)) return;
        const latest = [...previous].sort(
          (a, b) => b.assignedAt.getTime() - a.assignedAt.getTime(),
        )[0];
        // A delayed retry from an older draw cannot advance a later completed mission.
        if ((latest?.id ?? null) !== after) return;
        const available = missionCatalog.filter(
          ([key]) => !previous.some((row) => row.missionKey === key),
        );
        if (!available.length)
          throw new MissionError(409, "MISSIONS_EXHAUSTED");
        const chosen = available[randomInt(available.length)];
        if (!chosen) throw new Error("Mission catalog unavailable.");
        await requireLiveSession(tx, actor);
        await tx.insert(assignments).values({
          id,
          profileId: actor.profileId,
          missionKey: chosen[0],
          text: chosen[1],
        });
      });
    },
    async players(profileId: string) {
      return db
        .selectDistinct({ id: profiles.id, firstName: profiles.firstName })
        .from(profiles)
        .innerJoin(assignments, eq(assignments.profileId, profiles.id))
        .where(
          and(
            isNull(profiles.deletedAt),
            eq(profiles.legacyAccessEnabled, true),
            sql`${profiles.id} <> ${profileId}`,
          ),
        )
        .orderBy(asc(profiles.firstName), asc(profiles.id));
    },
    async claim(
      actor: MissionActor,
      assignmentId: string,
      id: string,
      recipientProfileId: string,
    ) {
      if (actor.profileId === recipientProfileId)
        throw new MissionError(400, "SELF_CONFIRMATION");
      await db.transaction(async (tx) => {
        await requireActor(tx, actor, recipientProfileId);
        const assignment = await lockAssignment(tx, assignmentId);
        if (assignment.profileId !== actor.profileId)
          throw new MissionError(404, "MISSION_NOT_FOUND");
        const [replay] = await tx
          .select()
          .from(claims)
          .where(eq(claims.id, id));
        if (replay) {
          if (
            replay.assignmentId !== assignmentId ||
            replay.recipientProfileId !== recipientProfileId
          )
            throw new MissionError(409, "CLAIM_CONFLICT");
          return;
        }
        if (assignment.completedAt)
          throw new MissionError(409, "MISSION_COMPLETED");
        const [participant] = await tx
          .select({ id: assignments.id })
          .from(assignments)
          .where(eq(assignments.profileId, recipientProfileId))
          .limit(1);
        if (!participant) throw new MissionError(409, "PLAYER_UNAVAILABLE");
        const [pending] = await tx
          .select({ id: claims.id })
          .from(claims)
          .where(
            and(
              eq(claims.assignmentId, assignmentId),
              eq(claims.status, "pending"),
            ),
          );
        if (pending) throw new MissionError(409, "CLAIM_PENDING");
        await requireLiveSession(tx, actor);
        await tx
          .insert(claims)
          .values({ id, assignmentId, recipientProfileId, status: "pending" });
      });
    },
    async incoming(profileId: string) {
      return db
        .select({
          id: claims.id,
          assignmentId: assignments.id,
          text: assignments.text,
          firstName: profiles.firstName,
        })
        .from(claims)
        .innerJoin(assignments, eq(assignments.id, claims.assignmentId))
        .innerJoin(profiles, eq(profiles.id, assignments.profileId))
        .where(
          and(
            eq(claims.recipientProfileId, profileId),
            eq(claims.status, "pending"),
            isNull(profiles.deletedAt),
            eq(profiles.legacyAccessEnabled, true),
          ),
        )
        .orderBy(asc(claims.requestedAt));
    },
    async decide(
      actor: MissionActor,
      id: string,
      decision: "confirmed" | "rejected" | "cancelled",
    ) {
      await db.transaction(async (tx) => {
        const [initial] = await tx
          .select({
            assignmentId: claims.assignmentId,
            recipient: claims.recipientProfileId,
            sender: assignments.profileId,
          })
          .from(claims)
          .innerJoin(assignments, eq(assignments.id, claims.assignmentId))
          .where(eq(claims.id, id));
        if (
          !initial ||
          (decision === "cancelled" ? initial.sender : initial.recipient) !==
            actor.profileId
        )
          throw new MissionError(404, "CLAIM_NOT_FOUND");
        // Cancellation remains possible when the recipient's access has been removed.
        await requireActor(
          tx,
          actor,
          decision === "cancelled" ? undefined : initial.sender,
        );
        await lockAssignment(tx, initial.assignmentId);
        const [claim] = await tx
          .select()
          .from(claims)
          .where(eq(claims.id, id))
          .for("update");
        if (!claim) throw new MissionError(404, "CLAIM_NOT_FOUND");
        if (claim.status === decision) return;
        if (claim.status !== "pending")
          throw new MissionError(409, "CLAIM_DECIDED");
        await requireLiveSession(tx, actor);
        await tx
          .update(claims)
          .set({ status: decision, decidedAt: timestamp })
          .where(eq(claims.id, id));
        if (decision === "confirmed")
          await tx
            .update(assignments)
            .set({ completedAt: timestamp })
            .where(eq(assignments.id, claim.assignmentId));
      });
    },
    async leaderboard() {
      const rows = await db
        .select({
          firstName: profiles.firstName,
          points: sql<number>`count(${assignments.completedAt})::integer`,
          profileId: profiles.id,
        })
        .from(profiles)
        .innerJoin(assignments, eq(assignments.profileId, profiles.id))
        .where(isNull(profiles.deletedAt))
        .groupBy(profiles.id)
        .orderBy(
          desc(sql`count(${assignments.completedAt})`),
          asc(profiles.firstName),
          asc(profiles.id),
        );
      let rank = 1;
      return rows.map((row, index) => {
        if (index === 0 || rows[index - 1]?.points !== row.points)
          rank = index + 1;
        return { rank, firstName: row.firstName, points: row.points };
      });
    },
    async settings() {
      const [row] = await db
        .select({
          showScoresWithMemories: missionSettings.showScoresWithMemories,
        })
        .from(missionSettings)
        .where(eq(missionSettings.id, 1));
      return row ?? { showScoresWithMemories: false };
    },
    async saveSettings(showScoresWithMemories: boolean) {
      await db
        .insert(missionSettings)
        .values({ id: 1, showScoresWithMemories })
        .onConflictDoUpdate({
          target: missionSettings.id,
          set: { showScoresWithMemories },
        });
      return { showScoresWithMemories };
    },
  };
}
export type MissionRepository = ReturnType<typeof createMissionRepository>;
