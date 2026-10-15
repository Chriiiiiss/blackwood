import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { MediaError } from "./errors.ts";
import {
  type AvatarCrop,
  type MediaPurpose,
  mediaLimits,
  type ProcessedMedia,
} from "./limits.ts";

export function processImage(
  source: string,
  output: string,
  purpose: MediaPurpose,
  crop?: AvatarCrop,
): Promise<ProcessedMedia> {
  return new Promise((resolve, reject) => {
    const workerPath = fileURLToPath(
      new URL(
        import.meta.url.endsWith(".ts")
          ? "./processor-worker.ts"
          : "./processor-worker.js",
        import.meta.url,
      ),
    );
    const child = fork(
      workerPath,
      [source, output, purpose, ...(crop ? [JSON.stringify(crop)] : [])],
      {
        detached: true,
        execArgv: ["--max-old-space-size=256"],
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        env: {
          PATH: process.env.PATH,
          VIPS_CONCURRENCY: "1",
          MALLOC_ARENA_MAX: "2",
        },
      },
    );
    let result: ProcessedMedia | undefined;
    let failure: MediaError | undefined;
    const timer = setTimeout(() => {
      failure = new MediaError(422, "MEDIA_PROCESSING_TIMEOUT");
      // Kill the worker and its decoder subprocesses before cleaning input files.
      if (child.pid)
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
    }, mediaLimits.processingMs);
    child.on(
      "message",
      (message: { result?: ProcessedMedia; error?: string }) => {
        result = message.result;
        if (message.error)
          failure = new MediaError(
            message.error === "MEDIA_DECODER_UNAVAILABLE" ? 503 : 422,
            message.error,
          );
      },
    );
    child.on("error", () => {
      failure = new MediaError(503, "MEDIA_PROCESSOR_UNAVAILABLE");
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code !== 0 || !result)
        reject(new MediaError(422, "INVALID_IMAGE"));
      else resolve(result);
    });
  });
}
