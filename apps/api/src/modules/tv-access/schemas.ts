import { Type } from "@fastify/type-provider-typebox";

export const tvLoginSchema = Type.Object(
  { code: Type.String({ pattern: "^[0-9]{4}$", minLength: 4, maxLength: 4 }) },
  { additionalProperties: false },
);
export const pairingSchema = Type.Object({
  code: Type.String(),
  expiresAt: Type.String({ format: "date-time" }),
});
export const sessionSchema = Type.Object({
  expiresAt: Type.String({ format: "date-time" }),
});
export const tvErrors = {
  "4xx": Type.Object({ code: Type.String(), message: Type.String() }),
  "5xx": Type.Object({ code: Type.String(), message: Type.String() }),
};
