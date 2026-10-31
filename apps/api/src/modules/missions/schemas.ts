import { Type } from "@fastify/type-provider-typebox";

const object = { additionalProperties: false };
const uuid = Type.String({ format: "uuid" });
export const paramsSchema = Type.Object({ id: uuid }, object);
export const drawSchema = Type.Object(
  { id: uuid, after: Type.Union([uuid, Type.Null()]) },
  object,
);
export const claimSchema = Type.Object(
  { id: uuid, recipientProfileId: uuid },
  object,
);
export const decisionSchema = Type.Object(
  {
    decision: Type.Union([Type.Literal("confirmed"), Type.Literal("rejected")]),
  },
  object,
);
export const settingsSchema = Type.Object(
  { showScoresWithMemories: Type.Boolean() },
  object,
);
export const ownSchema = Type.Object(
  {
    score: Type.Integer(),
    exhausted: Type.Boolean(),
    current: Type.Union([
      Type.Null(),
      Type.Object(
        {
          id: uuid,
          text: Type.String(),
          pending: Type.Union([
            Type.Null(),
            Type.Object({ id: uuid, recipient: Type.String() }, object),
          ]),
        },
        object,
      ),
    ]),
    history: Type.Array(
      Type.Object(
        { id: uuid, text: Type.String(), completedAt: Type.String() },
        object,
      ),
    ),
  },
  object,
);
export const playersSchema = Type.Array(
  Type.Object({ id: uuid, firstName: Type.String() }, object),
);
export const incomingSchema = Type.Array(
  Type.Object(
    {
      id: uuid,
      assignmentId: uuid,
      text: Type.String(),
      firstName: Type.String(),
    },
    object,
  ),
);
export const leaderboardSchema = Type.Object(
  {
    players: Type.Array(
      Type.Object(
        {
          rank: Type.Integer(),
          firstName: Type.String(),
          points: Type.Integer(),
        },
        object,
      ),
    ),
    showScoresWithMemories: Type.Boolean(),
    refreshedAt: Type.String(),
  },
  object,
);
export const errorSchema = Type.Object({
  code: Type.String(),
  message: Type.String(),
  errors: Type.Optional(
    Type.Array(Type.Object({ field: Type.String(), message: Type.String() })),
  ),
});
export const missionErrors = {
  400: errorSchema,
  401: errorSchema,
  403: errorSchema,
  404: errorSchema,
  409: errorSchema,
  413: errorSchema,
  503: errorSchema,
};
