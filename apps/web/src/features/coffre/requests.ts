export type FrameId = "plain" | "one-wish-willow";
export interface CoffreState {
  state: "unprepared" | "prepared" | "collecting" | "revealed";
  serverNow: string;
  deadline: string | null;
  durationSeconds: number | null;
  startedAt: string | null;
  receivedAt: number;
}
export interface ContributionDraft {
  id: string;
  text: string;
  visibility: "public" | "private";
  frameId: FrameId;
  file: File | null;
}
export interface PublicContribution {
  id: string;
  text: string | null;
  photoMediaId: string | null;
  frameId: FrameId;
  createdAt: string;
}
export interface ContributionPage {
  contributions: PublicContribution[];
  nextCursor: string | null;
}
export class CoffreRequestError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code = "") {
    super("The Coffre request failed.");
    this.status = status;
    this.code = code;
  }
}
async function request(
  path: string,
  signal?: AbortSignal,
  body?: object | FormData,
): Promise<unknown> {
  const multipart = body instanceof FormData;
  const response = await fetch(`/api/coffre${path}`, {
    method: body ? "POST" : "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "X-Guest-Request": "1",
      ...(body && !multipart ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: multipart ? body : JSON.stringify(body) } : {}),
    signal: AbortSignal.any([
      AbortSignal.timeout(multipart ? 95_000 : 15_000),
      ...(signal ? [signal] : []),
    ]),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new CoffreRequestError(
      response.status,
      typeof error?.code === "string" ? error.code : "",
    );
  }
  return response.json();
}
const validDate = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
export async function readCoffre(signal: AbortSignal): Promise<CoffreState> {
  const body = (await request("", signal)) as Partial<CoffreState> | null;
  if (
    !body ||
    !["unprepared", "prepared", "collecting", "revealed"].includes(
      body.state ?? "",
    ) ||
    !validDate(body.serverNow) ||
    !(body.deadline === null || validDate(body.deadline)) ||
    (["collecting", "revealed"].includes(body.state ?? "") &&
      body.deadline === null)
  )
    throw new CoffreRequestError(502);
  return { ...body, receivedAt: performance.now() } as CoffreState;
}
export async function readContributions(
  signal: AbortSignal,
  after: string | null,
): Promise<ContributionPage> {
  const body = (await request(
    `/contributions${after ? `?after=${encodeURIComponent(after)}` : ""}`,
    signal,
  )) as Partial<ContributionPage> | null;
  if (
    !body ||
    !Array.isArray(body.contributions) ||
    !(body.nextCursor === null || typeof body.nextCursor === "string") ||
    body.contributions.some(
      (item) =>
        !item ||
        typeof item.id !== "string" ||
        !(item.text === null || typeof item.text === "string") ||
        !(
          item.photoMediaId === null || typeof item.photoMediaId === "string"
        ) ||
        !["plain", "one-wish-willow"].includes(item.frameId),
    )
  )
    throw new CoffreRequestError(502);
  return body as ContributionPage;
}
export async function depositContribution(draft: ContributionDraft) {
  const metadata = {
    id: draft.id,
    text: draft.text,
    visibility: draft.visibility,
    frameId: draft.frameId,
  };
  let body: object | FormData = metadata;
  if (draft.file) {
    const form = new FormData();
    form.append("contribution", JSON.stringify(metadata));
    form.append("file", draft.file);
    body = form;
  }
  const receipt = (await request("/contributions", undefined, body)) as {
    id?: unknown;
    received?: unknown;
  } | null;
  if (receipt?.id !== draft.id || receipt.received !== true)
    throw new CoffreRequestError(502);
}
export function newDraft(): ContributionDraft {
  // getRandomValues also works on HTTP LAN origins; no draft content enters storage.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 15) | 64;
  bytes[8] = ((bytes[8] ?? 0) & 63) | 128;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return { id, text: "", visibility: "public", frameId: "plain", file: null };
}
export function coffreError(error: unknown) {
  if (!(error instanceof CoffreRequestError))
    return "L’envoi n’a pas pu être confirmé. Réessaie avec ce même dépôt.";
  switch (error.code) {
    case "MEDIA_TOO_LARGE":
      return "La photo dépasse 20 Mo. Choisis un fichier plus petit.";
    case "IMAGE_DIMENSIONS_EXCEEDED":
      return "Cette photo est trop grande. Choisis une image plus petite.";
    case "UNSUPPORTED_IMAGE":
    case "INVALID_IMAGE":
      return "Choisis une photo JPEG, PNG, WebP ou HEIC fixe et lisible.";
    case "MEDIA_BUSY":
      return "Une photo est en cours de traitement. Réessaie dans un instant.";
    case "CONTRIBUTION_EMPTY":
      return "Ajoute un message ou une photo avant de continuer.";
    case "FRAME_CONTENT_MISMATCH":
      return "One Wish Willow accueille les messages seuls. Choisis le cadre Classique pour une photo.";
    case "TEXT_TOO_LONG":
    case "VALIDATION_ERROR":
      return "Vérifie ton dépôt : 500 caractères et une seule photo maximum.";
    case "COFFRE_REVEALED":
      return "Le Coffre vient de s’ouvrir. Les nouveaux dépôts sont fermés.";
    case "COFFRE_NOT_PREPARED":
    case "COFFRE_NOT_COLLECTING":
      return "Le Coffre n’accueille pas encore les dépôts.";
    case "CONTRIBUTION_CONFLICT":
      return "Ce dépôt ne peut pas être confirmé. Son identifiant correspond déjà à un autre envoi.";
    default:
      return "Impossible de confirmer l’envoi pour le moment. Réessaie avec ce même dépôt.";
  }
}
