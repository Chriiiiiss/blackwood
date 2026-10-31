import { OrganizerRequestError } from "../organizer/requests";

export interface ActivityEvent {
  id: string;
  profileId: string | null;
  firstName: string | null;
  kind: string;
  page: string;
  route: string | null;
  method: string | null;
  status: number | null;
  code: string | null;
  source: string | null;
  createdAt: string;
}
export interface ActivityFilters {
  profileId: string;
  page: string;
  onlyErrors: boolean;
}
export async function readActivity(
  filters: ActivityFilters,
  before: string | null,
  signal: AbortSignal,
): Promise<{ events: ActivityEvent[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (filters.profileId) params.set("profileId", filters.profileId);
  if (filters.page) params.set("page", filters.page);
  if (filters.onlyErrors) params.set("onlyErrors", "1");
  if (before) params.set("before", before);
  const response = await fetch(`/api/organizer/activity?${params}`, {
    credentials: "same-origin",
    cache: "no-store",
    headers: { "X-Organizer-Request": "1" },
    signal,
  });
  if (!response.ok) throw new OrganizerRequestError(response.status);
  return response.json();
}
