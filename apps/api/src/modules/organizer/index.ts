import cookie from "@fastify/cookie";
import type { FastifyPluginAsync } from "fastify";
import type { createDatabase } from "../../db/client.ts";
import { createOrganizerRepository } from "./repository.ts";
import { registerOrganizerRoutes } from "./routes.ts";
import { createOrganizerService } from "./service.ts";

export const organizerModule: FastifyPluginAsync<{
  db: ReturnType<typeof createDatabase>["db"];
  appOrigin: string;
  passwordHash: string | undefined;
}> = async (app, { db, appOrigin, passwordHash }) => {
  await app.register(cookie);
  const service = createOrganizerService(
    createOrganizerRepository(db),
    passwordHash,
  );
  registerOrganizerRoutes(app, service, appOrigin);
};
