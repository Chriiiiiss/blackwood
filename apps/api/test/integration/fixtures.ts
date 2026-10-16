import { inArray } from "drizzle-orm";
import type { createDatabase } from "../../src/db/client.ts";
import {
  companionInvitations,
  guestCodes,
  guestCompanions,
  guestSessions,
  invitationResponses,
  profileResponseLinks,
  profiles,
} from "../../src/db/schema.ts";

export async function removeInvitationFixtures(
  db: ReturnType<typeof createDatabase>["db"],
  responseIds: string[],
) {
  const links = await db
    .select()
    .from(profileResponseLinks)
    .where(inArray(profileResponseLinks.responseId, responseIds));
  const mainIds = links.map((link) => link.profileId);
  if (mainIds.length) {
    const companions = await db
      .select()
      .from(guestCompanions)
      .where(inArray(guestCompanions.mainProfileId, mainIds));
    const profileIds = [
      ...mainIds,
      ...companions.map((row) => row.companionProfileId),
    ];
    await db
      .delete(guestSessions)
      .where(inArray(guestSessions.profileId, profileIds));
    await db
      .delete(guestCodes)
      .where(inArray(guestCodes.profileId, profileIds));
    await db
      .delete(companionInvitations)
      .where(inArray(companionInvitations.mainProfileId, mainIds));
    await db
      .delete(guestCompanions)
      .where(inArray(guestCompanions.mainProfileId, mainIds));
    await db
      .delete(profileResponseLinks)
      .where(inArray(profileResponseLinks.responseId, responseIds));
    await db.delete(profiles).where(inArray(profiles.id, profileIds));
  }
  await db
    .delete(invitationResponses)
    .where(inArray(invitationResponses.id, responseIds));
}
