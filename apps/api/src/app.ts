import { Type, type TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyServerOptions } from "fastify";
import type { Config } from "./config/env.ts";
import { createDatabase } from "./db/client.ts";
import { invitationModule } from "./modules/invitations/index.ts";
import { mediaModule } from "./modules/media/index.ts";
import { organizerModule } from "./modules/organizer/index.ts";
import { profileModule } from "./modules/profiles/index.ts";

export function buildApp(
  config: Pick<
    Config,
    "databaseUrl" | "appOrigin" | "organizerPasswordHash" | "mediaRoot"
  >,
  options: FastifyServerOptions = { logger: true },
) {
  const app = Fastify({
    ...options,
    requestTimeout: 65_000,
    logger:
      options.logger === false
        ? false
        : {
            ...(typeof options.logger === "object" ? options.logger : {}),
            redact: [
              "req.headers.cookie",
              "req.headers.authorization",
              "res.headers['set-cookie']",
              "password",
              "body.password",
              "token",
              "passwordHash",
              "organizerPasswordHash",
              "responseId",
              "body.responseId",
              "body.token",
            ],
          },
    ajv: {
      customOptions: {
        coerceTypes: false,
        removeAdditional: false,
      },
    },
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.addHook("onRequest", async (request, reply) => {
    if (
      /^\/api\/(?:organizer|guest-access|profiles|companion-invitations|media)(?:\/|$)/.test(
        request.url.split("?")[0] ?? "",
      )
    )
      reply.header("Cache-Control", "no-store");
    reply.header("Vary", "Origin, Sec-Fetch-Site");
    const origin = request.headers.origin;
    const site = request.headers["sec-fetch-site"];
    if (
      (origin !== undefined && origin !== config.appOrigin) ||
      (site !== undefined && site !== "same-origin" && site !== "none")
    ) {
      return reply.code(403).send({
        code: "ORIGIN_NOT_ALLOWED",
        message: "Requests from this origin are not allowed.",
      });
    }
  });

  const { db, pool } = createDatabase(config.databaseUrl);

  pool.on("error", (error) => {
    app.log.error({ err: error }, "PostgreSQL error on an idle connection.");
  });
  app.addHook("onClose", async () => {
    await pool.end();
  });
  app.addHook("onReady", async () => {
    await db.execute(sql`select 1`);
  });

  app.get(
    "/api/health",
    {
      schema: {
        response: {
          200: Type.Object({ status: Type.Literal("ok") }),
          503: Type.Object({ status: Type.Literal("unavailable") }),
        },
      },
    },
    async (_request, reply) => {
      try {
        await db.execute(sql`select 1`);
        return { status: "ok" as const };
      } catch (error) {
        app.log.error({ err: error }, "PostgreSQL is unavailable.");
        return reply.code(503).send({ status: "unavailable" });
      }
    },
  );

  app.register(invitationModule, { db });
  app.register(profileModule, { db, appOrigin: config.appOrigin });
  app.register(mediaModule, {
    db,
    appOrigin: config.appOrigin,
    passwordHash: config.organizerPasswordHash,
    ...(config.mediaRoot ? { root: config.mediaRoot } : {}),
  });
  app.register(organizerModule, {
    db,
    appOrigin: config.appOrigin,
    passwordHash: config.organizerPasswordHash,
  });

  return app;
}
