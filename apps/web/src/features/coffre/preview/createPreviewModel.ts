import type { FrameId } from "../requests";
import { createWillowModel } from "../themes/one-wish-willow/createWillowModel";
import { createClassicModel } from "./createClassicModel";

export function createPreviewModel(
  frame: FrameId,
  text: string | null,
  image: string | null,
) {
  return frame === "one-wish-willow" && !image
    ? createWillowModel(text || "Ton vœu ici")
    : createClassicModel(text ?? "", image);
}
