import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { OrganizerError } from "../organizer/errors.ts";
import { ProfileError } from "../profiles/errors.ts";
import { TvAccessError } from "../tv-access/errors.ts";

export class MissionError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super("Unable to complete this Mission request.");
    this.status = status;
    this.code = code;
  }
}

export function handleMissionError(
  caught: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (
    caught instanceof TvAccessError ||
    caught instanceof MissionError ||
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
      message: "Unable to complete this Mission request. Please try again.",
    });
  }
  const error = caught as FastifyError;
  if (error.validation)
    return reply.code(400).send({
      code: "VALIDATION_ERROR",
      message: "Please check your mission request.",
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
      code: "INVALID_REQUEST",
      message: "Send a valid mission request.",
    });
  // Do not log private mission text or session tokens.
  request.log.error("Mission operation failed.");
  return reply.code(503).send({
    code: "MISSIONS_UNAVAILABLE",
    message: "Mission is temporarily unavailable. Please try again.",
  });
}
