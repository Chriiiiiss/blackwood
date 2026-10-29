import { and, eq, gt, lt, lte, sql } from "drizzle-orm";
import type { createDatabase } from "../../db/client.ts";
import { tvPairing, tvSessions } from "../../db/schema.ts";

export function createTvAccessRepository(
  db: ReturnType<typeof createDatabase>["db"],
) {
  return {
    async issue(codeHash: string, expiresAt: Date, now: Date) {
      await db.transaction(async (tx) => {
        await tx
          .insert(tvPairing)
          .values({ id: 1, codeHash, expiresAt, attempts: 0 })
          .onConflictDoUpdate({
            target: tvPairing.id,
            set: { codeHash, expiresAt, attempts: 0 },
          });
        await tx.delete(tvSessions).where(lte(tvSessions.expiresAt, now));
      });
    },
    async redeem(
      codeHash: string,
      session: typeof tvSessions.$inferInsert,
      now: Date,
      previousHash?: string,
    ) {
      return db.transaction(async (tx) => {
        // The row update serializes guesses, redemption and replacement across API processes.
        const [pairing] = await tx
          .update(tvPairing)
          .set({ attempts: sql`${tvPairing.attempts} + 1` })
          .where(
            and(
              eq(tvPairing.id, 1),
              gt(tvPairing.expiresAt, now),
              lt(tvPairing.attempts, 5),
            ),
          )
          .returning({ codeHash: tvPairing.codeHash });
        // Return instead of throwing: failed guesses must commit their attempt count.
        if (!pairing || pairing.codeHash !== codeHash) return false;
        await tx.delete(tvPairing).where(eq(tvPairing.id, 1));
        if (previousHash)
          await tx
            .delete(tvSessions)
            .where(eq(tvSessions.tokenHash, previousHash));
        await tx.delete(tvSessions).where(lte(tvSessions.expiresAt, now));
        await tx.insert(tvSessions).values(session);
        return true;
      });
    },
    async session(tokenHash: string, now: Date) {
      const [row] = await db
        .select({ expiresAt: tvSessions.expiresAt })
        .from(tvSessions)
        .where(
          and(
            eq(tvSessions.tokenHash, tokenHash),
            gt(tvSessions.expiresAt, now),
          ),
        );
      return row;
    },
  };
}
export type TvAccessRepository = ReturnType<typeof createTvAccessRepository>;
