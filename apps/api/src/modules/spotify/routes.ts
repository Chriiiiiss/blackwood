import { Type, type TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyInstance } from "fastify";
import { handleOrganizerError, OrganizerError } from "../organizer/errors.ts";
import { errorSchema } from "../organizer/schemas.ts";
import type { OrganizerService } from "../organizer/service.ts";
import { TvAccessError } from "../tv-access/errors.ts";
import { type TvAccessService, tvCookieName } from "../tv-access/service.ts";
import { SpotifyError } from "./provider.ts";
import {
  authorizeSchema,
  callbackSchema,
  connectionStatusSchema,
  currentTrackSchema,
  emptyBody,
} from "./schemas.ts";
import type { SpotifyService } from "./service.ts";

export function registerSpotifyRoutes(
  instance: FastifyInstance,
  service: SpotifyService,
  organizer: OrganizerService,
  tv: TvAccessService,
  appOrigin: string,
) {
  const app = instance.withTypeProvider<TypeBoxTypeProvider>();
  const secure = new URL(appOrigin).protocol === "https:";
  const orgCookie = secure
    ? "__Host-blackwood-organizer"
    : "blackwood-organizer-dev";
  const stateCookie = secure
    ? "__Host-blackwood-spotify-state"
    : "blackwood-spotify-state-dev";
  const cookieOptions = {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
  };
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof SpotifyError || error instanceof TvAccessError)
      return reply.code(error.status === 401 ? 401 : 503).send({
        code:
          error instanceof TvAccessError
            ? "TV_UNAUTHENTICATED"
            : "SPOTIFY_UNAVAILABLE",
        message: "Spotify is unavailable.",
      });
    return handleOrganizerError(error, request, reply, () => {});
  });
  app.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const path = request.routeOptions.url;
    if (path === "/api/organizer/spotify/callback") return;
    if (path === "/api/tv/spotify/current") {
      await tv.session(request.cookies[tvCookieName(appOrigin)]);
      return;
    }
    if (
      request.headers["x-organizer-request"] !== "1" ||
      (request.method !== "GET" && request.headers.origin !== appOrigin)
    )
      throw new OrganizerError(403, "REQUEST_NOT_ALLOWED");
    await organizer.prepare(false);
    await organizer.session(request.cookies[orgCookie]);
  });
  const errors = { "4xx": errorSchema, "5xx": errorSchema };
  app.get(
    "/api/organizer/spotify/status",
    { schema: { response: { 200: connectionStatusSchema, ...errors } } },
    () => service.status(),
  );
  app.post(
    "/api/organizer/spotify/authorize",
    {
      bodyLimit: 256,
      schema: {
        body: emptyBody,
        response: { 200: authorizeSchema, ...errors },
      },
    },
    async (request, reply) => {
      const result = await service.begin(request.cookies[orgCookie] ?? "");
      reply.setCookie(stateCookie, result.state, {
        ...cookieOptions,
        maxAge: 600,
      });
      return { url: result.url };
    },
  );
  app.delete(
    "/api/organizer/spotify/connection",
    { schema: { response: { 204: Type.Null(), ...errors } } },
    async (_request, reply) => {
      await service.disconnect();
      return reply.code(204).send(null);
    },
  );
  app.get(
    "/api/organizer/spotify/callback",
    {
      // OAuth codes and state must never enter request/access logs.
      logLevel: "silent",
      schema: { querystring: callbackSchema },
    },
    async (request, reply) => {
      let result: "connected" | "denied" | "error" = "error";
      try {
        result = await service.finish(
          request.query.state ?? "",
          request.cookies[stateCookie],
          request.query.code,
          !!request.query.error,
        );
      } catch {
        /* Redirect with a fixed status, never provider diagnostics. */
      }
      reply.clearCookie(stateCookie, cookieOptions);
      return reply.redirect(`/organisateur/coffre?spotify=${result}`);
    },
  );
  app.get(
    "/api/tv/spotify/current",
    { schema: { response: { 200: currentTrackSchema, ...errors } } },
    async () => ({ track: await service.current() }),
  );
}
