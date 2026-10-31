import {
  BoxGeometry,
  CanvasTexture,
  Group,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
} from "three";
import { fitPrintedText } from "./fitPrintedText";
import type { PreviewModel } from "./model";

export async function createClassicModel(
  text: string,
  image: string | null,
): Promise<PreviewModel> {
  let photo: HTMLImageElement | null = null;
  if (image) {
    photo = new Image();
    photo.src = image;
    await photo.decode();
  }
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = photo ? 1200 : 720;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Cannot create the classic model texture.");
  context.fillStyle = "#231b30";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "#8d769f";
  context.lineWidth = 3;
  context.strokeRect(24, 24, canvas.width - 48, canvas.height - 48);
  if (photo) {
    const availableHeight = text ? 740 : 1100;
    const scale = Math.min(
      920 / photo.naturalWidth,
      availableHeight / photo.naturalHeight,
    );
    const width = photo.naturalWidth * scale;
    const height = photo.naturalHeight * scale;
    context.drawImage(
      photo,
      (1024 - width) / 2,
      50 + (availableHeight - height) / 2,
      width,
      height,
    );
  }
  if (text || !photo) {
    const content = text || "Ton message ou ta photo ici";
    const top = photo ? 840 : 80;
    const height = canvas.height - top - 80;
    const layout = fitPrintedText(
      context,
      content,
      860,
      height,
      "Georgia, serif",
      64,
    );
    context.font = layout.font;
    context.fillStyle = "#eee8f2";
    context.textAlign = "center";
    context.textBaseline = "middle";
    layout.lines.forEach((line, index) => {
      context.fillText(
        line,
        512,
        top +
          height / 2 +
          (index - (layout.lines.length - 1) / 2) * layout.lineHeight,
      );
    });
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  const front = new MeshStandardMaterial({ map: texture, roughness: 0.9 });
  const back = new MeshStandardMaterial({ color: "#30263e", roughness: 0.9 });
  const object = new Group();
  object.name = "plain";
  object.add(
    new Mesh(new BoxGeometry(4.8, (4.8 * canvas.height) / canvas.width, 0.06), [
      back,
      back,
      back,
      back,
      front,
      back,
    ]),
  );
  return { object };
}
