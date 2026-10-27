import {
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
} from "three";
import { fitPrintedText } from "../../preview/fitPrintedText";
import type { PreviewModel } from "../../preview/model";
import printUrl from "./one-wish-willow.svg";

const LENGTH = 6.8;
const SIDE = 1.65;
const INK = "#d82325";
const PAPER = "#f6e5cc";

function canvasTexture(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Cannot create the wish texture.");
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return { canvas, context, texture };
}

/** Equilateral triangular prism along X; every face uses shared section points. */
export async function createWillowModel(
  message: string,
): Promise<PreviewModel> {
  await document.fonts.load('400 88px "Willow Caprasimo"');
  const print = new Image();
  print.src = printUrl;
  await print.decode();

  const front = canvasTexture(2048, 512);
  front.context.fillStyle = PAPER;
  front.context.fillRect(0, 0, 2048, 512);
  front.context.drawImage(print, 18, 8, 2012, 496);

  const upper = canvasTexture(2048, 512);
  upper.context.fillStyle = PAPER;
  upper.context.fillRect(0, 0, 2048, 512);
  upper.context.strokeStyle = INK;
  upper.context.lineWidth = 5;
  upper.context.strokeRect(28, 28, 1992, 456);
  upper.context.fillStyle = INK;
  upper.context.textAlign = "center";
  upper.context.textBaseline = "middle";
  const layout = fitPrintedText(
    upper.context,
    message,
    1780,
    360,
    '"Willow Caprasimo", Georgia, serif',
    88,
  );
  upper.context.font = layout.font;
  layout.lines.forEach((line, index) => {
    upper.context.fillText(
      line,
      1024,
      256 + (index - (layout.lines.length - 1) / 2) * layout.lineHeight,
    );
  });
  upper.texture.needsUpdate = true;

  const end = canvasTexture(512, 512);
  end.context.fillStyle = PAPER;
  end.context.fillRect(0, 0, 512, 512);
  end.context.fillStyle = INK;
  end.context.beginPath();
  end.context.moveTo(65, 82);
  end.context.lineTo(450, 256);
  end.context.lineTo(65, 430);
  end.context.closePath();
  end.context.fill();
  end.context.fillStyle = PAPER;
  end.context.font = '400 40px "Willow Caprasimo", Georgia, serif';
  end.context.textAlign = "center";
  ["ONE", "WISH", "WILLOW"].forEach((text, i) => {
    end.context.fillText(text, 190, 225 + i * 43);
  });

  const materials = [upper.texture, front.texture, null, end.texture].map(
    (map) =>
      new MeshStandardMaterial({
        color: map ? "#ffffff" : PAPER,
        map,
        roughness: 0.92,
        metalness: 0,
      }),
  );
  const h = (SIDE * Math.sqrt(3)) / 2;
  const section = [
    [SIDE / 2, -h / 3],
    [-SIDE / 2, -h / 3],
    [0, (2 * h) / 3],
  ] as const;
  const positions: number[] = [];
  const uvs: number[] = [];
  const geometry = new BufferGeometry();
  // Ordered so upper and front read left-to-right from the audience camera.
  for (const [a, b, material] of [
    [2, 0, 0],
    [1, 2, 1],
    [0, 1, 2],
  ] as const) {
    const from = section[a];
    const to = section[b];
    const start = positions.length / 3;
    const vertices = [
      [-LENGTH / 2, from[0], from[1]],
      [LENGTH / 2, from[0], from[1]],
      [LENGTH / 2, to[0], to[1]],
      [-LENGTH / 2, to[0], to[1]],
    ];
    for (const index of [0, 1, 2, 0, 2, 3])
      positions.push(...(vertices[index] ?? []));
    uvs.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
    geometry.addGroup(start, 6, material);
  }
  for (const direction of [-1, 1]) {
    const start = positions.length / 3;
    const order = direction === 1 ? [0, 2, 1] : [0, 1, 2];
    for (const index of order) {
      const point = section[index];
      if (!point) continue;
      positions.push((direction * LENGTH) / 2, point[0], point[1]);
      uvs.push((point[1] + h / 3) / h, (point[0] + SIDE / 2) / SIDE);
    }
    geometry.addGroup(start, 3, 3);
  }
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  const object = new Group();
  object.name = "one-wish-willow";
  const mesh = new Mesh(geometry, materials);
  object.add(mesh);
  return { object };
}
