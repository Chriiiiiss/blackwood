export interface SpotifyConfig {
  clientId: string;
  clientSecret: string;
}
export interface SpotifyTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}
export interface SpotifyTrack {
  id: string;
  title: string;
  artists: string[];
  coverUrl: string | null;
  spotifyUrl: string;
}
export class SpotifyError extends Error {
  readonly status: number;
  readonly retryAfter: number;
  readonly revoked: boolean;
  constructor(status: number, retryAfter = 30, revoked = false) {
    super("Spotify is unavailable.");
    this.status = status;
    this.retryAfter = retryAfter;
    this.revoked = revoked;
  }
}
export function createSpotifyProvider(
  config: SpotifyConfig,
  http: typeof fetch = fetch,
) {
  async function token(
    parameters: URLSearchParams,
    previousRefresh?: string,
  ): Promise<SpotifyTokens> {
    const response = await http("https://accounts.spotify.com/api/token", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(7000),
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: parameters.toString(),
    });
    if (!response.ok)
      throw new SpotifyError(
        response.status,
        Number(response.headers.get("retry-after")) || 30,
        response.status === 400 || response.status === 401,
      );
    const data = (await response.json()) as Record<string, unknown>;
    const refreshToken = data.refresh_token ?? previousRefresh;
    if (
      typeof data.access_token !== "string" ||
      !data.access_token ||
      data.access_token.length > 4096 ||
      typeof refreshToken !== "string" ||
      !refreshToken ||
      refreshToken.length > 4096 ||
      typeof data.expires_in !== "number" ||
      !Number.isFinite(data.expires_in) ||
      data.expires_in <= 0 ||
      data.expires_in > 86400 ||
      (!previousRefresh &&
        (typeof data.scope !== "string" ||
          !data.scope.split(" ").includes("user-read-currently-playing")))
    )
      throw new SpotifyError(502);
    return {
      accessToken: data.access_token,
      refreshToken,
      expiresIn: data.expires_in,
    };
  }
  return {
    exchange: (code: string, redirectUri: string) =>
      token(
        new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
        }),
      ),
    refresh: (refreshToken: string) =>
      token(
        new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }),
        refreshToken,
      ),
    async current(accessToken: string): Promise<SpotifyTrack | null> {
      const response = await http(
        "https://api.spotify.com/v1/me/player/currently-playing",
        {
          redirect: "error",
          signal: AbortSignal.timeout(7000),
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );
      if (response.status === 204) return null;
      if (!response.ok)
        throw new SpotifyError(
          response.status,
          Number(response.headers.get("retry-after")) || 30,
          response.status === 401,
        );
      const data = await response.json();
      const track = data?.item;
      if (
        !data?.is_playing ||
        data.currently_playing_type !== "track" ||
        track?.type !== "track" ||
        data.device?.is_private_session
      )
        return null;
      if (
        typeof track.id !== "string" ||
        !/^[A-Za-z0-9]{22}$/.test(track.id) ||
        typeof track.name !== "string" ||
        !Array.isArray(track.artists)
      )
        return null;
      const artists = track.artists
        .slice(0, 12)
        .flatMap((artist: { name?: unknown }) =>
          typeof artist?.name === "string" ? [artist.name.slice(0, 200)] : [],
        );
      if (!artists.length) return null;
      let coverUrl: string | null = null;
      for (const image of track.album?.images ?? []) {
        try {
          const url = new URL(image.url);
          if (
            url.protocol === "https:" &&
            !url.username &&
            !url.password &&
            (url.hostname === "i.scdn.co" ||
              url.hostname.endsWith(".scdn.co") ||
              url.hostname.endsWith(".spotifycdn.com"))
          ) {
            coverUrl = url.href;
            break;
          }
        } catch {
          /* Unusable artwork is optional. */
        }
      }
      return {
        id: track.id,
        title: track.name.slice(0, 300),
        artists,
        coverUrl,
        spotifyUrl: `https://open.spotify.com/track/${track.id}`,
      };
    },
  };
}
export type SpotifyProvider = ReturnType<typeof createSpotifyProvider>;
