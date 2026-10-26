import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { MultipartFile } from "@fastify/multipart";
import { MediaError } from "./errors.ts";
import { mediaLimits } from "./limits.ts";

export async function receiveImageFile(part: MultipartFile, input: string) {
  const hash = createHash("sha256");
  await pipeline(
    part.file,
    new Transform({
      transform(chunk, _encoding, callback) {
        hash.update(chunk);
        callback(null, chunk);
      },
    }),
    createWriteStream(input, { flags: "wx", mode: 0o600 }),
    { signal: AbortSignal.timeout(mediaLimits.uploadMs) },
  );
  if (part.file.truncated) throw new MediaError(413, "MEDIA_TOO_LARGE");
  return hash.digest("hex");
}
