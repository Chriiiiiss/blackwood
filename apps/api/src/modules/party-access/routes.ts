import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyInstance } from "fastify";
import { partyAccessSchema } from "./schemas.ts";
import type { PartyAccessService } from "./service.ts";
export function registerPartyAccessRoutes(
  instance: FastifyInstance,
  service: PartyAccessService,
) {
  instance.withTypeProvider<TypeBoxTypeProvider>().get(
    "/api/party-access",
    {
      schema: { response: { 200: partyAccessSchema } },
    },
    (_request, reply) => {
      reply.header("Cache-Control", "no-store");
      return service.state();
    },
  );
}
