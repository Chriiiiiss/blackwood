export const mediaLimits = {
  fileBytes: 20 * 1024 * 1024,
  requestBytes: 21 * 1024 * 1024,
  pixels: 60_000_000,
  side: 12_000,
  processingMs: 30_000,
  uploadMs: 60_000,
  staleMs: 15 * 60_000,
} as const;

export interface AvatarCrop {
  left: number;
  top: number;
  size: number;
}
export type MediaPurpose = "avatar" | "photo";
export interface ProcessedMedia {
  width: number;
  height: number;
  bytes: number;
  thumbnailWidth: number | null;
  thumbnailHeight: number | null;
  thumbnailBytes: number | null;
}
