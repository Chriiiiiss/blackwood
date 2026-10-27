import { and, asc, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import type { createDatabase } from "../../db/client.ts";
import {
  coffreContributions,
  coffres,
  guestSessions,
  hubSettings,
  profiles,
} from "../../db/schema.ts";
import type { ContributionMediaContext } from "../media/policy.ts";
import type { MediaRepository, MediaTransaction } from "../media/repository.ts";
import { CoffreError } from "./errors.ts";
import type { ContributionInput } from "./schemas.ts";

type Database = ReturnType<typeof createDatabase>["db"];
export type CoffreActor =
  | { kind: "organizer" }
  | { kind: "guest"; profileId: string; sessionHash: string };
export type StoredCoffre = typeof coffres.$inferSelect;
export const pageSize = 50;
const timing = {
  id: coffres.id,
  durationSeconds: coffres.durationSeconds,
  startedAt: coffres.startedAt,
  deadline: coffres.deadline,
};
const publicContent = {
  id: coffreContributions.id,
  text: coffreContributions.text,
  photoMediaId: coffreContributions.photoMediaId,
  frameId: coffreContributions.frameId,
  createdAt: coffreContributions.createdAt,
};
const current = (coffreId: number) =>
  and(
    eq(coffreContributions.coffreId, coffreId),
    isNull(coffreContributions.deletedAt),
  );
const databaseTime = sql<Date>`clock_timestamp()`.mapWith(
  (value: string) => new Date(value),
);
async function now(db: Database | MediaTransaction) {
  const [row] = await db
    .select({ now: databaseTime })
    .from(sql`(select 1) as clock`);
  if (!row) throw new Error("Database clock unavailable.");
  return row.now;
}
export function isRevealed(coffre: Pick<StoredCoffre, "deadline">, now: Date) {
  return coffre.deadline !== null && coffre.deadline.getTime() <= now.getTime();
}

export function createCoffreRepository(
  db: Database,
  media: Pick<MediaRepository, "attachPhoto" | "markDeleting">,
) {
  async function lockCoffre(tx: MediaTransaction, coffreId: number) {
    const [row] = await tx
      .select(timing)
      .from(coffres)
      .where(eq(coffres.id, coffreId))
      .for("update");
    if (!row) throw new CoffreError(409, "COFFRE_NOT_PREPARED");
    return row;
  }
  async function requireGuest(tx: MediaTransaction, actor: CoffreActor) {
    if (actor.kind === "organizer") return;
    const [settings] = await tx
      .select({ enabled: hubSettings.hubEnabled })
      .from(hubSettings)
      .where(eq(hubSettings.id, 1))
      .for("share");
    if (!settings?.enabled) throw new CoffreError(403, "HUB_CLOSED");
    // Match access revocation's profile -> session lock order.
    const [profile] = await tx
      .select({ enabled: profiles.legacyAccessEnabled })
      .from(profiles)
      .where(eq(profiles.id, actor.profileId))
      .for("share");
    if (!profile?.enabled) throw new CoffreError(401, "GUEST_UNAUTHENTICATED");
    const [session] = await tx
      .select({ tokenHash: guestSessions.tokenHash })
      .from(guestSessions)
      .where(
        and(
          eq(guestSessions.profileId, actor.profileId),
          eq(guestSessions.tokenHash, actor.sessionHash),
          gt(guestSessions.expiresAt, sql`clock_timestamp()`),
        ),
      )
      .for("share");
    if (!session) throw new CoffreError(401, "GUEST_UNAUTHENTICATED");
  }
  return {
    async state(
      coffreId?: number,
    ): Promise<{ coffre: StoredCoffre | null; now: Date }> {
      const [row] = await db
        .select({ ...timing, now: databaseTime })
        .from(coffres)
        .where(coffreId === undefined ? undefined : eq(coffres.id, coffreId))
        .orderBy(desc(coffres.id))
        .limit(1);
      if (coffreId !== undefined && !row)
        throw new CoffreError(404, "COFFRE_NOT_FOUND");
      return { coffre: row ?? null, now: row?.now ?? (await now(db)) };
    },
    async history(before?: number) {
      return db
        .select({ ...timing, now: databaseTime })
        .from(coffres)
        .where(before === undefined ? undefined : lt(coffres.id, before))
        .orderBy(desc(coffres.id))
        .limit(pageSize + 1);
    },
    async createNext(previousCoffreId: number) {
      return db.transaction(async (tx) => {
        const previous = await lockCoffre(tx, previousCoffreId);
        if (!isRevealed(previous, await now(tx)))
          throw new CoffreError(409, "COFFRE_NOT_REVEALED");
        // Locking the predecessor makes concurrent creation and lost-response retries identical.
        const id = previous.id + 1;
        await tx
          .insert(coffres)
          .values({ id, durationSeconds: previous.durationSeconds })
          .onConflictDoNothing({ target: coffres.id });
        return id;
      });
    },
    async prepare(durationSeconds: number, coffreId = 1) {
      if (coffreId !== 1) {
        const [row] = await db
          .update(coffres)
          .set({ durationSeconds })
          .where(and(eq(coffres.id, coffreId), isNull(coffres.startedAt)))
          .returning(timing);
        if (!row) throw new CoffreError(409, "COFFRE_ALREADY_STARTED");
        return;
      }
      const [row] = await db
        .insert(coffres)
        .values({ id: 1, durationSeconds })
        .onConflictDoUpdate({
          target: coffres.id,
          set: { durationSeconds },
          setWhere: isNull(coffres.startedAt),
        })
        .returning(timing);
      if (!row) throw new CoffreError(409, "COFFRE_ALREADY_STARTED");
    },
    async start(coffreId = 1) {
      await db.transaction(async (tx) => {
        const coffre = await lockCoffre(tx, coffreId);
        if (coffre.startedAt) return; // A lost start response must not restart the clock.
        const startedAt = await now(tx);
        await tx
          .update(coffres)
          .set({
            startedAt,
            deadline: new Date(
              startedAt.getTime() + coffre.durationSeconds * 1000,
            ),
          })
          .where(eq(coffres.id, coffreId));
      });
    },
    async advance(deadline: Date, coffreId = 1) {
      await db.transaction(async (tx) => {
        const coffre = await lockCoffre(tx, coffreId);
        if (!coffre.startedAt || !coffre.deadline)
          throw new CoffreError(409, "COFFRE_NOT_COLLECTING");
        // An identical command acknowledges a lost response, including after revelation.
        if (deadline.getTime() === coffre.deadline.getTime()) return;
        const checkedAt = await now(tx);
        if (isRevealed(coffre, checkedAt))
          throw new CoffreError(409, "COFFRE_REVEALED");
        if (deadline <= checkedAt || deadline >= coffre.deadline)
          throw new CoffreError(409, "COFFRE_INVALID_DEADLINE");
        await tx
          .update(coffres)
          .set({ deadline })
          .where(eq(coffres.id, coffreId));
      });
    },
    async open(coffreId = 1) {
      await db.transaction(async (tx) => {
        const coffre = await lockCoffre(tx, coffreId);
        if (!coffre.startedAt)
          throw new CoffreError(409, "COFFRE_NOT_COLLECTING");
        const openedAt = await now(tx);
        if (isRevealed(coffre, openedAt)) return;
        // This is the same row lock used by insertion after media processing.
        await tx
          .update(coffres)
          .set({ deadline: openedAt })
          .where(eq(coffres.id, coffreId));
      });
    },
    async deposit(
      input: ContributionInput,
      text: string | null,
      requestHash: string,
      photoMediaId: string | null,
      actor: CoffreActor,
      coffreId = 1,
    ) {
      return db.transaction(async (tx) => {
        await requireGuest(tx, actor);
        const coffre = await lockCoffre(tx, coffreId);
        const [previous] = await tx
          .select({
            coffreId: coffreContributions.coffreId,
            authorProfileId: coffreContributions.authorProfileId,
            requestHash: coffreContributions.requestHash,
            deletedAt: coffreContributions.deletedAt,
          })
          .from(coffreContributions)
          .where(eq(coffreContributions.id, input.id));
        const authorProfileId = actor.kind === "guest" ? actor.profileId : null;
        if (previous) {
          if (
            previous.coffreId !== coffreId ||
            previous.authorProfileId !== authorProfileId ||
            previous.requestHash !== requestHash ||
            previous.deletedAt
          )
            throw new CoffreError(409, "CONTRIBUTION_CONFLICT");
          return { replayed: true };
        }
        if (photoMediaId)
          await media.attachPhoto(tx, photoMediaId, authorProfileId);
        // Check after locks and media attachment: now() would use transaction start time.
        const acceptedAt = await now(tx);
        if (isRevealed(coffre, acceptedAt))
          throw new CoffreError(409, "COFFRE_REVEALED");
        if (!coffre.startedAt && actor.kind !== "organizer")
          throw new CoffreError(409, "COFFRE_NOT_COLLECTING");
        if (actor.kind === "guest") {
          const [valid] = await tx
            .select({ token: guestSessions.tokenHash })
            .from(guestSessions)
            .where(
              and(
                eq(guestSessions.tokenHash, actor.sessionHash),
                gt(guestSessions.expiresAt, acceptedAt),
              ),
            );
          if (!valid) throw new CoffreError(401, "GUEST_UNAUTHENTICATED");
        }
        await tx.insert(coffreContributions).values({
          id: input.id,
          coffreId,
          authorProfileId,
          text,
          photoMediaId,
          visibility: input.visibility,
          frameId: input.frameId,
          requestHash,
          createdAt: acceptedAt,
        });
        return { replayed: false };
      });
    },
    async publicPage(after?: string, coffreId = 1) {
      // The reveal predicate belongs to the same SQL read as the content.
      return db
        .select(publicContent)
        .from(coffreContributions)
        .innerJoin(coffres, eq(coffres.id, coffreContributions.coffreId))
        .where(
          and(
            current(coffreId),
            eq(coffreContributions.visibility, "public"),
            sql`${coffres.id} = (select max(id) from coffres)`,
            sql`${coffres.deadline} <= clock_timestamp()`,
            after ? gt(coffreContributions.id, after) : undefined,
          ),
        )
        .orderBy(asc(coffreContributions.id))
        .limit(pageSize + 1);
    },
    async metadataPage(
      after?: string,
      visibility?: "public" | "private",
      coffreId = 1,
    ) {
      return db
        .select({
          id: coffreContributions.id,
          visibility: coffreContributions.visibility,
          frameId: coffreContributions.frameId,
          createdAt: coffreContributions.createdAt,
          hasText: sql<boolean>`${coffreContributions.text} IS NOT NULL`,
          hasPhoto: sql<boolean>`${coffreContributions.photoMediaId} IS NOT NULL`,
          authorProfileId: coffreContributions.authorProfileId,
          firstName: profiles.firstName,
        })
        .from(coffreContributions)
        .leftJoin(
          profiles,
          eq(profiles.id, coffreContributions.authorProfileId),
        )
        .where(
          and(
            current(coffreId),
            after ? gt(coffreContributions.id, after) : undefined,
            visibility
              ? eq(coffreContributions.visibility, visibility)
              : undefined,
          ),
        )
        .orderBy(asc(coffreContributions.id))
        .limit(pageSize + 1);
    },
    async detail(id: string, coffreId = 1) {
      const [row] = await db
        .select({
          ...publicContent,
          visibility: coffreContributions.visibility,
          authorProfileId: coffreContributions.authorProfileId,
          firstName: profiles.firstName,
        })
        .from(coffreContributions)
        .leftJoin(
          profiles,
          eq(profiles.id, coffreContributions.authorProfileId),
        )
        .where(and(current(coffreId), eq(coffreContributions.id, id)));
      if (!row) throw new CoffreError(404, "CONTRIBUTION_NOT_FOUND");
      return row;
    },
    async remove(id: string, coffreId = 1) {
      await db.transaction(async (tx) => {
        const [row] = await tx
          .select({
            photoMediaId: coffreContributions.photoMediaId,
            deletedAt: coffreContributions.deletedAt,
          })
          .from(coffreContributions)
          .where(
            and(
              eq(coffreContributions.coffreId, coffreId),
              eq(coffreContributions.id, id),
            ),
          )
          .for("update");
        if (!row || row.deletedAt) return;
        await tx
          .update(coffreContributions)
          .set({
            text: null,
            photoMediaId: null,
            deletedAt: sql`clock_timestamp()`,
          })
          .where(eq(coffreContributions.id, id));
        if (row.photoMediaId) await media.markDeleting(tx, row.photoMediaId);
      });
    },
    async mediaContext(id: string): Promise<ContributionMediaContext | null> {
      const [row] = await db
        .select({
          visibility: coffreContributions.visibility,
          current: sql<boolean>`${coffres.id} = (select max(id) from coffres)`,
          revealed: sql<boolean>`${coffres.deadline} IS NOT NULL AND ${coffres.deadline} <= clock_timestamp()`,
        })
        .from(coffreContributions)
        .innerJoin(coffres, eq(coffres.id, coffreContributions.coffreId))
        .where(
          and(
            isNull(coffreContributions.deletedAt),
            eq(coffreContributions.photoMediaId, id),
          ),
        );
      return row ? { ...row, deleted: false } : null;
    },
  };
}
export type CoffreRepository = ReturnType<typeof createCoffreRepository>;
