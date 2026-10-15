import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import type { FastifyPluginAsync } from "fastify";
import type { createDatabase } from "../../db/client.ts";
import { createOrganizerRepository } from "../organizer/repository.ts";
import { createOrganizerService } from "../organizer/service.ts";
import { createProfileRepository } from "../profiles/repository.ts";
import { createProfileService } from "../profiles/service.ts";
import { mediaLimits } from "./limits.ts";
import type { ContributionMediaContext } from "./policy.ts";
import { createMediaRepository } from "./repository.ts";
import { registerMediaRoutes } from "./routes.ts";
import { createMediaService } from "./service.ts";
import { createMediaStorage } from "./storage.ts";

export interface MediaModuleOptions {
  db: ReturnType<typeof createDatabase>["db"];
  appOrigin: string;
  passwordHash: string | undefined;
  root?: string;
  // ENG-47 supplies authoritative visibility/deadline context. Missing integration denies access.
  contributionContext?: (
    id: string,
  ) => Promise<ContributionMediaContext | null>;
}
export const mediaModule: FastifyPluginAsync<MediaModuleOptions> = async (
  app,
  options,
) => {
  await app.register(cookie);
  await app.register(multipart, {
    limits: {
      files: 1,
      fields: 1,
      parts: 2,
      fileSize: mediaLimits.fileBytes,
      fieldSize: 512,
      fieldNameSize: 32,
      headerPairs: 64,
    },
  });
  const service = createMediaService(
    createMediaRepository(options.db),
    createMediaStorage(
      options.root ??
        fileURLToPath(new URL("../../../../../.media/", import.meta.url)),
    ),
    options.contributionContext,
  );
  let timer: ReturnType<typeof setInterval> | undefined;
  app.addHook("onReady", async () => {
    await service.initialize();
    // Only abandoned uploads and explicitly replaced/deleted files; never retention purges.
    await service.collectGarbage();
    timer = setInterval(
      () =>
        void service
          .collectGarbage()
          .catch(() => app.log.error("Media cleanup deferred.")),
      60_000,
    );
    timer.unref();
  });
  app.addHook("onClose", async () => {
    clearInterval(timer);
  });
  registerMediaRoutes(
    app,
    service,
    createProfileService(createProfileRepository(options.db)),
    createOrganizerService(
      createOrganizerRepository(options.db),
      options.passwordHash,
    ),
    options.appOrigin,
  );
};
