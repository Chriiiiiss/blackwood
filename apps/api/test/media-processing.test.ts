import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import { MediaError } from "../src/modules/media/errors.ts";
import { mediaLimits } from "../src/modules/media/limits.ts";
import { processImage } from "../src/modules/media/processor.ts";
import { animatedPngFixture, imageFixture } from "./helpers/media.ts";

test("the processing deadline terminates the worker before reporting timeout", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "blackwood-timeout-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = processImage(
    join(root, "input"),
    join(root, "output"),
    "photo",
  );
  t.mock.timers.tick(mediaLimits.processingMs);
  await assert.rejects(
    pending,
    (error: unknown) =>
      error instanceof MediaError && error.code === "MEDIA_PROCESSING_TIMEOUT",
  );
});

test("the image worker normalizes orientation, crops and strips metadata", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "blackwood-image-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = join(root, "source");
  await sharp(await imageFixture())
    .withMetadata({ orientation: 6 })
    .withExifMerge({ IFD0: { Make: "Synthetic camera" } })
    .toFile(input);
  const photo = await processImage(input, join(root, "photo"), "photo");
  assert.deepEqual([photo.width, photo.height], [800, 1200]);
  assert.deepEqual([photo.thumbnailWidth, photo.thumbnailHeight], [320, 480]);
  const avatar = await processImage(input, join(root, "avatar"), "avatar", {
    left: 0.25,
    top: 0.1,
    size: 0.5,
  });
  assert.deepEqual([avatar.width, avatar.height], [512, 512]);
  for (const file of [
    "photo/image.jpg",
    "photo/thumbnail.jpg",
    "avatar/image.jpg",
  ]) {
    const metadata = await sharp(await readFile(join(root, file))).metadata();
    assert.equal(metadata.format, "jpeg");
    assert.equal(metadata.space, "srgb");
    for (const key of ["exif", "xmp", "iptc", "icc", "orientation"] as const)
      assert.equal(metadata[key], undefined, key);
  }
  assert.deepEqual(await readdir(join(root, "photo")), [
    "image.jpg",
    "thumbnail.jpg",
  ]);
  await assert.rejects(
    processImage(input, join(root, "bad-crop"), "avatar", {
      left: 0.9,
      top: 0.9,
      size: 1,
    }),
    (error: unknown) =>
      error instanceof MediaError && error.code === "INVALID_CROP",
  );
});

test("the image worker accepts PNG/WebP and rejects disguised, animated and oversized images", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "blackwood-formats-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const format of ["png", "webp"] as const) {
    const input = join(root, format);
    await writeFile(input, await imageFixture(format));
    const result = await processImage(
      input,
      join(root, `${format}-out`),
      "photo",
    );
    assert.deepEqual([result.width, result.height], [1200, 800]);
  }
  const transparent = join(root, "transparent");
  await sharp({
    create: {
      width: 1,
      height: 1,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .png()
    .toFile(transparent);
  await processImage(transparent, join(root, "white"), "photo");
  assert.deepEqual(
    [...(await sharp(join(root, "white/image.jpg")).raw().toBuffer())],
    [255, 255, 255],
  );
  const animation = await sharp(Buffer.from([255, 0, 0, 255, 0, 0, 255, 255]), {
    raw: { width: 1, height: 2, channels: 4, pageHeight: 1 },
  })
    .webp({ loop: 0, delay: [100, 100] })
    .toBuffer();
  assert.equal(
    (await sharp(animation, { animated: true }).metadata()).pages,
    2,
  );
  const invalid = [
    ["animation.png", animatedPngFixture(), "UNSUPPORTED_IMAGE"],
    ["fake.jpg", Buffer.from("not an image"), "INVALID_IMAGE"],
    [
      "vector.jpg",
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
      ),
      "UNSUPPORTED_IMAGE",
    ],
    ["animation.webp", animation, "UNSUPPORTED_IMAGE"],
    [
      "large-side.png",
      await sharp({
        create: { width: 12001, height: 1, channels: 3, background: "red" },
      })
        .png()
        .toBuffer(),
      "IMAGE_DIMENSIONS_EXCEEDED",
    ],
    [
      "large-area.png",
      await sharp({
        create: { width: 8000, height: 8000, channels: 3, background: "red" },
      })
        .png()
        .toBuffer(),
      "IMAGE_DIMENSIONS_EXCEEDED",
    ],
  ] as const;
  for (const [filename, data, code] of invalid) {
    const input = join(root, filename);
    await writeFile(input, data);
    await assert.rejects(
      processImage(input, join(root, `${filename}-out`), "photo"),
      (error: unknown) => error instanceof MediaError && error.code === code,
      filename,
    );
  }
});
