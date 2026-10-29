export interface OrganizerSession {
  authenticated: true;
  expiresAt: string;
  idleExpiresAt: string;
}

export interface OrganizerResponses {
  responses: {
    firstName: string;
    attendance: "yes" | "no" | "to_confirm";
    plusOne: boolean;
    ideas: string | null;
  }[];
  totals: { attending: number; toConfirm: number; plusOnes: number };
}

export class OrganizerRequestError extends Error {
  status: number;
  retryAfter: number;
  constructor(status: number, retryAfter = 0) {
    super("Organizer request failed.");
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/organizer/${path}`, {
    ...options,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "X-Organizer-Request": "1",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!response.ok)
    throw new OrganizerRequestError(
      response.status,
      Number(response.headers.get("retry-after")) || 0,
    );
  return response.status === 204 ? (undefined as T) : response.json();
}

export const readSession = (signal: AbortSignal) =>
  request<OrganizerSession>("session", { signal });
export const readResponses = (signal: AbortSignal) =>
  request<OrganizerResponses>("invitation-responses", { signal });
export const login = (password: string) =>
  request<OrganizerSession>("session", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
export const logout = () => request<void>("session", { method: "DELETE" });

export const issueTvCode = () =>
  request<{ code: string; expiresAt: string }>("tv/pairing", {
    method: "POST",
    body: "{}",
    signal: AbortSignal.timeout(15_000),
  });

export const readHubSettings = (signal: AbortSignal) =>
  request<{ hubEnabled: boolean }>("hub-settings", { signal });
export const saveHubSettings = (hubEnabled: boolean) =>
  request<{ hubEnabled: boolean }>("hub-settings", {
    method: "PUT",
    body: JSON.stringify({ hubEnabled }),
  });

export interface ProfileAccess {
  id: string;
  firstName: string;
  role: "main" | "companion";
  accessEnabled: boolean;
  codeEnabled: boolean;
}
export const readProfileAccess = (signal: AbortSignal) =>
  request<ProfileAccess[]>("profile-access", { signal });
export const issueGuestCode = (profileId: string) =>
  request<{ code: string }>(`profiles/${encodeURIComponent(profileId)}/code`, {
    method: "POST",
  });
export const disableGuestAccess = (profileId: string) =>
  request<void>(`profiles/${encodeURIComponent(profileId)}/code`, {
    method: "DELETE",
  });
