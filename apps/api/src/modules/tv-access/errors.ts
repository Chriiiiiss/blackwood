import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { OrganizerError } from "../organizer/errors.ts";

export class TvAccessError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super("Unable to authorize this television.");
    this.status = status;
    this.code = code;
  }
}

export function handleTvAccessError(
  caught: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (caught instanceof TvAccessError || caught instanceof OrganizerError)
    return reply.code(caught.status).send({
      code: caught.code,
      message: "Unable to authorize this television.",
    });
  const error = caught as FastifyError;
  if (error.statusCode && error.statusCode < 500)
    return reply
      .code(error.statusCode)
      .send({ code: "INVALID_REQUEST", message: "Send a valid TV code." });
  request.log.error("TV authorization failed.");
  return reply.code(503).send({
    code: "TV_UNAVAILABLE",
    message: "TV authorization is temporarily unavailable.",
  });
}
