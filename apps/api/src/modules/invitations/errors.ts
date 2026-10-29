import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { handleProfileError, ProfileError } from "../profiles/errors.ts";

export function handleInvitationError(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (error instanceof ProfileError)
    return handleProfileError(error, request, reply);
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
}
