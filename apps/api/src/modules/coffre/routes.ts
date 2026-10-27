import { Type, type TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { mediaLimits } from "../media/limits.ts";
import type { MediaService } from "../media/service.ts";
import { receiveImageFile } from "../media/upload.ts";
import type { OrganizerService } from "../organizer/service.ts";
import { hashGuestToken, type ProfileService } from "../profiles/service.ts";
import { CoffreError, handleCoffreError } from "./errors.ts";
import type { CoffreActor } from "./repository.ts";
import {
  advanceSchema,
  type ContributionInput,
  coffreErrors,
  coffreQuerySchema,
  contributionInputSchema,
  detailSchema,
  durationSchema,
  emptyBodySchema,
  historyQuerySchema,
  historySchema,
  metadataPageSchema,
  nextCoffreSchema,
  organizerQuerySchema,
  pageQuerySchema,
  paramsSchema,
  publicPageSchema,
  receiptSchema,
  stateSchema,
} from "./schemas.ts";
import type { CoffreService } from "./service.ts";

export function registerCoffreRoutes(
  instance: FastifyInstance,
  service: CoffreService,
  media: Pick<MediaService, "preparePhoto" | "discardPhoto">,
  guests: Pick<ProfileService, "profile">,
  organizer: Pick<OrganizerService, "session">,
  appOrigin: string,
) {
  const app = instance.withTypeProvider<TypeBoxTypeProvider>();
  const secure = new URL(appOrigin).protocol === "https:";
  const guestCookie = secure ? "__Host-blackwood-guest" : "blackwood-guest-dev";
  const organizerCookie = secure
    ? "__Host-blackwood-organizer"
    : "blackwood-organizer-dev";
  const actors = new WeakMap<FastifyRequest, CoffreActor>();
  app.setErrorHandler(handleCoffreError);
  // Media routes are a sibling scope: this guard applies only to Coffre routes.
  app.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    reply.header("Vary", "Cookie, Origin, Sec-Fetch-Site");
    const administrative =
      request.routeOptions.url?.startsWith("/api/organizer/coffre") ?? false;
    const writes = !["GET", "HEAD"].includes(request.method);
    if (
      (administrative && request.headers["x-organizer-request"] !== "1") ||
      (writes &&
        (request.headers.origin !== appOrigin ||
          request.headers[
            administrative ? "x-organizer-request" : "x-guest-request"
          ] !== "1"))
    )
      throw new CoffreError(403, "REQUEST_NOT_ALLOWED");
    if (
      Number(request.headers["content-length"] ?? 0) > mediaLimits.requestBytes
    )
      throw new CoffreError(413, "MEDIA_TOO_LARGE");
    if (administrative) {
      await organizer.session(request.cookies[organizerCookie]);
      actors.set(request, { kind: "organizer" });
    } else {
      const token = request.cookies[guestCookie];
      const profile = await guests.profile(token);
      actors.set(request, {
        kind: "guest",
        profileId: profile.id,
        sessionHash: hashGuestToken(token ?? ""),
      });
    }
  });
  function actor(request: FastifyRequest) {
    const value = actors.get(request);
    if (!value) throw new Error("Coffre authentication missing.");
    return value;
  }
  function validateInput(
    request: FastifyRequest,
    value: unknown,
  ): ContributionInput {
    const validate = request.compileValidationSchema(contributionInputSchema);
    if (!validate(value))
      throw Object.assign(new Error("Invalid contribution."), {
        validation: validate.errors,
        validationContext: "body",
      });
    return value as ContributionInput;
  }
  function scope(query: { coffreId?: string }, fallback?: number) {
    return query.coffreId === undefined ? fallback : Number(query.coffreId);
  }
  async function deposit(request: FastifyRequest) {
    const author = actor(request);
    const coffreId = scope(request.query as { coffreId?: string }, 1);
    if (!request.isMultipart())
      return service.deposit(
        validateInput(request, request.body),
        author,
        undefined,
        coffreId,
      );
    let metadata: ContributionInput | undefined;
    let hash: string | undefined;
    const photo = await media.preparePhoto(
      author.kind === "guest" ? author.profileId : null,
      async (input) => {
        let files = 0;
        for await (const part of request.parts()) {
          if (part.type === "file") {
            if (part.fieldname !== "file" || ++files !== 1) {
              part.file.resume();
              throw new CoffreError(400, "INVALID_MEDIA_REQUEST");
            }
            hash = await receiveImageFile(part, input);
          } else {
            if (
              part.fieldname !== "contribution" ||
              metadata ||
              part.valueTruncated ||
              part.fieldnameTruncated ||
              typeof part.value !== "string"
            )
              throw new CoffreError(400, "INVALID_MEDIA_REQUEST");
            let value: unknown;
            try {
              value = JSON.parse(part.value);
            } catch {
              throw new CoffreError(400, "INVALID_REQUEST");
            }
            metadata = validateInput(request, value);
          }
        }
        if (files !== 1 || !metadata)
          throw new CoffreError(400, "INVALID_MEDIA_REQUEST");
        return undefined;
      },
    );
    if (!metadata || !hash) {
      await media.discardPhoto(photo.id);
      throw new CoffreError(400, "INVALID_MEDIA_REQUEST");
    }
    return service.deposit(metadata, author, { id: photo.id, hash }, coffreId);
  }
  const stateResponses = { 200: stateSchema, ...coffreErrors };
  for (const url of ["/api/coffre", "/api/organizer/coffre"]) {
    app.get(
      url,
      { schema: { querystring: coffreQuerySchema, response: stateResponses } },
      (request) =>
        url.startsWith("/api/organizer/")
          ? service.state(scope(request.query))
          : service.guestState(scope(request.query)),
    );
  }
  for (const url of ["/api/organizer/coffres"]) {
    app.get(
      url,
      {
        schema: {
          querystring: historyQuerySchema,
          response: { 200: historySchema, ...coffreErrors },
        },
      },
      (request) =>
        service.history(
          request.query.before ? Number(request.query.before) : undefined,
        ),
    );
  }
  app.post(
    "/api/organizer/coffres",
    {
      bodyLimit: 4096,
      schema: { body: nextCoffreSchema, response: stateResponses },
    },
    (request) => service.createNext(request.body.previousCoffreId),
  );
  app.put(
    "/api/organizer/coffre",
    {
      bodyLimit: 4096,
      schema: {
        body: durationSchema,
        querystring: coffreQuerySchema,
        response: stateResponses,
      },
    },
    (request) =>
      service.prepare(request.body.durationSeconds, scope(request.query, 1)),
  );
  app.post(
    "/api/organizer/coffre/start",
    {
      bodyLimit: 4096,
      schema: {
        body: emptyBodySchema,
        querystring: coffreQuerySchema,
        response: stateResponses,
      },
    },
    (request) => service.start(scope(request.query, 1)),
  );
  app.post(
    "/api/organizer/coffre/advance",
    {
      bodyLimit: 4096,
      schema: {
        body: advanceSchema,
        querystring: coffreQuerySchema,
        response: stateResponses,
      },
    },
    (request) =>
      service.advance(request.body.deadline, scope(request.query, 1)),
  );
  app.post(
    "/api/organizer/coffre/open",
    {
      bodyLimit: 4096,
      schema: {
        body: emptyBodySchema,
        querystring: coffreQuerySchema,
        response: stateResponses,
      },
    },
    (request) => service.open(scope(request.query, 1)),
  );
  for (const url of [
    "/api/coffre/contributions",
    "/api/organizer/coffre/contributions",
  ]) {
    app.post(
      url,
      {
        bodyLimit: 4096,
        schema: {
          querystring: coffreQuerySchema,
          response: { 200: receiptSchema, ...coffreErrors },
        },
      },
      deposit,
    );
  }
  app.get(
    "/api/coffre/contributions",
    {
      schema: {
        querystring: pageQuerySchema,
        response: { 200: publicPageSchema, ...coffreErrors },
      },
    },
    (request) =>
      service.publicPage(request.query.after, scope(request.query, 1)),
  );
  app.get(
    "/api/organizer/coffre/contributions",
    {
      schema: {
        querystring: organizerQuerySchema,
        response: { 200: metadataPageSchema, ...coffreErrors },
      },
    },
    (request) =>
      service.metadataPage(
        request.query.after,
        request.query.visibility,
        scope(request.query, 1),
      ),
  );
  app.get(
    "/api/organizer/coffre/contributions/:id",
    {
      schema: {
        params: paramsSchema,
        querystring: coffreQuerySchema,
        response: { 200: detailSchema, ...coffreErrors },
      },
    },
    (request) => service.detail(request.params.id, scope(request.query, 1)),
  );
  app.delete(
    "/api/organizer/coffre/contributions/:id",
    {
      schema: {
        params: paramsSchema,
        querystring: coffreQuerySchema,
        response: { 204: Type.Null(), ...coffreErrors },
      },
    },
    async (request, reply) => {
      await service.remove(request.params.id, scope(request.query, 1));
      return reply.code(204).send(null);
    },
  );
}
