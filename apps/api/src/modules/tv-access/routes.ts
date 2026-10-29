import { Type, type TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyInstance } from "fastify";
import type { OrganizerService } from "../organizer/service.ts";
import { handleTvAccessError, TvAccessError } from "./errors.ts";
import {
  pairingSchema,
  sessionSchema,
  tvErrors,
  tvLoginSchema,
} from "./schemas.ts";
import {
  type TvAccessService,
  tvCookieName,
  tvSessionLifetime,
} from "./service.ts";

export function registerTvAccessRoutes(
  instance: FastifyInstance,
  service: TvAccessService,
  organizer: Pick<OrganizerService, "session">,
  appOrigin: string,
) {
  const app = instance.withTypeProvider<TypeBoxTypeProvider>();
  const secure = new URL(appOrigin).protocol === "https:";
  const name = tvCookieName(appOrigin);
  app.setErrorHandler(handleTvAccessError);
  app.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    reply.header("Vary", "Cookie, Origin, Sec-Fetch-Site");
    const administrative =
      request.routeOptions.url?.startsWith("/api/organizer/");
    if (
      request.headers.origin !== appOrigin ||
      request.headers[
        administrative ? "x-organizer-request" : "x-tv-request"
      ] !== "1"
    )
      throw new TvAccessError(403, "REQUEST_NOT_ALLOWED");
    if (administrative)
      await organizer.session(
        request.cookies[
          secure ? "__Host-blackwood-organizer" : "blackwood-organizer-dev"
        ],
      );
  });
  app.post(
    "/api/organizer/tv/pairing",
    {
      bodyLimit: 256,
      schema: {
        body: Type.Object({}, { additionalProperties: false }),
        response: { 200: pairingSchema, ...tvErrors },
      },
    },
    () => service.issue(),
  );
  app.post(
    "/api/tv/session",
    {
      bodyLimit: 256,
      schema: {
        body: tvLoginSchema,
        response: { 200: sessionSchema, ...tvErrors },
      },
    },
    async (request, reply) => {
      const { token, expiresAt } = await service.login(
        request.body.code,
        request.cookies[name],
      );
      reply.setCookie(name, token, {
        path: "/",
        httpOnly: true,
        sameSite: "strict",
        secure,
        maxAge: tvSessionLifetime,
      });
      return { expiresAt };
    },
  );
}
