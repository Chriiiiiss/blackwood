import { Type, type TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyInstance } from "fastify";
import { handleProfileError, ProfileError } from "../profiles/errors.ts";
import {
  codeProfileParams,
  codeProfilesSchema,
  hubSettingsSchema,
  issuedCodeSchema,
} from "../profiles/schemas.ts";
import type { ProfileService } from "../profiles/service.ts";
import { handleOrganizerError, OrganizerError } from "./errors.ts";
import { passwordWithinLimits } from "./password.ts";
import {
  errorSchema,
  loginSchema,
  responsesSchema,
  sessionSchema,
} from "./schemas.ts";
import { type OrganizerService, sessionLifetime } from "./service.ts";

export function registerOrganizerRoutes(
  app: FastifyInstance,
  service: OrganizerService,
  appOrigin: string,
  profiles: Pick<
    ProfileService,
    "codeProfiles" | "issueCode" | "disableAccess"
  >,
) {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();
  const secure = new URL(appOrigin).protocol === "https:";
  const cookieName = secure
    ? "__Host-blackwood-organizer"
    : "blackwood-organizer-dev";
  const cookieOptions = {
    path: "/",
    httpOnly: true,
    sameSite: "strict" as const,
    secure,
  };
  typed.setErrorHandler((error, request, reply) => {
    if (error instanceof ProfileError)
      return handleProfileError(error, request, reply);
    return handleOrganizerError(error, request, reply, () => {
      reply.clearCookie(cookieName, cookieOptions);
    });
  });
  typed.addHook("onRequest", async (request) => {
    const isLogin =
      request.method === "POST" &&
      request.url.split("?")[0] === "/api/organizer/session";
    if (
      request.headers["x-organizer-request"] !== "1" ||
      (request.method !== "GET" &&
        request.method !== "HEAD" &&
        request.headers.origin !== appOrigin)
    ) {
      throw new OrganizerError(403, "REQUEST_NOT_ALLOWED");
    }
    await service.prepare(isLogin);
    if (
      (isLogin || request.method === "PUT") &&
      !/^application\/json(?:\s*;.*)?$/i.test(
        request.headers["content-type"] ?? "",
      )
    )
      throw new OrganizerError(415, "UNSUPPORTED_MEDIA_TYPE");
  });
  const errors = { "4xx": errorSchema, "5xx": errorSchema };
  typed.get(
    "/api/organizer/profile-access",
    { schema: { response: { 200: codeProfilesSchema, ...errors } } },
    async (request) => {
      await service.session(request.cookies[cookieName]);
      return profiles.codeProfiles();
    },
  );
  typed.post(
    "/api/organizer/profiles/:profileId/code",
    {
      schema: {
        params: codeProfileParams,
        response: { 200: issuedCodeSchema, ...errors },
      },
    },
    async (request) => {
      await service.session(request.cookies[cookieName]);
      return profiles.issueCode(request.params.profileId);
    },
  );
  typed.delete(
    "/api/organizer/profiles/:profileId/code",
    {
      schema: {
        params: codeProfileParams,
        response: { 204: Type.Null(), ...errors },
      },
    },
    async (request, reply) => {
      await service.session(request.cookies[cookieName]);
      await profiles.disableAccess(request.params.profileId);
      return reply.code(204).send(null);
    },
  );
  typed.get(
    "/api/organizer/hub-settings",
    { schema: { response: { 200: hubSettingsSchema, ...errors } } },
    async (request) => {
      await service.session(request.cookies[cookieName]);
      return service.hubSettings();
    },
  );
  typed.put(
    "/api/organizer/hub-settings",
    {
      bodyLimit: 2048,
      schema: {
        body: hubSettingsSchema,
        response: { 200: hubSettingsSchema, ...errors },
      },
    },
    async (request) => {
      await service.session(request.cookies[cookieName]);
      return service.saveHubSettings(request.body.hubEnabled);
    },
  );
  typed.post(
    "/api/organizer/session",
    {
      bodyLimit: 2048,
      schema: {
        body: loginSchema,
        response: { 200: sessionSchema, ...errors },
      },
    },
    async (request, reply) => {
      if (!passwordWithinLimits(request.body.password))
        throw new OrganizerError(400, "VALIDATION_ERROR");
      const { token, info } = await service.login(
        request.body.password,
        request.cookies[cookieName],
      );
      reply.setCookie(cookieName, token, {
        ...cookieOptions,
        maxAge: sessionLifetime,
      });
      return info;
    },
  );
  typed.get(
    "/api/organizer/session",
    { schema: { response: { 200: sessionSchema, ...errors } } },
    async (request) => service.session(request.cookies[cookieName]),
  );
  typed.delete("/api/organizer/session", async (request, reply) => {
    await service.logout(request.cookies[cookieName]);
    reply.clearCookie(cookieName, cookieOptions);
    return reply.code(204).send();
  });
  typed.get(
    "/api/organizer/invitation-responses",
    { schema: { response: { 200: responsesSchema, ...errors } } },
    async (request) => {
      await service.session(request.cookies[cookieName]);
      return service.responses();
    },
  );
}
