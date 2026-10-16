import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, lt, sql } from "drizzle-orm";
import type { createDatabase } from "../../db/client.ts";
import {
  companionInvitations,
  guestCodeLoginLimits,
  guestCodes,
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
    async consumeCodeAttempt(key: string, now: Date) {
      const duration = 300_000;
      const windowStart = new Date(
        Math.floor(now.getTime() / duration) * duration,
      );
      return db.transaction(async (tx) => {
        async function consume(key: string, maximum: number) {
          const [row] = await tx
            .insert(guestCodeLoginLimits)
            .values({ key, windowStart, attempts: 1 })
            .onConflictDoUpdate({
              target: guestCodeLoginLimits.key,
              set: {
                windowStart: sql`greatest(${guestCodeLoginLimits.windowStart}, ${windowStart})`,
                attempts: sql`case when ${guestCodeLoginLimits.windowStart} >= ${windowStart} then least(${guestCodeLoginLimits.attempts} + 1, ${maximum + 1}) else 1 end`,
              },
            })
            .returning();
          return {
            allowed: !!row && row.attempts <= maximum,
            retryAfter: Math.max(
              1,
              Math.ceil(
                ((row?.windowStart ?? windowStart).getTime() +
                  duration -
                  now.getTime()) /
                  1000,
              ),
            ),
          };
        }
        // Lock the shared budget first: concurrent candidates cannot exceed it.
        const total = await consume("global", 100);
        if (!total.allowed) return total;
        await tx
          .delete(guestCodeLoginLimits)
          .where(lt(guestCodeLoginLimits.windowStart, windowStart));
        return consume(key, 5);
      });
    },
    async codeProfiles() {
      return db
        .select({
          id: profiles.id,
          firstName: profiles.firstName,
          role: profiles.role,
          accessEnabled: profiles.legacyAccessEnabled,
          codeEnabled: sql<boolean>`coalesce(${guestCodes.enabled}, false)`,
        })
        .from(profiles)
        .leftJoin(guestCodes, eq(guestCodes.profileId, profiles.id))
        .orderBy(asc(profiles.createdAt), asc(profiles.id));
    },
    async issueCode(profileId: string, codeHash: string) {
      await db.transaction(async (tx) => {
        const [profile] = await tx
          .select({ id: profiles.id })
          .from(profiles)
          .where(eq(profiles.id, profileId))
          .for("update");
        if (!profile) throw new ProfileError(404, "PROFILE_NOT_FOUND");
        await tx
          .insert(guestCodes)
          .values({ profileId, codeHash, enabled: true })
          .onConflictDoUpdate({
            target: guestCodes.profileId,
            set: { codeHash, enabled: true },
          });
        await tx
          .update(profiles)
          .set({ legacyAccessEnabled: true, updatedAt: sql`now()` })
          .where(eq(profiles.id, profileId));
      });
    },
    async disableAccess(profileId: string) {
      await db.transaction(async (tx) => {
        const [profile] = await tx
          .select({ id: profiles.id })
          .from(profiles)
          .where(eq(profiles.id, profileId))
          .for("update");
        if (!profile) throw new ProfileError(404, "PROFILE_NOT_FOUND");
        await tx
          .update(profiles)
          .set({ legacyAccessEnabled: false, updatedAt: sql`now()` })
          .where(eq(profiles.id, profileId));
        await tx
          .update(guestCodes)
          .set({ enabled: false })
          .where(eq(guestCodes.profileId, profileId));
        await tx
          .delete(guestSessions)
          .where(eq(guestSessions.profileId, profileId));
      });
    },
    async loginCode(
      codeHash: string,
      currentProfileId: string | undefined,
      session: Omit<typeof guestSessions.$inferInsert, "profileId">,
    ) {
      return db.transaction(async (tx) => {
        const [candidate] = await tx
          .select({ profileId: guestCodes.profileId })
          .from(guestCodes)
          .where(
            and(
              eq(guestCodes.codeHash, codeHash),
              eq(guestCodes.enabled, true),
            ),
          );
        if (!candidate) throw new ProfileError(401, "INVALID_GUEST_CODE");
        // Use the same lock order as code rotation and access revocation.
        const [locked] = await tx
          .select({ enabled: profiles.legacyAccessEnabled })
          .from(profiles)
          .where(eq(profiles.id, candidate.profileId))
          .for("update");
        const [code] = await tx
          .select({ id: guestCodes.profileId })
          .from(guestCodes)
          .where(
            and(
              eq(guestCodes.profileId, candidate.profileId),
              eq(guestCodes.codeHash, codeHash),
              eq(guestCodes.enabled, true),
            ),
          );
        if (!locked?.enabled || !code)
          throw new ProfileError(401, "INVALID_GUEST_CODE");
        if (currentProfileId && currentProfileId !== code.id)
          throw new ProfileError(409, "PROFILE_ALREADY_IDENTIFIED");
        if (!currentProfileId)
          await tx
            .insert(guestSessions)
            .values({ ...session, profileId: code.id });
        return requireActive(tx, code.id);
      });
    },
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
        await tx
          .select({ id: profiles.id })
          .from(profiles)
          .where(eq(profiles.id, profileId))
          .for("update");
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
