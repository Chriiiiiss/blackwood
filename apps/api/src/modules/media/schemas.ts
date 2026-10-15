import { Type } from "@fastify/type-provider-typebox";
import { uuidSchema } from "../profiles/schemas.ts";

export const mediaParamsSchema = Type.Object(
  {
    id: uuidSchema,
    variant: Type.Union([Type.Literal("image"), Type.Literal("thumbnail")]),
  },
  { additionalProperties: false },
);
export const cropSchema = Type.Object(
  {
    left: Type.Number({ minimum: 0, maximum: 1 }),
    top: Type.Number({ minimum: 0, maximum: 1 }),
    size: Type.Number({ exclusiveMinimum: 0, maximum: 1 }),
  },
  { additionalProperties: false },
);
