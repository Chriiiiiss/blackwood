import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyInstance } from "fastify";
import { invitationBodySchema } from "../invitations/schemas.ts";
import { trimInvitationFirstName } from "../invitations/service.ts";
import { handleProfileError, ProfileError } from "./errors.ts";
import {
  accessSchema,
  companionClaimSchema,
  companionInvitationSchema,
  companionStatusSchema,
  currentInvitationSchema,
  guestLoginSchema,
  profileErrors,
  profilePatchSchema,
  profileSchema,
  restoreSchema,
} from "./schemas.ts";
import { guestSessionLifetime, type ProfileService } from "./service.ts";

export function registerProfileRoutes(
  instance: FastifyInstance,
  service: ProfileService,
  appOrigin: string,
) {
  const app = instance.withTypeProvider<TypeBoxTypeProvider>();
  const secure = new URL(appOrigin).protocol === "https:";
  const cookieName = secure ? "__Host-blackwood-guest" : "blackwood-guest-dev";
  const cookieOptions = {
    path: "/",
    httpOnly: true,
    sameSite: "strict" as const,
    secure,
  };
  app.setErrorHandler(handleProfileError);
  app.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (["POST", "PUT", "PATCH"].includes(request.method)) {
      if (
        request.headers.origin !== appOrigin ||
        request.headers["x-guest-request"] !== "1"
      )
        throw new ProfileError(403, "REQUEST_NOT_ALLOWED");
      if (
        request.method !== "POST" ||
        !request.url.startsWith("/api/profiles/me/companion-invitations")
      ) {
        if (
          !/^application\/json(?:\s*;.*)?$/i.test(
            request.headers["content-type"] ?? "",
          )
        )
          throw new ProfileError(415, "INVALID_REQUEST");
      }
    }
  });
  app.get(
    "/api/guest-access",
    { schema: { response: { 200: accessSchema, ...profileErrors } } },
    async (request) => service.access(request.cookies[cookieName]),
  );
  app.post(
    "/api/guest-access/login",
    {
      bodyLimit: 2048,
      schema: {
        body: guestLoginSchema,
        response: { 200: accessSchema, ...profileErrors },
      },
    },
    async (request, reply) => {
      const result = await service.login(
        request.body.code,
        request.cookies[cookieName],
      );
      if (result.token)
        reply.setCookie(cookieName, result.token, {
          ...cookieOptions,
          maxAge: guestSessionLifetime,
        });
      return result.access;
    },
  );
  app.post(
    "/api/guest-access/restore",
    {
      bodyLimit: 2048,
      schema: {
        body: restoreSchema,
        response: { 200: accessSchema, ...profileErrors },
      },
    },
    async (request, reply) => {
      const result = await service.restore(
        request.body.responseId,
        request.cookies[cookieName],
      );
      if (result.token)
        reply.setCookie(cookieName, result.token, {
          ...cookieOptions,
          maxAge: guestSessionLifetime,
        });
      return result.access;
    },
  );
  app.get(
    "/api/profiles/me",
    { schema: { response: { 200: profileSchema, ...profileErrors } } },
    async (request) => service.profile(request.cookies[cookieName]),
  );
  app.patch(
    "/api/profiles/me",
    {
      bodyLimit: 2048,
      preValidation: async (request) => {
        trimInvitationFirstName(request.body);
      },
      schema: {
        body: profilePatchSchema,
        response: { 200: profileSchema, ...profileErrors },
      },
    },
    async (request) =>
      service.patch(request.body.firstName, request.cookies[cookieName]),
  );
  app.get(
    "/api/profiles/me/invitation-response",
    {
      schema: { response: { 200: currentInvitationSchema, ...profileErrors } },
    },
    async (request) => service.invitation(request.cookies[cookieName]),
  );
  app.put(
    "/api/profiles/me/invitation-response",
    {
      bodyLimit: 8192,
      preValidation: async (request) => {
        trimInvitationFirstName(request.body);
      },
      schema: {
        body: invitationBodySchema,
        response: { 200: currentInvitationSchema, ...profileErrors },
      },
    },
    async (request) =>
      service.saveInvitation(request.body, request.cookies[cookieName]),
  );
  app.post(
    "/api/profiles/me/companion-invitations",
    {
      schema: {
        response: { 200: companionInvitationSchema, ...profileErrors },
      },
    },
    async (request) => service.issueCompanion(request.cookies[cookieName]),
  );
  app.get(
    "/api/profiles/me/companion",
    { schema: { response: { 200: companionStatusSchema, ...profileErrors } } },
    async (request) => service.companionStatus(request.cookies[cookieName]),
  );
  app.post(
    "/api/companion-invitations/claim",
    {
      bodyLimit: 2048,
      preValidation: async (request) => {
        trimInvitationFirstName(request.body);
      },
      schema: {
        body: companionClaimSchema,
        response: { 200: accessSchema, ...profileErrors },
      },
    },
    async (request, reply) => {
      const result = await service.claimCompanion(
        request.body,
        request.cookies[cookieName],
      );
      if (result.token)
        reply.setCookie(cookieName, result.token, {
          ...cookieOptions,
          maxAge: guestSessionLifetime,
        });
      return result.access;
    },
  );
}
