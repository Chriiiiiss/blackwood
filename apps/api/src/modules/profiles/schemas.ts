import { Type } from "@fastify/type-provider-typebox";
import {
  invitationErrorSchema,
  invitationResponseSchema,
} from "../invitations/schemas.ts";

export const uuidSchema = Type.String({
  format: "uuid",
  pattern:
    "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
});
export const profileSchema = Type.Object({
  id: uuidSchema,
  firstName: Type.String(),
  avatarMediaId: Type.Union([uuidSchema, Type.Null()]),
  hasInvitationResponse: Type.Boolean(),
  role: Type.Union([Type.Literal("main"), Type.Literal("companion")]),
});
export const accessSchema = Type.Object({
  hubEnabled: Type.Boolean(),
  profile: Type.Union([profileSchema, Type.Null()]),
});
export const restoreSchema = Type.Object(
  { responseId: uuidSchema },
  { additionalProperties: false },
);
export const guestLoginSchema = Type.Object(
  { code: Type.String({ minLength: 1, maxLength: 128 }) },
  { additionalProperties: false },
);
export const codeProfileParams = Type.Object(
  { profileId: uuidSchema },
  { additionalProperties: false },
);
export const issuedCodeSchema = Type.Object({ code: Type.String() });
export const codeProfilesSchema = Type.Array(
  Type.Object({
    id: uuidSchema,
    firstName: Type.String(),
    role: Type.Union([Type.Literal("main"), Type.Literal("companion")]),
    accessEnabled: Type.Boolean(),
    codeEnabled: Type.Boolean(),
  }),
);
export const profilePatchSchema = Type.Object(
  { firstName: Type.String({ minLength: 1, maxLength: 50 }) },
  { additionalProperties: false },
);
export const currentInvitationSchema = Type.Omit(invitationResponseSchema, [
  "id",
]);
export const companionClaimSchema = Type.Object(
  {
    mainProfileId: uuidSchema,
    token: Type.String({ pattern: "^[A-Za-z0-9_-]{43}$" }),
    firstName: Type.String({ minLength: 1, maxLength: 50 }),
  },
  { additionalProperties: false },
);
export const companionInvitationSchema = Type.Object({
  mainProfileId: uuidSchema,
  token: Type.String(),
  expiresAt: Type.String({ format: "date-time" }),
});
export const hubSettingsSchema = Type.Object(
  { hubEnabled: Type.Boolean() },
  { additionalProperties: false },
);
export const profileErrors = {
  "4xx": invitationErrorSchema,
  "5xx": invitationErrorSchema,
};
