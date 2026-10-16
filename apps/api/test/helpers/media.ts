import { crc32, deflateSync } from "node:zlib";
import sharp from "sharp";

export function animatedPngFixture() {
  const chunk = (name: string, data: Buffer) => {
    const type = Buffer.from(name);
    const size = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(Buffer.concat([type, data])));
    return Buffer.concat([size, type, data, checksum]);
  };
  const header = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
  const frame = (sequence: number) => {
    const result = Buffer.alloc(26);
    result.writeUInt32BE(sequence, 0);
    result.writeUInt32BE(1, 4);
    result.writeUInt32BE(1, 8);
    result.writeUInt16BE(1, 20);
    result.writeUInt16BE(10, 22);
    return result;
  };
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("tEXt", Buffer.from(`Comment\0${"x".repeat(1024)}`)),
    chunk("acTL", Buffer.from([0, 0, 0, 2, 0, 0, 0, 0])),
    chunk("fcTL", frame(0)),
    chunk("IDAT", deflateSync(Buffer.from([0, 255, 0, 0, 255]))),
    chunk("fcTL", frame(1)),
    chunk(
      "fdAT",
      Buffer.concat([
        Buffer.from([0, 0, 0, 2]),
        deflateSync(Buffer.from([0, 0, 0, 255, 255])),
      ]),
    ),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function imageMetadata(bytes: Buffer) {
  return sharp(bytes).metadata();
}

export async function imageFixture(format: "jpeg" | "png" | "webp" = "jpeg") {
  return sharp({
    create: { width: 1200, height: 800, channels: 3, background: "#69439a" },
  })
    .toFormat(format)
    .toBuffer();
}

export function multipart(
  parts: { name: string; data: Buffer | string; filename?: string }[],
) {
  const boundary = "blackwood-media-test-boundary";
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"${part.filename ? `; filename="${part.filename}"` : ""}\r\n${part.filename ? "Content-Type: application/octet-stream\r\n" : ""}\r\n`,
      ),
      Buffer.from(part.data),
      Buffer.from("\r\n"),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}
