import type { FastifyPluginAsync } from "fastify";
import { registerPartyAccessRoutes } from "./routes.ts";
import type { PartyAccessService } from "./service.ts";
export const partyAccessModule: FastifyPluginAsync<{
  service: PartyAccessService;
}> = async (app, options) => {
  registerPartyAccessRoutes(app, options.service);
};
