import { randomUUID } from "node:crypto";
import { MediaError } from "./errors.ts";
import { type AvatarCrop, type MediaPurpose, mediaLimits } from "./limits.ts";
import {
  type ContributionMediaContext,
  canReadContributionMedia,
  type MediaActor,
} from "./policy.ts";
import { processImage } from "./processor.ts";
import type { MediaRepository } from "./repository.ts";
import type { MediaStorage } from "./storage.ts";

export function createMediaService(
  repository: MediaRepository,
  storage: MediaStorage,
  contributionContext: (
    id: string,
  ) => Promise<ContributionMediaContext | null> = async () => null,
  processor = processImage,
) {
  let busy = false;
  let collecting = false;
  async function removeGarbage(id: string) {
    await storage.remove(id);
    await repository.deleteGarbage(id);
  }
  async function upload(
    owner: string | null,
    purpose: MediaPurpose,
    receive: (input: string) => Promise<AvatarCrop | undefined>,
  ) {
    if (busy) throw new MediaError(429, "MEDIA_BUSY");
    busy = true;
    const id = randomUUID();
    let attached = false;
    try {
      await repository.begin(id, owner, purpose);
      const files = await storage.begin(id);
      const crop = await receive(files.input);
      const result = await processor(files.input, files.output, purpose, crop);
      await storage.publish(id, files.output);
      await repository.stage(id, result);
      if (purpose === "avatar" && owner) {
        const previous = await repository.replaceAvatar(owner, id);
        attached = true;
        if (previous) await removeGarbage(previous).catch(() => {});
      } else attached = true; // Staged photos stay unreadable until a contribution attaches them.
      return { id, ...result };
    } finally {
      try {
        if (!attached && (await repository.discardStaged(id)))
          await removeGarbage(id);
      } finally {
        try {
          await storage.removeTemporary(id);
        } finally {
          busy = false;
        }
      }
    }
  }
  return {
    initialize: () => storage.initialize(),
    uploadAvatar: (
      profileId: string,
      receive: (input: string) => Promise<AvatarCrop | undefined>,
    ) => upload(profileId, "avatar", receive),
    // Internal contract, deliberately not a standalone guest photo-upload endpoint.
    preparePhoto: (
      owner: string | null,
      receive: (input: string) => Promise<undefined>,
    ) => upload(owner, "photo", receive),
    attachPhoto: repository.attachPhoto,
    markPhotoDeleting: repository.markDeleting,
    async discardPhoto(id: string) {
      if (await repository.discardStaged(id)) await removeGarbage(id);
    },
    async deleteAvatar(profileId: string) {
      const previous = await repository.replaceAvatar(profileId, null);
      if (previous) await removeGarbage(previous).catch(() => {});
    },
    async read(
      id: string,
      variant: "image" | "thumbnail",
      actor: MediaActor,
      tv = false,
    ) {
      const asset = await repository.find(id);
      if (asset?.status !== "ready" || actor.kind === "anonymous")
        throw new MediaError(404, "MEDIA_NOT_FOUND");
      if (tv && asset.purpose !== "photo")
        throw new MediaError(404, "MEDIA_NOT_FOUND");
      const allowed =
        asset.purpose === "avatar"
          ? (actor.kind === "organizer" ||
              actor.profileId === asset.ownerProfileId) &&
            (await repository.isCurrentAvatar(asset))
          : canReadContributionMedia(actor, await contributionContext(id), tv);
      if (!allowed || (variant === "thumbnail" && !asset.thumbnailBytes))
        throw new MediaError(404, "MEDIA_NOT_FOUND");
      return {
        stream: storage.stream(id, variant),
        bytes: variant === "image" ? asset.bytes : asset.thumbnailBytes,
      };
    },
    async collectGarbage() {
      if (collecting) return;
      collecting = true;
      try {
        for (const asset of await repository.garbage(
          new Date(Date.now() - mediaLimits.staleMs),
        ))
          await removeGarbage(asset.id);
      } finally {
        collecting = false;
      }
    },
  };
}
export type MediaService = ReturnType<typeof createMediaService>;
