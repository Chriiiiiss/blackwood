import cookie from "@fastify/cookie";
import type { FastifyPluginAsync } from "fastify";
import type { createDatabase } from "../../db/client.ts";
import { createOrganizerRepository } from "../organizer/repository.ts";
import { createOrganizerService } from "../organizer/service.ts";
import { createTvAccessRepository } from "../tv-access/repository.ts";
import { createTvAccessService } from "../tv-access/service.ts";
import { createSpotifyProvider, type SpotifyConfig } from "./provider.ts";
import { createSpotifyRepository } from "./repository.ts";
import { registerSpotifyRoutes } from "./routes.ts";
import { createSpotifyService } from "./service.ts";
export const spotifyModule: FastifyPluginAsync<{
  db: ReturnType<typeof createDatabase>["db"];
  appOrigin: string;
  passwordHash: string | undefined;
  spotify: SpotifyConfig | undefined;
  http: typeof fetch;
  clock: () => Date;
}> = async (app, options) => {
  await app.register(cookie);
  const org = createOrganizerRepository(options.db);
  registerSpotifyRoutes(
    app,
    createSpotifyService(
      createSpotifyRepository(options.db),
      org,
      options.spotify,
      options.passwordHash,
      options.appOrigin,
      options.spotify
        ? createSpotifyProvider(options.spotify, options.http)
        : undefined,
      options.clock,
    ),
    createOrganizerService(org, options.passwordHash),
    createTvAccessService(createTvAccessRepository(options.db)),
    options.appOrigin,
  );
};
