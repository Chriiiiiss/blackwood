import { Type, type TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { eq, sql } from "drizzle-orm";
import type { FastifyError, FastifyInstance } from "fastify";
import type { createDatabase } from "../../db/client.ts";
import { invitationResponses } from "../../db/schema.ts";

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
const params = Type.Object({ id: responseId }, { additionalProperties: false });
const body = Type.Object(
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
const savedResponse = Type.Object({
  id: responseId,
  firstName: Type.String(),
  attendance,
  plusOne: Type.Boolean(),
  ideas: Type.Union([Type.String(), Type.Null()]),
});
const errorResponse = Type.Object({
  code: Type.String(),
  message: Type.String(),
  errors: Type.Optional(
    Type.Array(Type.Object({ field: Type.String(), message: Type.String() })),
  ),
});
const selection = {
  id: invitationResponses.id,
  firstName: invitationResponses.firstName,
  attendance: invitationResponses.attendance,
  plusOne: invitationResponses.plusOne,
  ideas: invitationResponses.ideas,
};

export function registerInvitationRoutes(
  instance: FastifyInstance,
  db: ReturnType<typeof createDatabase>["db"],
) {
  const app = instance.withTypeProvider<TypeBoxTypeProvider>();

  app.addHook("onSend", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
  });
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error.validation) {
      return reply.code(400).send({
        code: "VALIDATION_ERROR",
        message: "Please check your response.",
        errors: error.validation.map((issue) => ({
          field:
            issue.params.missingProperty ??
            issue.params.additionalProperty ??
            (issue.instancePath.replace(/^\//, "") ||
              error.validationContext ||
              "body"),
          message: issue.message ?? "Invalid value.",
        })),
      });
    }
    if (error.statusCode && error.statusCode < 500) {
      return reply.code(error.statusCode).send({
        code: "INVALID_REQUEST",
        message: "Send a valid JSON response.",
      });
    }
    request.log.error({ err: error }, "Invitation response request failed.");
    return reply.code(500).send({
      code: "RESPONSE_UNAVAILABLE",
      message: "Unable to access your response. Please try again.",
    });
  });

  app.put(
    "/api/invitation-responses/:id",
    {
      preValidation: async (request) => {
        if (
          request.body &&
          typeof request.body === "object" &&
          "firstName" in request.body &&
          typeof request.body.firstName === "string"
        ) {
          request.body.firstName = request.body.firstName.trim();
        }
      },
      schema: {
        params,
        body,
        response: {
          200: savedResponse,
          400: errorResponse,
          500: errorResponse,
        },
      },
    },
    async (request) => {
      const values = {
        firstName: request.body.firstName,
        attendance: request.body.attendance,
        plusOne:
          request.body.attendance === "no"
            ? false
            : (request.body.plusOne ?? false),
        ideas: request.body.ideas?.trim() ? request.body.ideas : null,
      };
      const [response] = await db
        .insert(invitationResponses)
        .values({ id: request.params.id, ...values })
        .onConflictDoUpdate({
          target: invitationResponses.id,
          set: { ...values, updatedAt: sql`now()` },
        })
        .returning(selection);
      return response;
    },
  );

  app.get(
    "/api/invitation-responses/:id",
    {
      schema: {
        params,
        response: {
          200: savedResponse,
          400: errorResponse,
          404: errorResponse,
          500: errorResponse,
        },
      },
    },
    async (request, reply) => {
      const [response] = await db
        .select(selection)
        .from(invitationResponses)
        .where(eq(invitationResponses.id, request.params.id));
      if (!response) {
        return reply.code(404).send({
          code: "RESPONSE_NOT_FOUND",
          message: "No response was found for this identifier.",
        });
      }
      return response;
    },
  );
}
