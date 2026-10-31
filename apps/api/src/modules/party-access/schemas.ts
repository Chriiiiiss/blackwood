import { Type } from "@fastify/type-provider-typebox";
export const partyAccessSchema = Type.Object(
  {
    opensAt: Type.String({ format: "date-time" }),
    serverNow: Type.String({ format: "date-time" }),
    isOpen: Type.Boolean(),
  },
  { additionalProperties: false },
);
