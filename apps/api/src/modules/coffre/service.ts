import { createHash } from "node:crypto";
import type { MediaService } from "../media/service.ts";
import { CoffreError } from "./errors.ts";
import {
  type CoffreActor,
  type CoffreRepository,
  isRevealed,
  pageSize,
} from "./repository.ts";
import type { ContributionInput } from "./schemas.ts";

function page<T extends { id: string }>(rows: T[]) {
  const contributions = rows.slice(0, pageSize);
  return {
    contributions,
    nextCursor:
      rows.length > pageSize ? (contributions.at(-1)?.id ?? null) : null,
  };
}
function withAuthor<
  T extends { authorProfileId: string | null; firstName: string | null },
>(row: T) {
  const { authorProfileId, firstName, ...rest } = row;
  return {
    ...rest,
    author:
      authorProfileId && firstName
        ? { profileId: authorProfileId, firstName }
        : null,
  };
}
export function normalizeContribution(
  input: ContributionInput,
  hasPhoto: boolean,
) {
  if (input.text !== undefined && [...input.text].length > 500)
    throw new CoffreError(400, "TEXT_TOO_LONG");
  const text = input.text?.trim() || null;
  if (!text && !hasPhoto) throw new CoffreError(400, "CONTRIBUTION_EMPTY");
  if (hasPhoto && input.frameId === "one-wish-willow")
    throw new CoffreError(400, "FRAME_CONTENT_MISMATCH");
  return text;
}
export function createCoffreService(
  repository: CoffreRepository,
  media: Pick<MediaService, "discardPhoto" | "collectGarbage">,
) {
  async function state() {
    const { coffre, now } = await repository.state();
    return {
      state: !coffre
        ? ("unprepared" as const)
        : !coffre.startedAt
          ? ("prepared" as const)
          : isRevealed(coffre, now)
            ? ("revealed" as const)
            : ("collecting" as const),
      serverNow: now.toISOString(),
      durationSeconds: coffre?.durationSeconds ?? null,
      startedAt: coffre?.startedAt?.toISOString() ?? null,
      deadline: coffre?.deadline?.toISOString() ?? null,
    };
  }
  return {
    state,
    async prepare(durationSeconds: number) {
      await repository.prepare(durationSeconds);
      return state();
    },
    async start() {
      await repository.start();
      return state();
    },
    async advance(value: string) {
      const deadline = new Date(value);
      if (!Number.isFinite(deadline.getTime()))
        throw new CoffreError(400, "COFFRE_INVALID_DEADLINE");
      await repository.advance(deadline);
      return state();
    },
    async open() {
      await repository.open();
      return state();
    },
    async deposit(
      input: ContributionInput,
      actor: CoffreActor,
      photo?: { id: string; hash: string },
    ) {
      let attached = false;
      try {
        const text = normalizeContribution(input, Boolean(photo));
        const requestHash = createHash("sha256")
          .update(
            JSON.stringify({
              text,
              visibility: input.visibility,
              frameId: input.frameId,
              photoHash: photo?.hash ?? null,
            }),
          )
          .digest("hex");
        const result = await repository.deposit(
          { ...input, id: input.id.toLowerCase() },
          text,
          requestHash,
          photo?.id ?? null,
          actor,
        );
        attached = !result.replayed;
        // A receipt never echoes content or grants an individual read URL.
        return { id: input.id.toLowerCase(), received: true as const };
      } finally {
        if (photo && !attached) await media.discardPhoto(photo.id);
      }
    },
    async publicPage(after?: string) {
      if ((await state()).state !== "revealed")
        throw new CoffreError(409, "COFFRE_NOT_REVEALED");
      return page(
        (await repository.publicPage(after)).map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
        })),
      );
    },
    async metadataPage(after?: string, visibility?: "public" | "private") {
      return page(
        (await repository.metadataPage(after, visibility)).map((row) =>
          withAuthor({ ...row, createdAt: row.createdAt.toISOString() }),
        ),
      );
    },
    async detail(id: string) {
      const row = await repository.detail(id);
      return withAuthor({ ...row, createdAt: row.createdAt.toISOString() });
    },
    async remove(id: string) {
      await repository.remove(id);
      // Access is revoked transactionally; disk cleanup can be retried by the media worker.
      await media.collectGarbage().catch(() => {});
    },
  };
}
export type CoffreService = ReturnType<typeof createCoffreService>;
