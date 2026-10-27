import { type FrameId, parseCoffreState } from "../../coffre/requests";
import { OrganizerRequestError } from "../requests";

export class OrganizerCoffreError extends OrganizerRequestError {
  readonly code: string;
  constructor(status: number, code = "") {
    super(status);
    this.code = code;
  }
}
export interface ContributionMetadata {
  id: string;
  visibility: "public" | "private";
  frameId: FrameId;
  createdAt: string;
  hasText: boolean;
  hasPhoto: boolean;
  author: { profileId: string; firstName: string } | null;
}
export interface ContributionDetail
  extends Omit<ContributionMetadata, "hasText" | "hasPhoto"> {
  text: string | null;
  photoMediaId: string | null;
}
export interface MetadataPage {
  contributions: ContributionMetadata[];
  nextCursor: string | null;
}
async function request<T>(
  path: string,
  method = "GET",
  body?: object,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/organizer/coffre${path}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "X-Organizer-Request": "1",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.any([
      AbortSignal.timeout(15_000),
      ...(signal ? [signal] : []),
    ]),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new OrganizerCoffreError(
      response.status,
      typeof error?.code === "string" ? error.code : "",
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
export const readOrganizerCoffre = async (signal: AbortSignal) =>
  parseCoffreState(await request("", "GET", undefined, signal));
export const prepareCoffre = async (durationSeconds: number) =>
  parseCoffreState(await request("", "PUT", { durationSeconds }));
export const startCoffre = async () =>
  parseCoffreState(await request("/start", "POST", {}));
export const advanceCoffre = async (deadline: string) =>
  parseCoffreState(await request("/advance", "POST", { deadline }));
export const openCoffre = async () =>
  parseCoffreState(await request("/open", "POST", {}));
export function readMetadata(
  signal: AbortSignal,
  after: string | null,
  visibility: "" | "public" | "private",
) {
  const query = new URLSearchParams();
  if (after) query.set("after", after);
  if (visibility) query.set("visibility", visibility);
  return request<MetadataPage>(
    `/contributions${query.size ? `?${query}` : ""}`,
    "GET",
    undefined,
    signal,
  );
}
export const readContribution = (id: string, signal: AbortSignal) =>
  request<ContributionDetail>(
    `/contributions/${encodeURIComponent(id)}`,
    "GET",
    undefined,
    signal,
  );
export const deleteContribution = (id: string) =>
  request<void>(`/contributions/${encodeURIComponent(id)}`, "DELETE");
export function organizerCoffreError(error: unknown) {
  if (error instanceof OrganizerCoffreError) {
    if (error.code === "COFFRE_INVALID_DEADLINE")
      return "Choisis une échéance à venir, plus proche que l’échéance actuelle.";
    if (error.code === "COFFRE_REVEALED")
      return "Le Coffre est déjà ouvert. Les nouveaux dépôts sont fermés.";
    if (error.code === "COFFRE_ALREADY_STARTED")
      return "Le compte à rebours est déjà lancé. Tu peux seulement avancer l’ouverture.";
    if (error.code === "COFFRE_NOT_COLLECTING")
      return "Lance le compte à rebours avant cette action.";
    if (error.code === "COFFRE_NOT_PREPARED")
      return "Prépare le Coffre avant cette action.";
  }
  return "Impossible de confirmer l’action. Actualise l’état avant de réessayer.";
}
