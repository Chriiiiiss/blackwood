import { Type } from "@fastify/type-provider-typebox";

export const loginSchema = Type.Object(
  { password: Type.String({ minLength: 1, maxLength: 128 }) },
  { additionalProperties: false },
);
export const sessionSchema = Type.Object(
  {
    authenticated: Type.Literal(true),
    expiresAt: Type.String(),
    idleExpiresAt: Type.String(),
  },
  { additionalProperties: false },
);
export const errorSchema = Type.Object(
  { code: Type.String(), message: Type.String() },
  { additionalProperties: false },
);
export const responsesSchema = Type.Object(
  {
    responses: Type.Array(
      Type.Object(
        {
          firstName: Type.String(),
          attendance: Type.Union([
            Type.Literal("yes"),
            Type.Literal("no"),
            Type.Literal("to_confirm"),
          ]),
          plusOne: Type.Boolean(),
          ideas: Type.Union([Type.String(), Type.Null()]),
        },
        { additionalProperties: false },
      ),
    ),
    totals: Type.Object({
      attending: Type.Integer(),
      toConfirm: Type.Integer(),
      plusOnes: Type.Integer(),
    }),
  },
  { additionalProperties: false },
);
