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
  readonly code: string;
  readonly retryAfter: number;
  constructor(status: number, code = "", retryAfter = 0) {
    super("Guest access could not be verified.");
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
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
  if (!response.ok) throw await guestAccessError(response);
  const body: unknown = await response.json();
  return parseGuestAccess(body);
}

function parseGuestAccess(body: unknown): GuestAccess {
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

async function guestAccessError(response: Response) {
  const body: unknown = await response.json().catch(() => null);
  return new GuestAccessError(
    response.status,
    body &&
      typeof body === "object" &&
      "code" in body &&
      typeof body.code === "string"
      ? body.code
      : "",
    Number(response.headers.get("retry-after")) || 0,
  );
}

export async function loginGuestAccess(code: string): Promise<GuestAccess> {
  const response = await fetch("/api/guest-access/login", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json", "X-Guest-Request": "1" },
    body: JSON.stringify({ code }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw await guestAccessError(response);
  return parseGuestAccess(await response.json());
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
