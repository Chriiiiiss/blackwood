import type { Group } from "three";

/** Models own geometry and printed content; the viewer owns camera and lighting. */
export interface PreviewModel {
  object: Group;
}
export type PreviewModelFactory = () => Promise<PreviewModel>;
