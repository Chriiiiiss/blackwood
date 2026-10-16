import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { OrganizerService } from "../organizer/service.ts";
import { profileErrors, profileSchema } from "../profiles/schemas.ts";
import type { ProfileService } from "../profiles/service.ts";
import { handleMediaError, MediaError } from "./errors.ts";
import { type AvatarCrop, mediaLimits } from "./limits.ts";
import type { MediaActor } from "./policy.ts";
import { cropSchema, mediaParamsSchema } from "./schemas.ts";
import type { MediaService } from "./service.ts";

export function registerMediaRoutes(
  instance: FastifyInstance,
  service: MediaService,
  guests: ProfileService,
  organizer: OrganizerService,
  appOrigin: string,
) {
  const app = instance.withTypeProvider<TypeBoxTypeProvider>();
  const secure = new URL(appOrigin).protocol === "https:";
  const guestCookie = secure ? "__Host-blackwood-guest" : "blackwood-guest-dev";
  const organizerCookie = secure
    ? "__Host-blackwood-organizer"
    : "blackwood-organizer-dev";
  app.setErrorHandler(handleMediaError);
  app.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    reply.header("Vary", "Cookie, Origin, Sec-Fetch-Site");
    reply.header("X-Content-Type-Options", "nosniff");
    if (["PUT", "DELETE"].includes(request.method)) {
      if (
        request.headers.origin !== appOrigin ||
        request.headers["x-guest-request"] !== "1"
      )
        throw new MediaError(403, "REQUEST_NOT_ALLOWED");
      if (
        Number(request.headers["content-length"] ?? 0) >
        mediaLimits.requestBytes
      )
        throw new MediaError(413, "MEDIA_TOO_LARGE");
    }
  });
  async function receive(request: FastifyRequest, input: string) {
    if (!request.isMultipart())
      throw new MediaError(415, "INVALID_MEDIA_REQUEST");
    let count = 0;
    let crop: AvatarCrop | undefined;
    for await (const part of request.parts()) {
      if (part.type === "file") {
        if (part.fieldname !== "file" || ++count !== 1) {
          part.file.resume();
          throw new MediaError(400, "INVALID_MEDIA_REQUEST");
        }
        await pipeline(
          part.file,
          createWriteStream(input, { flags: "wx", mode: 0o600 }),
          { signal: AbortSignal.timeout(mediaLimits.uploadMs) },
        );
        if (part.file.truncated) throw new MediaError(413, "MEDIA_TOO_LARGE");
      } else {
        if (
          part.fieldname !== "crop" ||
          crop ||
          part.fieldnameTruncated ||
          part.valueTruncated
        )
          throw new MediaError(400, "INVALID_CROP");
        let value: unknown;
        try {
          value =
            typeof part.value === "string"
              ? JSON.parse(part.value)
              : part.value;
        } catch {
          throw new MediaError(400, "INVALID_CROP");
        }
        if (!request.compileValidationSchema(cropSchema)(value))
          throw new MediaError(400, "INVALID_CROP");
        crop = value as AvatarCrop;
      }
    }
    if (count !== 1) throw new MediaError(400, "INVALID_MEDIA_REQUEST");
    return crop;
  }
  app.put(
    "/api/profiles/me/avatar",
    { schema: { response: { 200: profileSchema, ...profileErrors } } },
    async (request) => {
      const profile = await guests.profile(request.cookies[guestCookie]);
      await service.uploadAvatar(profile.id, (input) =>
        receive(request, input),
      );
      return guests.profile(request.cookies[guestCookie]);
    },
  );
  app.delete(
    "/api/profiles/me/avatar",
    { schema: { response: { 200: profileSchema, ...profileErrors } } },
    async (request) => {
      const profile = await guests.profile(request.cookies[guestCookie]);
      await service.deleteAvatar(profile.id);
      return guests.profile(request.cookies[guestCookie]);
    },
  );
  app.get(
    "/api/media/:id/:variant",
    { schema: { params: mediaParamsSchema } },
    async (request, reply) => {
      let actor: MediaActor = { kind: "anonymous" };
      if (request.cookies[organizerCookie]) {
        try {
          await organizer.session(request.cookies[organizerCookie]);
          actor = { kind: "organizer" };
        } catch (caught) {
          if (
            !(
              caught instanceof Error &&
              "status" in caught &&
              [401, 503].includes(Number(caught.status))
            )
          )
            throw caught;
        }
      }
      if (actor.kind !== "organizer") {
        const access = await guests.access(request.cookies[guestCookie]);
        if (access.profile && access.hubEnabled)
          actor = { kind: "guest", profileId: access.profile.id };
      }
      const image = await service.read(
        request.params.id,
        request.params.variant,
        actor,
      );
      reply.type("image/jpeg");
      if (image.bytes) reply.header("Content-Length", image.bytes);
      return reply.send(image.stream);
    },
  );
}
