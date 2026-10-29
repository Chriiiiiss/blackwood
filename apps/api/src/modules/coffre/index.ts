import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import type { FastifyPluginAsync } from "fastify";
import type { createDatabase } from "../../db/client.ts";
import { createMediaModuleService, mediaModule } from "../media/index.ts";
import { mediaLimits } from "../media/limits.ts";
import { createMediaRepository } from "../media/repository.ts";
import { createOrganizerRepository } from "../organizer/repository.ts";
import { createOrganizerService } from "../organizer/service.ts";
import { createProfileRepository } from "../profiles/repository.ts";
import { createProfileService } from "../profiles/service.ts";
import { createTvAccessRepository } from "../tv-access/repository.ts";
import { createTvAccessService } from "../tv-access/service.ts";
import { createCoffreRepository } from "./repository.ts";
import { registerCoffreRoutes } from "./routes.ts";
import { createCoffreService } from "./service.ts";

export const coffreModule: FastifyPluginAsync<{
  db: ReturnType<typeof createDatabase>["db"];
  appOrigin: string;
  passwordHash: string | undefined;
  root?: string;
}> = async (app, options) => {
  const repository = createCoffreRepository(
    options.db,
    createMediaRepository(options.db),
  );
  const media = createMediaModuleService({
    ...options,
    contributionContext: repository.mediaContext,
  });
  // One media service owns processing limits, storage and cleanup for avatars and deposits.
  await app.register(mediaModule, { ...options, service: media });
  await app.register(async (routes) => {
    await routes.register(cookie);
    await routes.register(multipart, {
      limits: {
        files: 1,
        fields: 1,
        parts: 2,
        fileSize: mediaLimits.fileBytes,
        fieldSize: 4096,
        fieldNameSize: 32,
        headerPairs: 64,
      },
    });
    registerCoffreRoutes(
      routes,
      createCoffreService(repository, media),
      media,
      createProfileService(createProfileRepository(options.db)),
      createOrganizerService(
        createOrganizerRepository(options.db),
        options.passwordHash,
      ),
      options.appOrigin,
      createTvAccessService(createTvAccessRepository(options.db)),
    );
  });
};
