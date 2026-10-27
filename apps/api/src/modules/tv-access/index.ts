import cookie from "@fastify/cookie";
import type { FastifyPluginAsync } from "fastify";
import type { createDatabase } from "../../db/client.ts";
import { createOrganizerRepository } from "../organizer/repository.ts";
import { createOrganizerService } from "../organizer/service.ts";
import { createTvAccessRepository } from "./repository.ts";
import { registerTvAccessRoutes } from "./routes.ts";
import { createTvAccessService } from "./service.ts";

export const tvAccessModule: FastifyPluginAsync<{
  db: ReturnType<typeof createDatabase>["db"];
  appOrigin: string;
  passwordHash: string | undefined;
}> = async (app, options) => {
  await app.register(cookie);
  registerTvAccessRoutes(
    app,
    createTvAccessService(createTvAccessRepository(options.db)),
    createOrganizerService(
      createOrganizerRepository(options.db),
      options.passwordHash,
    ),
    options.appOrigin,
  );
};
