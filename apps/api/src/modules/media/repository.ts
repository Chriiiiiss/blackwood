import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import type { createDatabase } from "../../db/client.ts";
import { hubSettings, mediaAssets, profiles } from "../../db/schema.ts";
import { MediaError } from "./errors.ts";
import type { MediaPurpose, ProcessedMedia } from "./limits.ts";

type Database = ReturnType<typeof createDatabase>["db"];
export type MediaTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];
export type MediaAsset = typeof mediaAssets.$inferSelect;

export function createMediaRepository(db: Database) {
  async function markDeleting(tx: MediaTransaction, id: string) {
    await tx
      .update(mediaAssets)
      .set({ status: "deleting", updatedAt: sql`now()` })
      .where(eq(mediaAssets.id, id));
  }
  return {
    async begin(
      id: string,
      ownerProfileId: string | null,
      purpose: MediaPurpose,
    ) {
      await db
        .insert(mediaAssets)
        .values({ id, ownerProfileId, purpose, status: "pending" });
    },
    async stage(id: string, result: ProcessedMedia) {
      await db
        .update(mediaAssets)
        .set({ ...result, status: "staged", updatedAt: sql`now()` })
        .where(and(eq(mediaAssets.id, id), eq(mediaAssets.status, "pending")));
    },
    async find(id: string) {
      const [row] = await db
        .select()
        .from(mediaAssets)
        .where(eq(mediaAssets.id, id));
      return row;
    },
    async isCurrentAvatar(asset: MediaAsset) {
      const [profile] = await db
        .select({ id: profiles.id })
        .from(profiles)
        .where(
          and(
            eq(
              profiles.id,
              asset.ownerProfileId ?? "00000000-0000-4000-8000-000000000000",
            ),
            eq(profiles.avatarMediaId, asset.id),
          ),
        );
      return Boolean(profile);
    },
    async replaceAvatar(profileId: string, id: string | null) {
      return db.transaction(async (tx) => {
        const [settings] = await tx
          .select()
          .from(hubSettings)
          .where(eq(hubSettings.id, 1))
          .for("share");
        if (!settings?.hubEnabled) throw new MediaError(403, "HUB_CLOSED");
        // Serialize avatar replacement/deletion and recheck access at commit time.
        const [profile] = await tx
          .select()
          .from(profiles)
          .where(eq(profiles.id, profileId))
          .for("update");
        if (!profile?.legacyAccessEnabled)
          throw new MediaError(401, "GUEST_UNAUTHENTICATED");
        if (id) {
          const [asset] = await tx
            .select()
            .from(mediaAssets)
            .where(
              and(
                eq(mediaAssets.id, id),
                eq(mediaAssets.ownerProfileId, profileId),
                eq(mediaAssets.purpose, "avatar"),
                eq(mediaAssets.status, "staged"),
              ),
            )
            .for("update");
          if (!asset) throw new MediaError(409, "MEDIA_NOT_ATTACHABLE");
          await tx
            .update(mediaAssets)
            .set({ status: "ready", updatedAt: sql`now()` })
            .where(eq(mediaAssets.id, id));
        }
        await tx
          .update(profiles)
          .set({ avatarMediaId: id, updatedAt: sql`now()` })
          .where(eq(profiles.id, profileId));
        if (profile.avatarMediaId)
          await markDeleting(tx, profile.avatarMediaId);
        return profile.avatarMediaId;
      });
    },
    // ENG-47 must call this in the same transaction as the contribution insert,
    // after checking Coffre's deadline. The read context remains owned by Coffre.
    async attachPhoto(
      tx: MediaTransaction,
      id: string,
      ownerProfileId: string | null,
    ) {
      const [asset] = await tx
        .select()
        .from(mediaAssets)
        .where(eq(mediaAssets.id, id))
        .for("update");
      if (
        !asset ||
        asset.ownerProfileId !== ownerProfileId ||
        asset.purpose !== "photo" ||
        asset.status !== "staged"
      )
        throw new MediaError(409, "MEDIA_NOT_ATTACHABLE");
      await tx
        .update(mediaAssets)
        .set({ status: "ready", updatedAt: sql`now()` })
        .where(eq(mediaAssets.id, id));
    },
    markDeleting,
    async discardStaged(id: string) {
      const [row] = await db
        .update(mediaAssets)
        .set({ status: "deleting", updatedAt: sql`now()` })
        .where(
          and(
            eq(mediaAssets.id, id),
            inArray(mediaAssets.status, ["pending", "staged"]),
          ),
        )
        .returning({ id: mediaAssets.id });
      return Boolean(row);
    },
    async garbage(cutoff: Date) {
      return db
        .update(mediaAssets)
        .set({ status: "deleting", updatedAt: sql`now()` })
        .where(
          or(
            eq(mediaAssets.status, "deleting"),
            and(
              inArray(mediaAssets.status, ["pending", "staged"]),
              lt(mediaAssets.updatedAt, cutoff),
            ),
          ),
        )
        .returning({ id: mediaAssets.id });
    },
    async deleteGarbage(id: string) {
      await db
        .delete(mediaAssets)
        .where(
          and(
            eq(mediaAssets.id, id),
            inArray(mediaAssets.status, ["pending", "staged", "deleting"]),
          ),
        );
    },
  };
}
export type MediaRepository = ReturnType<typeof createMediaRepository>;
