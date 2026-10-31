import { randomUUID } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import type { createDatabase } from "../../db/client.ts";
import { organizerSessions, spotifyConnection } from "../../db/schema.ts";

type Database = ReturnType<typeof createDatabase>["db"];
export function createSpotifyRepository(db: Database) {
  return {
    async connection() {
      let [row] = await db
        .select()
        .from(spotifyConnection)
        .where(eq(spotifyConnection.id, 1));
      if (!row) {
        await db
          .insert(spotifyConnection)
          .values({ id: 1 })
          .onConflictDoNothing();
        [row] = await db
          .select()
          .from(spotifyConnection)
          .where(eq(spotifyConnection.id, 1));
      }
      if (!row) throw new Error("Spotify connection is unavailable.");
      return row;
    },
    async authorize(
      sessionHash: string,
      credentialFingerprint: string,
      revision: string,
      encryptedTokens: string,
      expiresAt: Date,
      now: Date,
    ) {
      return db.transaction(async (tx) => {
        const [session] = await tx
          .select({ hash: organizerSessions.tokenHash })
          .from(organizerSessions)
          .where(
            and(
              eq(organizerSessions.tokenHash, sessionHash),
              eq(
                organizerSessions.credentialFingerprint,
                credentialFingerprint,
              ),
              gt(organizerSessions.expiresAt, now),
              gt(
                organizerSessions.lastActivity,
                new Date(now.getTime() - 86400000),
              ),
            ),
          )
          .for("share");
        if (!session) return false;
        const [row] = await tx
          .update(spotifyConnection)
          .set({
            revision: randomUUID(),
            encryptedTokens,
            expiresAt,
            updatedAt: now,
          })
          .where(
            and(
              eq(spotifyConnection.id, 1),
              eq(spotifyConnection.revision, revision),
            ),
          )
          .returning({ id: spotifyConnection.id });
        return !!row;
      });
    },
    async refresh(revision: string, encryptedTokens: string, expiresAt: Date) {
      const [row] = await db
        .update(spotifyConnection)
        .set({ encryptedTokens, expiresAt, updatedAt: new Date() })
        .where(
          and(
            eq(spotifyConnection.id, 1),
            eq(spotifyConnection.revision, revision),
          ),
        )
        .returning({ id: spotifyConnection.id });
      return !!row;
    },
    async disconnect(revision?: string) {
      await db
        .update(spotifyConnection)
        .set({
          revision: randomUUID(),
          encryptedTokens: null,
          expiresAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(spotifyConnection.id, 1),
            revision ? eq(spotifyConnection.revision, revision) : undefined,
          ),
        );
    },
  };
}
export type SpotifyRepository = ReturnType<typeof createSpotifyRepository>;
