import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";

export class ProfileError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super("Guest profile request failed.");
    this.status = status;
    this.code = code;
  }
}

export function handleProfileError(
  caught: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (caught instanceof ProfileError) {
    return reply.code(caught.status).send({
      code: caught.code,
      message: "Unable to complete this guest request.",
    });
  }
  const error = caught as FastifyError;
  if (error.validation)
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
  if (error.statusCode && error.statusCode < 500)
    return reply
      .code(error.statusCode)
      .send({ code: "INVALID_REQUEST", message: "Send a valid JSON request." });
  // Database errors can contain legacy UUIDs or session bind parameters.
  request.log.error("Guest profile storage operation failed.");
  return reply.code(500).send({
    code: "PROFILE_UNAVAILABLE",
    message: "Unable to access your profile. Please try again.",
  });
}
