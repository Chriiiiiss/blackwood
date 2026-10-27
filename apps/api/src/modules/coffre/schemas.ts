import { Type } from "@fastify/type-provider-typebox";
import type { Static } from "typebox";

export const contributionIdSchema = Type.String({
  format: "uuid",
  pattern:
    "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
});
const visibility = Type.Union([
  Type.Literal("public"),
  Type.Literal("private"),
]);
const frameId = Type.Union([
  Type.Literal("plain"),
  Type.Literal("one-wish-willow"),
]);
const nullableDate = Type.Union([
  Type.String({ format: "date-time" }),
  Type.Null(),
]);
export const contributionInputSchema = Type.Object(
  {
    id: contributionIdSchema,
    text: Type.Optional(Type.String({ maxLength: 500 })),
    visibility,
    frameId,
  },
  { additionalProperties: false },
);
export type ContributionInput = Static<typeof contributionInputSchema>;
export const durationSchema = Type.Object(
  {
    durationSeconds: Type.Integer({ minimum: 1, maximum: 604800 }),
  },
  { additionalProperties: false },
);
export const emptyBodySchema = Type.Object({}, { additionalProperties: false });
export const advanceSchema = Type.Object(
  { deadline: Type.String({ format: "date-time" }) },
  { additionalProperties: false },
);
export const paramsSchema = Type.Object(
  { id: contributionIdSchema },
  { additionalProperties: false },
);
const coffreIdQuery = Type.String({ pattern: "^[1-9][0-9]{0,8}$" });
const scope = { coffreId: Type.Optional(coffreIdQuery) };
export const coffreQuerySchema = Type.Object(scope, {
  additionalProperties: false,
});
export const historyQuerySchema = Type.Object(
  { before: Type.Optional(coffreIdQuery) },
  { additionalProperties: false },
);
export const nextCoffreSchema = Type.Object(
  { previousCoffreId: Type.Integer({ minimum: 1, maximum: 999999998 }) },
  { additionalProperties: false },
);
export const pageQuerySchema = Type.Object(
  {
    ...scope,
    after: Type.Optional(contributionIdSchema),
  },
  { additionalProperties: false },
);
export const organizerQuerySchema = Type.Object(
  {
    ...scope,
    after: Type.Optional(contributionIdSchema),
    visibility: Type.Optional(visibility),
  },
  { additionalProperties: false },
);
export const stateSchema = Type.Object({
  id: Type.Union([Type.Integer(), Type.Null()]),
  state: Type.Union([
    Type.Literal("unprepared"),
    Type.Literal("prepared"),
    Type.Literal("collecting"),
    Type.Literal("revealed"),
  ]),
  serverNow: Type.String({ format: "date-time" }),
  durationSeconds: Type.Union([Type.Integer(), Type.Null()]),
  startedAt: nullableDate,
  deadline: nullableDate,
});
export const historySchema = Type.Object({
  coffres: Type.Array(stateSchema),
  nextCursor: Type.Union([Type.Integer(), Type.Null()]),
});
export const receiptSchema = Type.Object({
  id: contributionIdSchema,
  received: Type.Literal(true),
});
const content = {
  id: contributionIdSchema,
  text: Type.Union([Type.String(), Type.Null()]),
  photoMediaId: Type.Union([contributionIdSchema, Type.Null()]),
  frameId,
  createdAt: Type.String({ format: "date-time" }),
};
const author = Type.Union([
  Type.Object({ profileId: contributionIdSchema, firstName: Type.String() }),
  Type.Null(),
]);
export const publicPageSchema = Type.Object({
  contributions: Type.Array(Type.Object(content)),
  nextCursor: Type.Union([contributionIdSchema, Type.Null()]),
});
export const detailSchema = Type.Object({ ...content, visibility, author });
export const metadataPageSchema = Type.Object({
  contributions: Type.Array(
    Type.Object({
      id: contributionIdSchema,
      visibility,
      frameId,
      createdAt: Type.String({ format: "date-time" }),
      hasText: Type.Boolean(),
      hasPhoto: Type.Boolean(),
      author,
    }),
  ),
  nextCursor: Type.Union([contributionIdSchema, Type.Null()]),
});
export const errorSchema = Type.Object({
  code: Type.String(),
  message: Type.String(),
  errors: Type.Optional(
    Type.Array(Type.Object({ field: Type.String(), message: Type.String() })),
  ),
});
export const coffreErrors = { "4xx": errorSchema, "5xx": errorSchema };
