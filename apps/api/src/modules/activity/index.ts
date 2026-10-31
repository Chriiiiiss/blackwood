import cookie from "@fastify/cookie";
import type { FastifyPluginAsync } from "fastify";
import type { createDatabase } from "../../db/client.ts";
import { createOrganizerRepository } from "../organizer/repository.ts";
import { createOrganizerService } from "../organizer/service.ts";
import { createProfileRepository } from "../profiles/repository.ts";
import { createProfileService } from "../profiles/service.ts";
import { createActivityRepository } from "./repository.ts";
import { registerActivityRoutes } from "./routes.ts";
import { createActivityService } from "./service.ts";

export const activityModule: FastifyPluginAsync<{
  db: ReturnType<typeof createDatabase>["db"];
  appOrigin: string;
  passwordHash: string | undefined;
}> = async (app, { db, appOrigin, passwordHash }) => {
  await app.register(cookie);
  const activity = createActivityService(
    createActivityRepository(db),
    createProfileService(createProfileRepository(db)),
  );
  registerActivityRoutes(
    app,
    activity,
    createOrganizerService(createOrganizerRepository(db), passwordHash),
    appOrigin,
  );
};
