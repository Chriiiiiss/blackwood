import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useOrganizerLayout } from "../organizer/OrganizerLayout";
import styles from "./organizer-spotify.module.scss";
import { spotifyStatusOptions } from "./queries";
import {
  authorizeSpotify,
  disconnectSpotify,
  SpotifyRequestError,
} from "./requests";

export function OrganizerSpotifySettings() {
  const { expire } = useOrganizerLayout();
  const query = useQuery(spotifyStatusOptions());
  const client = useQueryClient();
  const navigate = useNavigate();
  const { spotify } = useSearch({ from: "/organisateur/_private/coffre" });
  const guard = useRef(false);
  const mutation = useMutation({
    mutationFn: async (action: "connect" | "disconnect") => {
      if (action === "disconnect") {
        await disconnectSpotify();
        return;
      }
      const { url } = await authorizeSpotify();
      const target = new URL(url);
      if (
        target.origin !== "https://accounts.spotify.com" ||
        target.pathname !== "/authorize"
      )
        throw new Error("Invalid Spotify authorization URL.");
      window.location.assign(target.href);
    },
    retry: false,
  });
  useEffect(() => {
    if (
      query.error instanceof SpotifyRequestError &&
      query.error.status === 401
    )
      expire();
  }, [query.error, expire]);
  useEffect(() => {
    if (!spotify) return;
    if (spotify === "connected")
      toast.success("Spotify connecté.", { id: "spotify-connect" });
    else if (spotify === "denied")
      toast.info("Connexion Spotify annulée.", { id: "spotify-connect" });
    else
      toast.error("Impossible de connecter Spotify. Réessaie.", {
        id: "spotify-connect",
      });
    void client.invalidateQueries({
      queryKey: spotifyStatusOptions().queryKey,
    });
    void navigate({ to: "/organisateur/coffre", search: {}, replace: true });
  }, [spotify, client, navigate]);
  async function run(action: "connect" | "disconnect") {
    if (guard.current) return;
    guard.current = true;
    try {
      await mutation.mutateAsync(action);
      if (action === "disconnect") {
        toast.success("Spotify déconnecté.");
        await query.refetch();
      }
    } catch (error) {
      if (error instanceof SpotifyRequestError && error.status === 401)
        expire();
      else toast.error("La connexion Spotify est indisponible. Réessaie.");
    } finally {
      guard.current = false;
      mutation.reset();
    }
  }
  return (
    <section className={styles.panel} aria-labelledby="spotify-settings-title">
      <h3 id="spotify-settings-title">Spotify sur la TV</h3>
      {query.isPending ? (
        <p role="status">Vérification de Spotify…</p>
      ) : query.isError ? (
        <div>
          <p>Impossible de vérifier Spotify.</p>
          <button type="button" onClick={() => void query.refetch()}>
            Réessayer Spotify
          </button>
        </div>
      ) : (
        <>
          <p>
            {!query.data.configured
              ? "La connexion Spotify doit être configurée sur le serveur."
              : query.data.connected
                ? "Connecté. Chaque nouveau morceau s’affichera sur la TV."
                : "Connecte ton compte pour afficher les morceaux en cours sur la TV."}
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primary}
              disabled={!query.data.configured || mutation.isPending}
              onClick={() => void run("connect")}
            >
              {mutation.isPending
                ? "Connexion…"
                : query.data.connected
                  ? "Reconnecter Spotify"
                  : "Connecter mon compte Spotify"}
            </button>
            {query.data.connected && (
              <button
                type="button"
                disabled={mutation.isPending}
                onClick={() => void run("disconnect")}
              >
                Déconnecter Spotify
              </button>
            )}
          </div>
          {!query.data.connected && (
            <details>
              <summary>Configurer l’application Spotify</summary>
              <p>
                Dans{" "}
                <a
                  href="https://developer.spotify.com/dashboard"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Spotify Developers
                </a>
                , ouvre ton application Web API et ajoute cette URL de retour :
              </p>
              <input
                aria-label="URL de retour Spotify"
                readOnly
                value={query.data.redirectUri}
                onFocus={(event) => event.currentTarget.select()}
              />
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(query.data.redirectUri);
                    toast.success("URL copiée.");
                  } catch {
                    toast.info("Sélectionne l’URL pour la copier.");
                  }
                }}
              >
                Copier l’URL
              </button>
            </details>
          )}
        </>
      )}
    </section>
  );
}
