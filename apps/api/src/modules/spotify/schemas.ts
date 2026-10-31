import { Type } from "@fastify/type-provider-typebox";

const strict = { additionalProperties: false };
export const emptyBody = Type.Object({}, strict);
export const connectionStatusSchema = Type.Object(
  {
    configured: Type.Boolean(),
    connected: Type.Boolean(),
    redirectUri: Type.String(),
  },
  strict,
);
export const authorizeSchema = Type.Object({ url: Type.String() }, strict);
export const callbackSchema = Type.Object(
  {
    code: Type.Optional(Type.String({ maxLength: 2048 })),
    state: Type.Optional(Type.String({ maxLength: 128 })),
    error: Type.Optional(Type.String({ maxLength: 128 })),
  },
  strict,
);
export const currentTrackSchema = Type.Object(
  {
    track: Type.Union([
      Type.Null(),
      Type.Object(
        {
          id: Type.String(),
          title: Type.String(),
          artists: Type.Array(Type.String()),
          coverUrl: Type.Union([Type.String(), Type.Null()]),
          spotifyUrl: Type.String(),
        },
        strict,
      ),
    ]),
  },
  strict,
);
