import { Type, type TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { OrganizerService } from "../organizer/service.ts";
import { hashGuestToken, type ProfileService } from "../profiles/service.ts";
import { type TvAccessService, tvCookieName } from "../tv-access/service.ts";
import { handleMissionError, MissionError } from "./errors.ts";
import type { MissionActor } from "./repository.ts";
import {
  claimSchema,
  decisionSchema,
  drawSchema,
  incomingSchema,
  leaderboardSchema,
  missionErrors,
  ownSchema,
  paramsSchema,
  playersSchema,
  settingsSchema,
} from "./schemas.ts";
import type { MissionService } from "./service.ts";

export function registerMissionRoutes(
  instance: FastifyInstance,
  service: MissionService,
  guests: Pick<ProfileService, "profile">,
  organizer: Pick<OrganizerService, "session">,
  tv: Pick<TvAccessService, "session">,
  appOrigin: string,
) {
  const app = instance.withTypeProvider<TypeBoxTypeProvider>();
  const secure = new URL(appOrigin).protocol === "https:";
  const actors = new WeakMap<FastifyRequest, MissionActor>();
  app.setErrorHandler(handleMissionError);
  app.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    reply.header("Vary", "Cookie, Origin, Sec-Fetch-Site");
    const administrative =
      request.routeOptions.url?.startsWith("/api/organizer/");
    const writes = !["GET", "HEAD"].includes(request.method);
    if (
      (administrative && request.headers["x-organizer-request"] !== "1") ||
      (writes &&
        (request.headers.origin !== appOrigin ||
          request.headers[
            administrative ? "x-organizer-request" : "x-guest-request"
          ] !== "1"))
    )
      throw new MissionError(403, "REQUEST_NOT_ALLOWED");
    if (administrative)
      await organizer.session(
        request.cookies[
          secure ? "__Host-blackwood-organizer" : "blackwood-organizer-dev"
        ],
      );
    else if (request.routeOptions.url?.startsWith("/api/tv/"))
      await tv.session(request.cookies[tvCookieName(appOrigin)]);
    else {
      const token =
        request.cookies[
          secure ? "__Host-blackwood-guest" : "blackwood-guest-dev"
        ];
      const profile = await guests.profile(token);
      actors.set(request, {
        profileId: profile.id,
        sessionHash: hashGuestToken(token ?? ""),
      });
    }
  });
  function actor(request: FastifyRequest) {
    const value = actors.get(request);
    if (!value) throw new Error("Mission authentication missing.");
    return value;
  }
  app.get(
    "/api/missions/me",
    { schema: { response: { 200: ownSchema, ...missionErrors } } },
    (request) => service.own(actor(request).profileId),
  );
  app.post(
    "/api/missions/me/assignments",
    {
      bodyLimit: 4096,
      schema: {
        body: drawSchema,
        response: { 200: ownSchema, ...missionErrors },
      },
    },
    (request) =>
      service.draw(actor(request), request.body.id, request.body.after),
  );
  app.get(
    "/api/missions/players",
    { schema: { response: { 200: playersSchema, ...missionErrors } } },
    (request) => service.players(actor(request).profileId),
  );
  app.get(
    "/api/missions/me/confirmations",
    { schema: { response: { 200: incomingSchema, ...missionErrors } } },
    (request) => service.incoming(actor(request).profileId),
  );
  app.post(
    "/api/missions/me/assignments/:id/claims",
    {
      bodyLimit: 4096,
      schema: {
        params: paramsSchema,
        body: claimSchema,
        response: { 204: Type.Null(), ...missionErrors },
      },
    },
    async (request, reply) => {
      await service.claim(
        actor(request),
        request.params.id,
        request.body.id,
        request.body.recipientProfileId,
      );
      return reply.code(204).send(null);
    },
  );
  app.post(
    "/api/missions/me/confirmations/:id/decision",
    {
      bodyLimit: 4096,
      schema: {
        params: paramsSchema,
        body: decisionSchema,
        response: { 204: Type.Null(), ...missionErrors },
      },
    },
    async (request, reply) => {
      await service.decide(
        actor(request),
        request.params.id,
        request.body.decision,
      );
      return reply.code(204).send(null);
    },
  );
  app.delete(
    "/api/missions/me/claims/:id",
    {
      schema: {
        params: paramsSchema,
        response: { 204: Type.Null(), ...missionErrors },
      },
    },
    async (request, reply) => {
      await service.decide(actor(request), request.params.id, "cancelled");
      return reply.code(204).send(null);
    },
  );
  app.get(
    "/api/tv/missions/leaderboard",
    { schema: { response: { 200: leaderboardSchema, ...missionErrors } } },
    () => service.leaderboard(),
  );
  app.get(
    "/api/organizer/missions/tv-settings",
    { schema: { response: { 200: settingsSchema, ...missionErrors } } },
    () => service.settings(),
  );
  app.put(
    "/api/organizer/missions/tv-settings",
    {
      bodyLimit: 4096,
      schema: {
        body: settingsSchema,
        response: { 200: settingsSchema, ...missionErrors },
      },
    },
    (request) => service.saveSettings(request.body.showScoresWithMemories),
  );
}
