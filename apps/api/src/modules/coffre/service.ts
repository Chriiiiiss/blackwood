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
  function stateResponse(
    coffre: {
      id: number;
      name: string | null;
      durationSeconds: number;
      startedAt: Date | null;
      deadline: Date | null;
    } | null,
    now: Date,
  ) {
    return {
      id: coffre?.id ?? null,
      name: coffre?.name ?? null,
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
  async function state(coffreId?: number) {
    const { coffre, now } = await repository.state(coffreId);
    return stateResponse(coffre, now);
  }
  return {
    state,
    async guestState(coffreId?: number) {
      const latest = await state();
      if (coffreId !== undefined && latest.id !== coffreId)
        throw new CoffreError(404, "COFFRE_NOT_FOUND");
      return latest;
    },
    async history(before?: number) {
      const rows = await repository.history(before);
      const items = rows.slice(0, pageSize);
      return {
        coffres: items.map((row) => stateResponse(row, row.now)),
        nextCursor: rows.length > pageSize ? (items.at(-1)?.id ?? null) : null,
      };
    },
    async createNext(previousCoffreId: number) {
      return state(await repository.createNext(previousCoffreId));
    },
    async rename(value: string, coffreId = 1) {
      const name = value.trim();
      if (!name || [...name].length > 80)
        throw new CoffreError(400, "COFFRE_INVALID_NAME");
      await repository.rename(name, coffreId);
      return state(coffreId);
    },
    async prepare(durationSeconds: number, coffreId = 1) {
      await repository.prepare(durationSeconds, coffreId);
      return state(coffreId);
    },
    async start(coffreId = 1) {
      await repository.start(coffreId);
      return state(coffreId);
    },
    async advance(value: string, coffreId = 1) {
      const deadline = new Date(value);
      if (!Number.isFinite(deadline.getTime()))
        throw new CoffreError(400, "COFFRE_INVALID_DEADLINE");
      await repository.advance(deadline, coffreId);
      return state(coffreId);
    },
    async open(coffreId = 1) {
      await repository.open(coffreId);
      return state(coffreId);
    },
    async deposit(
      input: ContributionInput,
      actor: CoffreActor,
      photo?: { id: string; hash: string },
      coffreId = 1,
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
          coffreId,
        );
        attached = !result.replayed;
        // A receipt never echoes content or grants an individual read URL.
        return { id: input.id.toLowerCase(), received: true as const };
      } finally {
        if (photo && !attached) await media.discardPhoto(photo.id);
      }
    },
    async publicPage(after?: string, coffreId = 1) {
      const latest = await state();
      if (latest.id !== null && latest.id !== coffreId)
        throw new CoffreError(404, "COFFRE_NOT_FOUND");
      if (latest.state !== "revealed")
        throw new CoffreError(409, "COFFRE_NOT_REVEALED");
      return page(
        (await repository.publicPage(after, coffreId)).map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
        })),
      );
    },
    async metadataPage(
      after?: string,
      visibility?: "public" | "private",
      coffreId = 1,
    ) {
      return page(
        (await repository.metadataPage(after, visibility, coffreId)).map(
          (row) =>
            withAuthor({ ...row, createdAt: row.createdAt.toISOString() }),
        ),
      );
    },
    async detail(id: string, coffreId = 1) {
      const row = await repository.detail(id, coffreId);
      return withAuthor({ ...row, createdAt: row.createdAt.toISOString() });
    },
    async remove(id: string, coffreId = 1) {
      await repository.remove(id, coffreId);
      // Access is revoked transactionally; disk cleanup can be retried by the media worker.
      await media.collectGarbage().catch(() => {});
    },
  };
}
export type CoffreService = ReturnType<typeof createCoffreService>;
