import type { GuestAccess, GuestProfile } from "../guest-access/requests";

export class ProfileRequestError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number) {
    super("The profile request failed.");
    this.code = code;
    this.status = status;
  }
}

async function request<T>(
  path: string,
  method = "GET",
  body?: object | FormData,
  signal?: AbortSignal,
): Promise<T> {
  const multipart = body instanceof FormData;
  const response = await fetch(`/api/${path}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "X-Guest-Request": "1",
      ...(body && !multipart ? { "Content-Type": "application/json" } : {}),
    },
    body: multipart ? body : body ? JSON.stringify(body) : null,
    signal: AbortSignal.any([
      AbortSignal.timeout(multipart ? 95_000 : 15_000),
      ...(signal ? [signal] : []),
    ]),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new ProfileRequestError(
      typeof error?.code === "string" ? error.code : "",
      response.status,
    );
  }
  return response.json() as Promise<T>;
}

export const patchProfile = (firstName: string) =>
  request<GuestProfile>("profiles/me", "PATCH", { firstName });
export const deleteAvatar = () =>
  request<GuestProfile>("profiles/me/avatar", "DELETE");
export function uploadAvatar(
  file: File,
  crop?: { left: number; top: number; size: number },
) {
  const body = new FormData();
  if (crop) body.append("crop", JSON.stringify(crop));
  body.append("file", file);
  return request<GuestProfile>("profiles/me/avatar", "PUT", body);
}
export interface CompanionStatus {
  eligible: boolean;
  companion: { firstName: string } | null;
}
export const readCompanion = (signal: AbortSignal) =>
  request<CompanionStatus>("profiles/me/companion", "GET", undefined, signal);
export const issueCompanion = () =>
  request<{ mainProfileId: string; token: string; expiresAt: string }>(
    "profiles/me/companion-invitations",
    "POST",
  );
export const claimCompanion = (input: {
  mainProfileId: string;
  token: string;
  firstName: string;
}) => request<GuestAccess>("companion-invitations/claim", "POST", input);

export function profileError(error: unknown) {
  if (!(error instanceof ProfileRequestError))
    return "Impossible de joindre l’hôtel. Réessaie en gardant cette page ouverte.";
  switch (error.code) {
    case "HUB_CLOSED":
      return "Le hub est fermé. Ton accès est conservé ; retourne à ton invitation.";
    case "GUEST_UNAUTHENTICATED":
    case "PROFILE_ACCESS_DISABLED":
      return "Ton accès n’est plus disponible. Retrouve ton profil avec le code transmis par Chris.";
    case "COMPANION_NOT_ALLOWED":
      return "Ce lien n’est plus disponible. Le principal doit avoir prévu un +1 dans sa réponse et le hub doit être ouvert.";
    case "COMPANION_ALREADY_CLAIMED":
      return "Ce lien a déjà été utilisé. Pour retrouver un profil existant, utilise ton code personnel.";
    case "COMPANION_INVITATION_NOT_FOUND":
      return "Ce lien est invalide ou expiré. Demande un nouveau lien à la personne qui t’invite.";
    case "PROFILE_ALREADY_IDENTIFIED":
      return "Ce navigateur est déjà associé à un profil. Ouvre le lien sur le navigateur de ton +1 ou dans une fenêtre privée.";
    case "MEDIA_TOO_LARGE":
      return "La photo dépasse 20 Mo. Choisis un fichier plus petit.";
    case "IMAGE_DIMENSIONS_EXCEEDED":
      return "Cette photo est trop grande : 60 millions de pixels et 12 000 pixels par côté maximum.";
    case "UNSUPPORTED_IMAGE":
      return "Choisis une photo JPEG, PNG, WebP ou HEIC fixe.";
    case "INVALID_IMAGE":
      return "Cette photo est illisible. Essaie avec une autre image.";
    case "MEDIA_BUSY":
      return "Une photo est déjà en cours de traitement. Réessaie dans un instant.";
    case "INVALID_CROP":
      return "Le cadrage n’est pas valide. Sélectionne à nouveau la photo.";
    case "VALIDATION_ERROR":
      return "Vérifie ton prénom : il doit contenir entre 1 et 50 caractères.";
    default:
      return "Impossible d’enregistrer pour le moment. Ton choix est conservé ; réessaie.";
  }
}
