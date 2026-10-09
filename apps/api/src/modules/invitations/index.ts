import type { FastifyPluginAsync } from "fastify";
import type { createDatabase } from "../../db/client.ts";
import { createInvitationRepository } from "./repository.ts";
import { registerInvitationRoutes } from "./routes.ts";
import { createInvitationService } from "./service.ts";

export const invitationModule: FastifyPluginAsync<{
  db: ReturnType<typeof createDatabase>["db"];
}> = async (app, { db }) => {
  const repository = createInvitationRepository(db);
  const service = createInvitationService(repository);

  registerInvitationRoutes(app, service);
};
