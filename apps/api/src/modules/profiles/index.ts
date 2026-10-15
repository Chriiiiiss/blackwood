import cookie from "@fastify/cookie";
import type { FastifyPluginAsync } from "fastify";
import type { createDatabase } from "../../db/client.ts";
import { createProfileRepository } from "./repository.ts";
import { registerProfileRoutes } from "./routes.ts";
import { createProfileService } from "./service.ts";

export const profileModule: FastifyPluginAsync<{
  db: ReturnType<typeof createDatabase>["db"];
  appOrigin: string;
}> = async (app, { db, appOrigin }) => {
  await app.register(cookie);
  registerProfileRoutes(
    app,
    createProfileService(createProfileRepository(db)),
    appOrigin,
  );
};
