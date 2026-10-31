import cookie from "@fastify/cookie";
import type { FastifyPluginAsync } from "fastify";
import type { createDatabase } from "../../db/client.ts";
import { createOrganizerRepository } from "../organizer/repository.ts";
import { createOrganizerService } from "../organizer/service.ts";
import { createProfileRepository } from "../profiles/repository.ts";
import { createProfileService } from "../profiles/service.ts";
import { createTvAccessRepository } from "../tv-access/repository.ts";
import { createTvAccessService } from "../tv-access/service.ts";
import { createMissionRepository } from "./repository.ts";
import { registerMissionRoutes } from "./routes.ts";
import { createMissionService } from "./service.ts";

export const missionModule: FastifyPluginAsync<{
  db: ReturnType<typeof createDatabase>["db"];
  appOrigin: string;
  passwordHash: string | undefined;
}> = async (app, options) => {
  await app.register(cookie);
  registerMissionRoutes(
    app,
    createMissionService(createMissionRepository(options.db)),
    createProfileService(createProfileRepository(options.db)),
    createOrganizerService(
      createOrganizerRepository(options.db),
      options.passwordHash,
    ),
    createTvAccessService(createTvAccessRepository(options.db)),
    options.appOrigin,
  );
};
