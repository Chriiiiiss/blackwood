import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { MediaError } from "../media/errors.ts";
import { OrganizerError } from "../organizer/errors.ts";
import { ProfileError } from "../profiles/errors.ts";

export class CoffreError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super("Unable to complete this Coffre request.");
    this.status = status;
    this.code = code;
  }
}

export function handleCoffreError(
  caught: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (
    caught instanceof CoffreError ||
    caught instanceof MediaError ||
    caught instanceof ProfileError ||
    caught instanceof OrganizerError
  ) {
    const retryAfter =
      "retryAfter" in caught
        ? caught.retryAfter
        : caught.status === 429
          ? 2
          : undefined;
    if (retryAfter) reply.header("Retry-After", retryAfter);
    return reply.code(caught.status).send({
      code: caught.code,
      message: "Unable to complete this Coffre request. Please try again.",
    });
  }
  const error = caught as FastifyError;
  if (error.validation)
    return reply.code(400).send({
      code: "VALIDATION_ERROR",
      message: "Please check your contribution.",
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
    return reply.code(error.statusCode).send({
      code: error.statusCode === 413 ? "MEDIA_TOO_LARGE" : "INVALID_REQUEST",
      message: "Send a valid contribution within the allowed limits.",
    });
  // Bind parameters can contain private messages, session tokens and storage paths.
  request.log.error("Coffre operation failed.");
  return reply.code(503).send({
    code: "COFFRE_UNAVAILABLE",
    message: "Coffre is temporarily unavailable. Please try again.",
  });
}
