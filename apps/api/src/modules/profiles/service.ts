import { createHash, randomBytes } from "node:crypto";
import type { InvitationInput } from "../invitations/schemas.ts";
import { normalizeInvitationInput } from "../invitations/service.ts";
import {
  generateGuestCode,
  normalizeGuestCode,
  validGuestCode,
} from "./code.ts";
import { ProfileError } from "./errors.ts";
import type { ProfileRepository, StoredProfile } from "./repository.ts";

export const guestSessionLifetime = 90 * 24 * 60 * 60;
export const companionInvitationLifetime = 7 * 24 * 60 * 60;
export const hashGuestToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const validToken = (token: string | undefined): token is string =>
  token !== undefined &&
  /^[\w-]{43}$/.test(token) &&
  Buffer.from(token, "base64url").toString("base64url") === token;
function publicProfile(profile: StoredProfile) {
  const { legacyAccessEnabled: _legacyAccessEnabled, ...publicFields } =
    profile;
  return publicFields;
}

export function createProfileService(
  repository: ProfileRepository,
  clock = () => new Date(),
) {
  async function current(token?: string) {
    return validToken(token)
      ? repository.session(hashGuestToken(token), clock())
      : undefined;
  }
  async function authenticated(token?: string, hubRequired = false) {
    const profile = await current(token);
    if (!profile) throw new ProfileError(401, "GUEST_UNAUTHENTICATED");
    if (hubRequired && !(await repository.hubSettings()).hubEnabled)
      throw new ProfileError(403, "HUB_CLOSED");
    return profile;
  }
  function newSession() {
    const now = clock();
    const token = randomBytes(32).toString("base64url");
    return {
      token,
      values: {
        tokenHash: hashGuestToken(token),
        createdAt: now,
        expiresAt: new Date(now.getTime() + guestSessionLifetime * 1000),
      },
    };
  }
  return {
    async login(code: string, previousToken?: string) {
      const normalized = normalizeGuestCode(code);
      const codeHash = hashGuestToken(normalized);
      const attempt = await repository.consumeCodeAttempt(codeHash, clock());
      if (!attempt.allowed)
        throw new ProfileError(429, "LOGIN_RATE_LIMITED", attempt.retryAfter);
      if (!validGuestCode(normalized))
        throw new ProfileError(401, "INVALID_GUEST_CODE");
      const existing = await current(previousToken);
      const session = newSession();
      const profile = await repository.loginCode(
        codeHash,
        existing?.id,
        session.values,
      );
      return {
        access: {
          ...(await repository.hubSettings()),
          profile: publicProfile(profile),
        },
        token: existing ? undefined : session.token,
      };
    },
    async issueCode(profileId: string) {
      const code = generateGuestCode();
      await repository.issueCode(
        profileId,
        hashGuestToken(normalizeGuestCode(code)),
      );
      return { code };
    },
    codeProfiles: () => repository.codeProfiles(),
    disableAccess: (profileId: string) => repository.disableAccess(profileId),
    async access(token?: string) {
      const settings = await repository.hubSettings();
      const profile = await current(token);
      return { ...settings, profile: profile ? publicProfile(profile) : null };
    },
    async restore(responseId: string, previousToken?: string) {
      const existing = await current(previousToken);
      const session = newSession();
      const profile = await repository.restore(
        responseId,
        existing?.id,
        session.values,
      );
      return {
        access: {
          ...(await repository.hubSettings()),
          profile: publicProfile(profile),
        },
        token: existing ? undefined : session.token,
      };
    },
    async profile(token?: string) {
      return publicProfile(await authenticated(token, true));
    },
    async patch(firstName: string, token?: string) {
      const profile = await authenticated(token, true);
      return publicProfile(await repository.patch(profile.id, firstName));
    },
    async invitation(token?: string) {
      return repository.invitation((await authenticated(token)).id);
    },
    async saveInvitation(input: InvitationInput, token?: string) {
      return repository.saveInvitation(
        (await authenticated(token)).id,
        normalizeInvitationInput(input),
      );
    },
    async issueCompanion(token?: string) {
      const profile = await authenticated(token, true);
      const secret = randomBytes(32).toString("base64url");
      const expiresAt = new Date(
        clock().getTime() + companionInvitationLifetime * 1000,
      );
      await repository.issueCompanion(
        profile.id,
        hashGuestToken(secret),
        expiresAt,
      );
      return {
        mainProfileId: profile.id,
        token: secret,
        expiresAt: expiresAt.toISOString(),
      };
    },
    async companionStatus(token?: string) {
      const profile = await authenticated(token, true);
      return repository.companionStatus(profile.id);
    },
    async claimCompanion(
      input: { mainProfileId: string; token: string; firstName: string },
      previousToken?: string,
    ) {
      const existing = await current(previousToken);
      const session = newSession();
      if (!validToken(input.token))
        throw new ProfileError(404, "COMPANION_INVITATION_NOT_FOUND");
      const profile = await repository.claimCompanion(
        input.mainProfileId,
        hashGuestToken(input.token),
        input.firstName,
        existing?.id,
        session.values,
        clock(),
      );
      return {
        access: {
          ...(await repository.hubSettings()),
          profile: publicProfile(profile),
        },
        token: existing ? undefined : session.token,
      };
    },
  };
}
export type ProfileService = ReturnType<typeof createProfileService>;
