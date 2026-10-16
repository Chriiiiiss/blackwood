import { execFile } from "node:child_process";
import { mkdir, open, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { type AvatarCrop, type MediaPurpose, mediaLimits } from "./limits.ts";

const execute = promisify(execFile);
sharp.cache(false);
sharp.concurrency(1);
const options = {
  limitInputPixels: mediaLimits.pixels,
  failOn: "warning" as const,
};

async function normalize(
  source: string,
  output: string,
  purpose: MediaPurpose,
  crop?: AvatarCrop,
) {
  const handle = await open(source, "r");
  const header = Buffer.alloc(512);
  try {
    await handle.read(header, 0, header.length, 0);
    // libvips may expose only the first APNG frame; inspect its animation control.
    if (
      header
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ) {
      const { size } = await handle.stat();
      const chunk = Buffer.alloc(8);
      for (let position = 8; position + 8 <= size; ) {
        const { bytesRead } = await handle.read(chunk, 0, 8, position);
        if (bytesRead !== 8) throw Error("INVALID_IMAGE");
        const length = chunk.readUInt32BE(0);
        if (position + length + 12 > size) throw Error("INVALID_IMAGE");
        const type = chunk.toString("ascii", 4, 8);
        if (type === "acTL") throw Error("UNSUPPORTED_IMAGE");
        if (type === "IDAT" || type === "IEND") break;
        position += length + 12;
      }
    }
  } finally {
    await handle.close();
  }
  let input = source;
  if (header.toString("ascii", 4, 8) === "ftyp") {
    const boxLength = header.readUInt32BE(0);
    if (boxLength < 16 || boxLength > header.length || boxLength % 4 !== 0)
      throw Error("INVALID_IMAGE");
    const brands = [header.toString("ascii", 8, 12)];
    for (let index = 16; index < boxLength; index += 4)
      brands.push(header.toString("ascii", index, index + 4));
    if (
      brands.some((b) =>
        ["avif", "avis", "msf1", "hevc", "hevx"].includes(b),
      ) ||
      !brands.some((b) => ["heic", "heix", "mif1"].includes(b))
    )
      throw Error("UNSUPPORTED_IMAGE");
    const { stdout } = await execute("heif-info", [source], {
      timeout: 10_000,
      maxBuffer: 64 * 1024,
    });
    const images = [...stdout.matchAll(/^image: (\d+)x(\d+) .*$/gm)];
    if (images.length !== 1) throw Error("UNSUPPORTED_IMAGE");
    const width = Number(images[0]?.[1]);
    const height = Number(images[0]?.[2]);
    if (
      !width ||
      !height ||
      width > mediaLimits.side ||
      height > mediaLimits.side ||
      width * height > mediaLimits.pixels
    )
      throw Error("IMAGE_DIMENSIONS_EXCEEDED");
    input = join(output, "decoded.png");
    // Do not pass --disable-limits or export EXIF/XMP sidecars.
    await execute(
      "heif-dec",
      [
        "--quiet",
        "--codec-threads",
        "1",
        "--tile-threads",
        "1",
        "--png-compression-level",
        "0",
        source,
        input,
      ],
      { timeout: 20_000, maxBuffer: 64 * 1024 },
    );
  }
  const metadata = await sharp(input, options).metadata();
  if (
    !["jpeg", "png", "webp"].includes(metadata.format ?? "") ||
    (metadata.pages ?? 1) > 1 ||
    metadata.delay?.length
  )
    throw Error("UNSUPPORTED_IMAGE");
  const width = metadata.width;
  const height = metadata.height;
  if (
    !width ||
    !height ||
    width > mediaLimits.side ||
    height > mediaLimits.side ||
    width * height > mediaLimits.pixels
  )
    throw Error("IMAGE_DIMENSIONS_EXCEEDED");
  let image = sharp(input, options)
    .autoOrient()
    .toColourspace("srgb")
    .flatten({ background: "#ffffff" });
  if (purpose === "avatar") {
    if (crop) {
      const rotated = metadata.autoOrient;
      const orientedWidth = rotated.width;
      const orientedHeight = rotated.height;
      const size = Math.round(
        crop.size * Math.min(orientedWidth, orientedHeight),
      );
      const left = Math.round(crop.left * orientedWidth);
      const top = Math.round(crop.top * orientedHeight);
      if (
        size < 1 ||
        left + size > orientedWidth ||
        top + size > orientedHeight
      )
        throw Error("INVALID_CROP");
      image = image.extract({ left, top, width: size, height: size });
    }
    image = image.resize(512, 512, { fit: "cover", position: "centre" });
  } else
    image = image.resize({
      width: 1920,
      height: 1920,
      fit: "inside",
      withoutEnlargement: true,
    });
  const result = await image
    .jpeg({ quality: purpose === "avatar" ? 80 : 82 })
    .timeout({ seconds: 15 })
    .toFile(join(output, "image.jpg"));
  let thumbnailWidth: number | null = null;
  let thumbnailHeight: number | null = null;
  let thumbnailBytes: number | null = null;
  if (purpose === "photo") {
    const thumbnail = await sharp(join(output, "image.jpg"), options)
      .resize({
        width: 480,
        height: 480,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 80 })
      .timeout({ seconds: 10 })
      .toFile(join(output, "thumbnail.jpg"));
    thumbnailWidth = thumbnail.width;
    thumbnailHeight = thumbnail.height;
    thumbnailBytes = thumbnail.size;
  }
  return {
    width: result.width,
    height: result.height,
    bytes: (await stat(join(output, "image.jpg"))).size,
    thumbnailWidth,
    thumbnailHeight,
    thumbnailBytes,
  };
}

const [source, output, purpose, crop] = process.argv.slice(2);
if (!source || !output || !["avatar", "photo"].includes(purpose ?? ""))
  process.exit(1);
try {
  await mkdir(output, { recursive: true, mode: 0o700 });
  const result = await normalize(
    source,
    output,
    purpose as MediaPurpose,
    crop ? JSON.parse(crop) : undefined,
  );
  process.send?.({ result });
} catch (caught) {
  const error = caught as NodeJS.ErrnoException;
  const known = [
    "UNSUPPORTED_IMAGE",
    "IMAGE_DIMENSIONS_EXCEEDED",
    "INVALID_CROP",
  ];
  process.send?.({
    error:
      error.code === "ENOENT"
        ? "MEDIA_DECODER_UNAVAILABLE"
        : error.message === "Input image exceeds pixel limit"
          ? "IMAGE_DIMENSIONS_EXCEEDED"
          : known.includes(error.message)
            ? error.message
            : "INVALID_IMAGE",
  });
}
process.disconnect?.();
