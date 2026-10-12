import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";

export class OrganizerError extends Error {
  status: number;
  code: string;
  retryAfter: number | undefined;
  constructor(status: number, code: string, retryAfter?: number) {
    super("Organizer request failed.");
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export function handleOrganizerError(
  caught: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
  clearCookie: () => void,
) {
  const error = caught as FastifyError | OrganizerError;
  if (error instanceof OrganizerError) {
    if (error.code === "UNAUTHENTICATED") clearCookie();
    if (error.retryAfter) reply.header("Retry-After", error.retryAfter);
    return reply.code(error.status).send({
      code: error.code,
      message: "Unable to complete this organizer request.",
    });
  }
  if (error.validation)
    return reply.code(400).send({
      code: "VALIDATION_ERROR",
      message: "Please check your password.",
    });
  const status = error.statusCode ?? 500;
  if (status < 500)
    return reply.code(status).send({
      code:
        status === 413
          ? "REQUEST_TOO_LARGE"
          : status === 415
            ? "UNSUPPORTED_MEDIA_TYPE"
            : "INVALID_REQUEST",
      message: "Send a valid organizer request.",
    });
  // Database errors may contain bind parameters. Keep them out of logs.
  request.log.error("Organizer storage operation failed.");
  return reply.code(503).send({
    code: "ORGANIZER_UNAVAILABLE",
    message: "Organizer access is temporarily unavailable.",
  });
}
