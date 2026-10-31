export interface SpotifyTrack {
  id: string;
  title: string;
  artists: string[];
  coverUrl: string | null;
  spotifyUrl: string;
}
export interface SpotifyStatus {
  configured: boolean;
  connected: boolean;
  redirectUri: string;
}
export class SpotifyRequestError extends Error {
  readonly status: number;
  constructor(status: number) {
    super("Spotify is unavailable.");
    this.status = status;
  }
}
async function request<T>(
  path: string,
  method = "GET",
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      [path.startsWith("organizer/")
        ? "X-Organizer-Request"
        : "X-Guest-Request"]: "1",
      ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
    },
    ...(method === "POST" ? { body: "{}" } : {}),
    signal: AbortSignal.any([
      AbortSignal.timeout(25000),
      ...(signal ? [signal] : []),
    ]),
  });
  if (!response.ok) throw new SpotifyRequestError(response.status);
  return response.status === 204 ? (undefined as T) : response.json();
}
export const readSpotifyStatus = (signal: AbortSignal) =>
  request<SpotifyStatus>("organizer/spotify/status", "GET", signal);
export const authorizeSpotify = () =>
  request<{ url: string }>("organizer/spotify/authorize", "POST");
export const disconnectSpotify = () =>
  request<void>("organizer/spotify/connection", "DELETE");
export const readCurrentTrack = (signal: AbortSignal) =>
  request<{ track: SpotifyTrack | null }>("tv/spotify/current", "GET", signal);
