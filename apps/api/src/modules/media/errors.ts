import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ProfileError } from "../profiles/errors.ts";

export class MediaError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super("Unable to access this image.");
    this.status = status;
    this.code = code;
  }
}

export function handleMediaError(
  caught: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (caught instanceof MediaError || caught instanceof ProfileError) {
    if (caught.status === 429) reply.header("Retry-After", "2");
    return reply.code(caught.status).send({
      code: caught.code,
      message: "Unable to access this image. Please try again.",
    });
  }
  const error = caught as FastifyError;
  if (error.code?.startsWith("FST_")) {
    const status =
      error.statusCode && error.statusCode < 500 ? error.statusCode : 400;
    return reply.code(status).send({
      code: status === 413 ? "MEDIA_TOO_LARGE" : "INVALID_MEDIA_REQUEST",
      message: "Send one image within the allowed limits.",
    });
  }
  if (error.validation)
    return reply.code(400).send({
      code: "VALIDATION_ERROR",
      message: "Please check the image identifier.",
    });
  // Decoder and filesystem errors can contain input metadata or private paths.
  request.log.error("Media operation failed.");
  return reply.code(500).send({
    code: "MEDIA_UNAVAILABLE",
    message: "Unable to access this image. Please try again.",
  });
}
