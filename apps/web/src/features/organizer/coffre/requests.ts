import {
  type CoffreState,
  type FrameId,
  parseCoffreState,
} from "../../coffre/requests";
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
  coffreId?: number,
): Promise<T> {
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetch(
    `/api/organizer/coffre${path}${coffreId ? `${separator}coffreId=${coffreId}` : ""}`,
    {
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
    },
  );
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new OrganizerCoffreError(
      response.status,
      typeof error?.code === "string" ? error.code : "",
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
export const readOrganizerCoffre = async (
  signal: AbortSignal,
  coffreId?: number,
) => parseCoffreState(await request("", "GET", undefined, signal, coffreId));
export const renameCoffre = async (name: string, coffreId: number) =>
  parseCoffreState(await request("", "PATCH", { name }, undefined, coffreId));
export const prepareCoffre = async (durationSeconds: number, coffreId = 1) =>
  parseCoffreState(
    await request("", "PUT", { durationSeconds }, undefined, coffreId),
  );
export const startCoffre = async (coffreId = 1) =>
  parseCoffreState(await request("/start", "POST", {}, undefined, coffreId));
export const advanceCoffre = async (deadline: string, coffreId = 1) =>
  parseCoffreState(
    await request("/advance", "POST", { deadline }, undefined, coffreId),
  );
export const openCoffre = async (coffreId = 1) =>
  parseCoffreState(await request("/open", "POST", {}, undefined, coffreId));
export async function readCoffreHistory(
  signal: AbortSignal,
  before: number | null,
): Promise<{ coffres: CoffreState[]; nextCursor: number | null }> {
  const body = await request<{ coffres: unknown[]; nextCursor: number | null }>(
    `s${before ? `?before=${before}` : ""}`,
    "GET",
    undefined,
    signal,
  );
  if (
    !Array.isArray(body.coffres) ||
    !(body.nextCursor === null || Number.isSafeInteger(body.nextCursor))
  )
    throw new OrganizerCoffreError(502);
  return { ...body, coffres: body.coffres.map(parseCoffreState) };
}
export const createNextCoffre = async (previousCoffreId: number) =>
  parseCoffreState(await request("s", "POST", { previousCoffreId }));
export function readMetadata(
  signal: AbortSignal,
  after: string | null,
  visibility: "" | "public" | "private",
  coffreId = 1,
) {
  const query = new URLSearchParams();
  if (after) query.set("after", after);
  if (visibility) query.set("visibility", visibility);
  return request<MetadataPage>(
    `/contributions${query.size ? `?${query}` : ""}`,
    "GET",
    undefined,
    signal,
    coffreId,
  );
}
export const readContribution = (
  id: string,
  signal: AbortSignal,
  coffreId = 1,
) =>
  request<ContributionDetail>(
    `/contributions/${encodeURIComponent(id)}`,
    "GET",
    undefined,
    signal,
    coffreId,
  );
export const deleteContribution = (id: string, coffreId = 1) =>
  request<void>(
    `/contributions/${encodeURIComponent(id)}`,
    "DELETE",
    undefined,
    undefined,
    coffreId,
  );
export function organizerCoffreError(error: unknown) {
  if (error instanceof OrganizerCoffreError) {
    if (error.code === "COFFRE_INVALID_NAME")
      return "Choisis un nom de 1 à 80 caractères.";
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
