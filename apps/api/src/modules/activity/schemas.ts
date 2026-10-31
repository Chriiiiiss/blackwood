import { type Static, Type } from "@fastify/type-provider-typebox";

const strict = { additionalProperties: false };
export const pageSchema = Type.Union([
  Type.Literal("hub"),
  Type.Literal("invitation"),
  Type.Literal("coffre"),
  Type.Literal("missions"),
  Type.Literal("profile"),
  Type.Literal("companion"),
  Type.Literal("login"),
  Type.Literal("waiting"),
  Type.Literal("not_found"),
]);
export const eventSchema = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    kind: Type.Union([
      Type.Literal("page_view"),
      Type.Literal("action"),
      Type.Literal("api_error"),
      Type.Literal("client_error"),
      Type.Literal("network_error"),
    ]),
    page: pageSchema,
    route: Type.Optional(Type.String({ maxLength: 200 })),
    method: Type.Optional(
      Type.Union([
        Type.Literal("GET"),
        Type.Literal("POST"),
        Type.Literal("PUT"),
        Type.Literal("PATCH"),
        Type.Literal("DELETE"),
        Type.Literal("HEAD"),
      ]),
    ),
    status: Type.Optional(Type.Integer({ minimum: 100, maximum: 599 })),
    code: Type.Optional(
      Type.Union([
        Type.Literal("HTTP_ERROR"),
        Type.Literal("NETWORK_ERROR"),
        Type.Literal("TimeoutError"),
        Type.Literal("TypeError"),
        Type.Literal("ReferenceError"),
        Type.Literal("SyntaxError"),
        Type.Literal("RangeError"),
        Type.Literal("Error"),
        Type.Literal("UnhandledRejection"),
      ]),
    ),
    source: Type.Optional(
      Type.String({
        maxLength: 120,
        pattern: "^[a-zA-Z0-9_-]+\\.js(?::[0-9]{1,7}){0,2}$",
      }),
    ),
  },
  strict,
);
export type ActivityInput = Static<typeof eventSchema>;
export const filtersSchema = Type.Object(
  {
    profileId: Type.Optional(
      Type.Union([Type.String({ format: "uuid" }), Type.Literal("anonymous")]),
    ),
    page: Type.Optional(pageSchema),
    onlyErrors: Type.Optional(Type.Literal("1")),
    before: Type.Optional(Type.String({ format: "uuid" })),
  },
  strict,
);
export type ActivityFilters = Static<typeof filtersSchema>;
const nullable = (schema: ReturnType<typeof Type.String>) =>
  Type.Union([schema, Type.Null()]);
export const feedSchema = Type.Object(
  {
    events: Type.Array(
      Type.Object(
        {
          id: Type.String(),
          profileId: nullable(Type.String()),
          firstName: nullable(Type.String()),
          kind: Type.String(),
          page: Type.String(),
          route: nullable(Type.String()),
          method: nullable(Type.String()),
          status: Type.Union([Type.Integer(), Type.Null()]),
          code: nullable(Type.String()),
          source: nullable(Type.String()),
          createdAt: Type.String(),
        },
        strict,
      ),
    ),
    nextCursor: nullable(Type.String()),
  },
  strict,
);
