import { Type, type TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyServerOptions } from "fastify";
import type { Config } from "./config/env.ts";
import { createDatabase } from "./db/client.ts";

export function buildApp(
  config: Config,
  options: FastifyServerOptions = { logger: true },
) {
  const app = Fastify(options).withTypeProvider<TypeBoxTypeProvider>();
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

  return app;
}
