import { randomUUID } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import type { createDatabase } from "../../db/client.ts";
import {
  companionInvitations,
  guestCompanions,
  guestSessions,
  hubSettings,
  invitationResponses,
  profileResponseLinks,
  profiles,
} from "../../db/schema.ts";
import type { normalizeInvitationInput } from "../invitations/service.ts";
import { ProfileError } from "./errors.ts";

type Database = ReturnType<typeof createDatabase>["db"];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Pick<
  Database,
  "select" | "insert" | "update" | "delete" | "execute"
>;

const profileSelection = {
  id: profiles.id,
  firstName: profiles.firstName,
  avatarMediaId: profiles.avatarMediaId,
  role: profiles.role,
  legacyAccessEnabled: profiles.legacyAccessEnabled,
  hasInvitationResponse: sql<boolean>`${profileResponseLinks.responseId} is not null`,
};
const responseSelection = {
  firstName: invitationResponses.firstName,
  attendance: invitationResponses.attendance,
  plusOne: invitationResponses.plusOne,
  ideas: invitationResponses.ideas,
};

async function readProfile(db: Executor, id: string) {
  const [row] = await db
    .select(profileSelection)
    .from(profiles)
    .leftJoin(
      profileResponseLinks,
      eq(profileResponseLinks.profileId, profiles.id),
    )
    .where(eq(profiles.id, id));
  return row;
}
export type StoredProfile = NonNullable<
  Awaited<ReturnType<typeof readProfile>>
>;

// The caller holds the invitation response row lock, including after an upsert.
export async function synchronizeResponseProfile(
  tx: Transaction,
  response: { id: string; firstName: string },
) {
  const [link] = await tx
    .select()
    .from(profileResponseLinks)
    .where(eq(profileResponseLinks.responseId, response.id));
  if (link) {
    await tx
      .update(profiles)
      .set({ firstName: response.firstName, updatedAt: sql`now()` })
      .where(eq(profiles.id, link.profileId));
    return link.profileId;
  }
  const id = randomUUID();
  await tx
    .insert(profiles)
    .values({ id, firstName: response.firstName, role: "main" });
  await tx
    .insert(profileResponseLinks)
    .values({ profileId: id, responseId: response.id });
  return id;
}

async function requireHub(tx: Executor) {
  const [settings] = await tx
    .select()
    .from(hubSettings)
    .where(eq(hubSettings.id, 1));
  if (!settings?.hubEnabled) throw new ProfileError(403, "HUB_CLOSED");
}
async function requireActive(tx: Executor, id: string) {
  const profile = await readProfile(tx, id);
  if (!profile?.legacyAccessEnabled)
    throw new ProfileError(401, "PROFILE_ACCESS_DISABLED");
  return profile;
}

// All invitation/profile writes lock the response first, then the profile.
async function lockProfileResponse(tx: Transaction, profileId: string) {
  const [link] = await tx
    .select()
    .from(profileResponseLinks)
    .where(eq(profileResponseLinks.profileId, profileId));
  if (!link) return undefined;
  const [response] = await tx
    .select({ id: invitationResponses.id, ...responseSelection })
    .from(invitationResponses)
    .where(eq(invitationResponses.id, link.responseId))
    .for("update");
  return response;
}

async function eligibleMain(tx: Transaction, mainProfileId: string) {
  await requireHub(tx);
  const response = await lockProfileResponse(tx, mainProfileId);
  const [main] = await tx
    .select()
    .from(profiles)
    .where(eq(profiles.id, mainProfileId))
    .for("update");
  if (
    !main?.legacyAccessEnabled ||
    main.role !== "main" ||
    !response?.plusOne ||
    response.attendance === "no"
  ) {
    throw new ProfileError(403, "COMPANION_NOT_ALLOWED");
  }
}

export function createProfileRepository(db: Database) {
  return {
    async hubSettings() {
      const [row] = await db
        .select({ hubEnabled: hubSettings.hubEnabled })
        .from(hubSettings)
        .where(eq(hubSettings.id, 1));
      return row ?? { hubEnabled: false };
    },
    async session(tokenHash: string, now: Date) {
      const [session] = await db
        .select({ profileId: guestSessions.profileId })
        .from(guestSessions)
        .where(
          and(
            eq(guestSessions.tokenHash, tokenHash),
            gt(guestSessions.expiresAt, now),
          ),
        );
      if (!session) return undefined;
      const profile = await readProfile(db, session.profileId);
      return profile?.legacyAccessEnabled ? profile : undefined;
    },
    async restore(
      responseId: string,
      currentProfileId: string | undefined,
      session: Omit<typeof guestSessions.$inferInsert, "profileId">,
    ) {
      return db.transaction(async (tx) => {
        const [response] = await tx
          .select({
            id: invitationResponses.id,
            firstName: invitationResponses.firstName,
          })
          .from(invitationResponses)
          .where(eq(invitationResponses.id, responseId))
          .for("update");
        if (!response) throw new ProfileError(404, "RESPONSE_NOT_FOUND");
        const [link] = await tx
          .select()
          .from(profileResponseLinks)
          .where(eq(profileResponseLinks.responseId, response.id));
        const profileId =
          link?.profileId ?? (await synchronizeResponseProfile(tx, response));
        const profile = await requireActive(tx, profileId);
        if (currentProfileId && currentProfileId !== profile.id)
          throw new ProfileError(409, "PROFILE_ALREADY_IDENTIFIED");
        if (!currentProfileId)
          await tx.insert(guestSessions).values({ ...session, profileId });
        return profile;
      });
    },
    async patch(profileId: string, firstName: string) {
      return db.transaction(async (tx) => {
        await requireHub(tx);
        const response = await lockProfileResponse(tx, profileId);
        await requireActive(tx, profileId);
        if (response)
          await tx
            .update(invitationResponses)
            .set({ firstName, updatedAt: sql`now()` })
            .where(eq(invitationResponses.id, response.id));
        await tx
          .update(profiles)
          .set({ firstName, updatedAt: sql`now()` })
          .where(eq(profiles.id, profileId));
        return requireActive(tx, profileId);
      });
    },
    async invitation(profileId: string) {
      const [row] = await db
        .select(responseSelection)
        .from(profileResponseLinks)
        .innerJoin(
          invitationResponses,
          eq(invitationResponses.id, profileResponseLinks.responseId),
        )
        .where(eq(profileResponseLinks.profileId, profileId));
      if (!row) throw new ProfileError(404, "RESPONSE_NOT_FOUND");
      return row;
    },
    async saveInvitation(
      profileId: string,
      values: ReturnType<typeof normalizeInvitationInput>,
    ) {
      return db.transaction(async (tx) => {
        const response = await lockProfileResponse(tx, profileId);
        if (!response) throw new ProfileError(404, "RESPONSE_NOT_FOUND");
        await requireActive(tx, profileId);
        const [saved] = await tx
          .update(invitationResponses)
          .set({
            firstName: values.firstName,
            attendance: values.attendance,
            plusOne: values.plusOne,
            ideas: values.ideas,
            updatedAt: sql`now()`,
          })
          .where(eq(invitationResponses.id, response.id))
          .returning(responseSelection);
        await tx
          .update(profiles)
          .set({ firstName: values.firstName, updatedAt: sql`now()` })
          .where(eq(profiles.id, profileId));
        return saved;
      });
    },
    async issueCompanion(
      mainProfileId: string,
      tokenHash: string,
      expiresAt: Date,
    ) {
      await db.transaction(async (tx) => {
        await eligibleMain(tx, mainProfileId);
        const [existing] = await tx
          .select()
          .from(guestCompanions)
          .where(eq(guestCompanions.mainProfileId, mainProfileId));
        if (existing) throw new ProfileError(409, "COMPANION_ALREADY_CLAIMED");
        await tx
          .insert(companionInvitations)
          .values({ mainProfileId, tokenHash, expiresAt })
          .onConflictDoUpdate({
            target: companionInvitations.mainProfileId,
            set: { tokenHash, expiresAt, claimedProfileId: null },
          });
      });
    },
    async claimCompanion(
      mainProfileId: string,
      tokenHash: string,
      firstName: string,
      currentProfileId: string | undefined,
      session: Omit<typeof guestSessions.$inferInsert, "profileId">,
      now: Date,
    ) {
      return db.transaction(async (tx) => {
        await eligibleMain(tx, mainProfileId);
        const [invitation] = await tx
          .select()
          .from(companionInvitations)
          .where(
            and(
              eq(companionInvitations.mainProfileId, mainProfileId),
              eq(companionInvitations.tokenHash, tokenHash),
              gt(companionInvitations.expiresAt, now),
            ),
          )
          .for("update");
        if (!invitation)
          throw new ProfileError(404, "COMPANION_INVITATION_NOT_FOUND");
        if (invitation.claimedProfileId) {
          if (currentProfileId === invitation.claimedProfileId)
            return requireActive(tx, currentProfileId);
          throw new ProfileError(409, "COMPANION_ALREADY_CLAIMED");
        }
        if (currentProfileId)
          throw new ProfileError(409, "PROFILE_ALREADY_IDENTIFIED");
        const [existing] = await tx
          .select()
          .from(guestCompanions)
          .where(eq(guestCompanions.mainProfileId, mainProfileId));
        if (existing) throw new ProfileError(409, "COMPANION_ALREADY_CLAIMED");
        const profileId = randomUUID();
        await tx
          .insert(profiles)
          .values({ id: profileId, firstName, role: "companion" });
        await tx
          .insert(guestCompanions)
          .values({ mainProfileId, companionProfileId: profileId });
        await tx
          .update(companionInvitations)
          .set({ claimedProfileId: profileId })
          .where(eq(companionInvitations.mainProfileId, mainProfileId));
        await tx.insert(guestSessions).values({ ...session, profileId });
        return requireActive(tx, profileId);
      });
    },
  };
}
export type ProfileRepository = ReturnType<typeof createProfileRepository>;
