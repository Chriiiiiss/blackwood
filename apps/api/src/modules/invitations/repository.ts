import { eq, sql } from "drizzle-orm";
import type { createDatabase } from "../../db/client.ts";
import { invitationResponses } from "../../db/schema.ts";
import { synchronizeResponseProfile } from "../profiles/repository.ts";

type InvitationValues = Pick<
  typeof invitationResponses.$inferInsert,
  "firstName" | "attendance" | "plusOne" | "ideas"
>;

const selection = {
  id: invitationResponses.id,
  firstName: invitationResponses.firstName,
  attendance: invitationResponses.attendance,
  plusOne: invitationResponses.plusOne,
  ideas: invitationResponses.ideas,
};

export function createInvitationRepository(
  db: ReturnType<typeof createDatabase>["db"],
) {
  return {
    async upsert(id: string, values: InvitationValues) {
      return db.transaction(async (tx) => {
        const [response] = await tx
          .insert(invitationResponses)
          .values({ id, ...values })
          .onConflictDoUpdate({
            target: invitationResponses.id,
            set: { ...values, updatedAt: sql`now()` },
          })
          .returning(selection);
        if (response) await synchronizeResponseProfile(tx, response);
        return response;
      });
    },

    async findById(id: string) {
      const [response] = await db
        .select(selection)
        .from(invitationResponses)
        .where(eq(invitationResponses.id, id));
      return response;
    },
  };
}

export type InvitationRepository = ReturnType<
  typeof createInvitationRepository
>;
