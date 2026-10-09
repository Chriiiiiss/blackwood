import { Type } from "@fastify/type-provider-typebox";
import type { Static } from "typebox";

const responseId = Type.String({
  format: "uuid",
  pattern:
    "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
});
const attendance = Type.Union([
  Type.Literal("yes"),
  Type.Literal("no"),
  Type.Literal("to_confirm"),
]);
export const invitationParamsSchema = Type.Object(
  { id: responseId },
  { additionalProperties: false },
);
export const invitationBodySchema = Type.Object(
  {
    firstName: Type.String({ minLength: 1, maxLength: 50 }),
    attendance,
    plusOne: Type.Optional(Type.Boolean()),
    ideas: Type.Optional(Type.String({ maxLength: 1000 })),
  },
  {
    additionalProperties: false,
    allOf: [
      {
        if: {
          required: ["attendance"],
          properties: { attendance: { enum: ["yes", "to_confirm"] } },
        },
        // biome-ignore lint/suspicious/noThenProperty: JSON Schema conditional keyword.
        then: { required: ["plusOne"] },
      },
    ],
  },
);
export const invitationResponseSchema = Type.Object({
  id: responseId,
  firstName: Type.String(),
  attendance,
  plusOne: Type.Boolean(),
  ideas: Type.Union([Type.String(), Type.Null()]),
});
export const invitationErrorSchema = Type.Object({
  code: Type.String(),
  message: Type.String(),
  errors: Type.Optional(
    Type.Array(Type.Object({ field: Type.String(), message: Type.String() })),
  ),
});
export type InvitationInput = Static<typeof invitationBodySchema>;
