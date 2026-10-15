export interface GuestProfile {
  id: string;
  firstName: string;
  avatarMediaId: string | null;
  hasInvitationResponse: boolean;
  role: "main" | "companion";
}

export interface GuestAccess {
  hubEnabled: boolean;
  profile: GuestProfile | null;
}

export class GuestAccessError extends Error {
  readonly status: number;
  constructor(status: number) {
    super("Guest access could not be verified.");
    this.status = status;
  }
}

async function request(
  signal: AbortSignal,
  responseId?: string,
): Promise<GuestAccess | null> {
  const response = await fetch(
    `/api/guest-access${responseId ? "/restore" : ""}`,
    {
      method: responseId ? "POST" : "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "X-Guest-Request": "1",
        ...(responseId ? { "Content-Type": "application/json" } : {}),
      },
      ...(responseId ? { body: JSON.stringify({ responseId }) } : {}),
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    },
  );
  if (responseId && response.status === 404) return null;
  if (!response.ok) throw new GuestAccessError(response.status);
  const body: unknown = await response.json();
  if (
    !body ||
    typeof body !== "object" ||
    !("hubEnabled" in body) ||
    typeof body.hubEnabled !== "boolean" ||
    !("profile" in body)
  )
    throw new GuestAccessError(502);
  if (body.profile !== null) {
    const profile = body.profile as Partial<GuestProfile>;
    if (
      !profile ||
      typeof profile.id !== "string" ||
      typeof profile.firstName !== "string" ||
      typeof profile.hasInvitationResponse !== "boolean" ||
      !["main", "companion"].includes(profile.role ?? "") ||
      !(
        profile.avatarMediaId === null ||
        typeof profile.avatarMediaId === "string"
      )
    )
      throw new GuestAccessError(502);
  }
  return body as GuestAccess;
}

export async function readGuestAccess(
  signal: AbortSignal,
): Promise<GuestAccess> {
  const access = await request(signal);
  if (!access) throw new GuestAccessError(502);
  return access;
}

export const restoreGuestAccess = (responseId: string, signal: AbortSignal) =>
  request(signal, responseId);
