import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type { SpotifyConfig, SpotifyTokens } from "./provider.ts";
export function spotifyTokenCipher(config: SpotifyConfig) {
  const key = createHash("sha256")
    .update(
      `blackwood:spotify-tokens:${config.clientId}:${config.clientSecret}`,
    )
    .digest();
  return {
    encrypt(tokens: Pick<SpotifyTokens, "accessToken" | "refreshToken">) {
      const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([
        cipher.update(JSON.stringify(tokens), "utf8"),
        cipher.final(),
      ]);
      return [iv, cipher.getAuthTag(), encrypted]
        .map((part) => part.toString("base64url"))
        .join(".");
    },
    decrypt(
      value: string,
    ): Pick<SpotifyTokens, "accessToken" | "refreshToken"> {
      const parts = value.split(".");
      if (parts.length !== 3 || value.length > 20000)
        throw new Error("Invalid Spotify token envelope.");
      const [iv, tag, encrypted] = parts.map((part) =>
        Buffer.from(part, "base64url"),
      );
      if (iv?.length !== 12 || tag?.length !== 16 || !encrypted)
        throw new Error("Invalid Spotify token envelope.");
      const cipher = createDecipheriv("aes-256-gcm", key, iv);
      cipher.setAuthTag(tag);
      const tokens = JSON.parse(
        Buffer.concat([cipher.update(encrypted), cipher.final()]).toString(
          "utf8",
        ),
      );
      if (
        typeof tokens.accessToken !== "string" ||
        typeof tokens.refreshToken !== "string"
      )
        throw new Error("Invalid Spotify token envelope.");
      return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      };
    },
  };
}
