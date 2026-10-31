import { Type, type TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyInstance } from "fastify";
import { handleOrganizerError, OrganizerError } from "../organizer/errors.ts";
import { errorSchema } from "../organizer/schemas.ts";
import type { OrganizerService } from "../organizer/service.ts";
import { eventSchema, feedSchema, filtersSchema } from "./schemas.ts";
import type { ActivityService } from "./service.ts";

export function registerActivityRoutes(
  instance: FastifyInstance,
  service: ActivityService,
  organizer: OrganizerService,
  appOrigin: string,
) {
  const app = instance.withTypeProvider<TypeBoxTypeProvider>();
  const secure = new URL(appOrigin).protocol === "https:";
  const guestCookie = secure ? "__Host-blackwood-guest" : "blackwood-guest-dev";
  const organizerCookie = secure
    ? "__Host-blackwood-organizer"
    : "blackwood-organizer-dev";
  app.setErrorHandler((error, request, reply) =>
    handleOrganizerError(error, request, reply, () => {}),
  );
  app.addHook("onRequest", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
  });
  app.post(
    "/api/activity/events",
    {
      bodyLimit: 2048,
      onRequest: async (request) => {
        if (
          request.headers.origin !== appOrigin ||
          request.headers["x-guest-request"] !== "1"
        )
          throw new OrganizerError(403, "REQUEST_NOT_ALLOWED");
      },
      schema: {
        body: eventSchema,
        response: { 204: Type.Null(), "4xx": errorSchema, "5xx": errorSchema },
      },
    },
    async (request, reply) => {
      try {
        await service.record(request.body, request.cookies[guestCookie]);
      } catch {
        request.log.warn("Activity recording is unavailable.");
      }
      return reply.code(204).send(null);
    },
  );
  app.get(
    "/api/organizer/activity",
    {
      onRequest: async (request) => {
        if (request.headers["x-organizer-request"] !== "1")
          throw new OrganizerError(403, "REQUEST_NOT_ALLOWED");
        await organizer.prepare(false);
        await organizer.session(request.cookies[organizerCookie]);
      },
      schema: {
        querystring: filtersSchema,
        response: { 200: feedSchema, "4xx": errorSchema, "5xx": errorSchema },
      },
    },
    async (request) => service.feed(request.query),
  );
}
