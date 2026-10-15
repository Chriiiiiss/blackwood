import { createReadStream } from "node:fs";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { MediaError } from "./errors.ts";

export function createMediaStorage(root: string) {
  function folder(id: string) {
    if (
      !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(
        id,
      )
    )
      throw new MediaError(404, "MEDIA_NOT_FOUND");
    return join(root, id);
  }
  return {
    async initialize() {
      await mkdir(join(root, ".tmp"), { recursive: true, mode: 0o700 });
    },
    async begin(id: string) {
      folder(id);
      const temporary = join(root, ".tmp", id);
      await mkdir(temporary, { mode: 0o700 });
      const output = join(temporary, "output");
      await mkdir(output, { mode: 0o700 });
      return { temporary, input: join(temporary, "input"), output };
    },
    async publish(id: string, output: string) {
      const destination = folder(id);
      await mkdir(destination, { mode: 0o700 });
      for (const file of await readdir(output)) {
        if (file === "image.jpg" || file === "thumbnail.jpg")
          await rename(join(output, file), join(destination, file));
      }
    },
    async removeTemporary(id: string) {
      folder(id);
      await rm(join(root, ".tmp", id), { force: true, recursive: true });
    },
    async remove(id: string) {
      await rm(folder(id), { force: true, recursive: true });
      await rm(join(root, ".tmp", id), { force: true, recursive: true });
    },
    stream(id: string, variant: "image" | "thumbnail") {
      return createReadStream(join(folder(id), `${variant}.jpg`));
    },
  };
}
export type MediaStorage = ReturnType<typeof createMediaStorage>;
