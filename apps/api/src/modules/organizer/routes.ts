import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyInstance } from "fastify";
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
  typed.setErrorHandler((error, request, reply) =>
    handleOrganizerError(error, request, reply, () => {
      reply.clearCookie(cookieName, cookieOptions);
    }),
  );
  typed.addHook("onRequest", async (request) => {
    const isLogin = request.method === "POST";
    if (
      request.headers["x-organizer-request"] !== "1" ||
      ((isLogin || request.method === "DELETE") &&
        request.headers.origin !== appOrigin)
    ) {
      throw new OrganizerError(403, "REQUEST_NOT_ALLOWED");
    }
    await service.prepare(isLogin);
    if (
      isLogin &&
      !/^application\/json(?:\s*;.*)?$/i.test(
        request.headers["content-type"] ?? "",
      )
    )
      throw new OrganizerError(415, "UNSUPPORTED_MEDIA_TYPE");
  });
  const errors = { "4xx": errorSchema, "5xx": errorSchema };
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
