type Point = { x: number; y: number };

/** Unit equilateral section in the plane perpendicular to the box's length. */
export const PRISM_SECTION = [
  { y: 0, z: 0 },
  { y: 1, z: 0 },
  { y: 0.5, z: Math.sqrt(3) / 2 },
] as const;

const polygon = (points: Point[]) =>
  `${points.map(({ x, y }, i) => `${i ? "L" : "M"}${x} ${y}`).join("")}Z`;

export function prismGeometry(height: number) {
  const frontTop = height - 225;
  // One affine view of the whole solid: every face shares the same vertices.
  const project = (
    length: number,
    { y, z }: (typeof PRISM_SECTION)[number],
  ) => {
    const depth = z / (Math.sqrt(3) / 2);
    return {
      x: 80 + length * 225 - depth * 55,
      y: 20 + y * (height - 20) + depth * (frontTop - (height + 20) / 2),
    };
  };
  const projectEnd = (length: number) =>
    [
      project(length, PRISM_SECTION[0]),
      project(length, PRISM_SECTION[1]),
      project(length, PRISM_SECTION[2]),
    ] as const;
  const [backTopLeft, backBottomLeft, ridgeLeft] = projectEnd(0);
  const [backTopRight, backBottomRight, ridgeRight] = projectEnd(4);
  return {
    outline: polygon([
      backTopLeft,
      backTopRight,
      backBottomRight,
      backBottomLeft,
      ridgeLeft,
    ]),
    upperFace: polygon([backTopLeft, backTopRight, ridgeRight, ridgeLeft]),
    endFace: polygon([backTopRight, backBottomRight, ridgeRight]),
    edges: `M${ridgeLeft.x} ${ridgeLeft.y}L${ridgeRight.x} ${ridgeRight.y}L${backTopRight.x} ${backTopRight.y}M${ridgeRight.x} ${ridgeRight.y}L${backBottomRight.x} ${backBottomRight.y}`,
  };
}
