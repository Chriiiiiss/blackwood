import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyInstance } from "fastify";
import { handleInvitationError } from "./errors.ts";
import {
  invitationBodySchema,
  invitationErrorSchema,
  invitationParamsSchema,
  invitationResponseSchema,
} from "./schemas.ts";
import { type InvitationService, trimInvitationFirstName } from "./service.ts";

export function registerInvitationRoutes(
  instance: FastifyInstance,
  service: InvitationService,
) {
  const app = instance.withTypeProvider<TypeBoxTypeProvider>();

  app.addHook("onSend", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
  });
  app.setErrorHandler(handleInvitationError);

  app.put(
    "/api/invitation-responses/:id",
    {
      preValidation: async (request) => {
        trimInvitationFirstName(request.body);
      },
      schema: {
        params: invitationParamsSchema,
        body: invitationBodySchema,
        response: {
          200: invitationResponseSchema,
          400: invitationErrorSchema,
          403: invitationErrorSchema,
          500: invitationErrorSchema,
        },
      },
    },
    async (request) => {
      return service.save(request.params.id, request.body);
    },
  );

  app.get(
    "/api/invitation-responses/:id",
    {
      schema: {
        params: invitationParamsSchema,
        response: {
          200: invitationResponseSchema,
          400: invitationErrorSchema,
          403: invitationErrorSchema,
          404: invitationErrorSchema,
          500: invitationErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const response = await service.findById(request.params.id);
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
