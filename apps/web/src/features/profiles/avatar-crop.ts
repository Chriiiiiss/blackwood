export interface ImageDimensions {
  width: number;
  height: number;
}
export interface CropView {
  zoom: number;
  x: number;
  y: number;
}
export interface Point {
  x: number;
  y: number;
}
export const initialCrop: CropView = { zoom: 1, x: 0.5, y: 0.5 };
export const cropSide = (dimensions: ImageDimensions, zoom: number) =>
  Math.min(dimensions.width, dimensions.height) / zoom;

function bounded(view: CropView, dimensions: ImageDimensions): CropView {
  const zoom = Math.max(1, Math.min(4, view.zoom));
  const side = cropSide(dimensions, zoom);
  const halfX = side / dimensions.width / 2;
  const halfY = side / dimensions.height / 2;
  return {
    zoom,
    x: Math.max(halfX, Math.min(1 - halfX, view.x)),
    y: Math.max(halfY, Math.min(1 - halfY, view.y)),
  };
}

// Keep the image point under the gesture's old midpoint under its new midpoint.
export function moveCrop(
  view: CropView,
  dimensions: ImageDimensions,
  before: Point,
  after: Point,
  scale = 1,
): CropView {
  const zoom = Math.max(1, Math.min(4, view.zoom * scale));
  const oldSide = cropSide(dimensions, view.zoom);
  const newSide = cropSide(dimensions, zoom);
  return bounded(
    {
      zoom,
      x:
        view.x +
        ((before.x - 0.5) * oldSide - (after.x - 0.5) * newSide) /
          dimensions.width,
      y:
        view.y +
        ((before.y - 0.5) * oldSide - (after.y - 0.5) * newSide) /
          dimensions.height,
    },
    dimensions,
  );
}

export function avatarCrop(view: CropView, dimensions: ImageDimensions) {
  const side = cropSide(dimensions, view.zoom);
  return {
    left: Math.max(0, view.x - side / dimensions.width / 2),
    top: Math.max(0, view.y - side / dimensions.height / 2),
    size: 1 / view.zoom,
  };
}
