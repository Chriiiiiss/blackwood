import { useQuery } from "@tanstack/react-query";
import { type RefObject, useEffect, useState } from "react";
import { currentTrackOptions } from "./queries";
import { SpotifyRequestError, type SpotifyTrack } from "./requests";
import { SpotifyMark } from "./SpotifyMark";
import styles from "./tv-now-playing.module.scss";

export function TvNowPlaying({
  lastTrackId,
  onAccessLost,
}: {
  lastTrackId: RefObject<string | null>;
  onAccessLost: () => void;
}) {
  const query = useQuery(currentTrackOptions());
  const [active, setActive] = useState<SpotifyTrack | null>(null);
  const [brokenCover, setBrokenCover] = useState<string | null>(null);
  useEffect(() => {
    if (
      query.error instanceof SpotifyRequestError &&
      query.error.status === 401
    )
      onAccessLost();
    const track = query.data?.track;
    if (query.isError || !track || document.hidden) {
      setActive(null);
      return;
    }
    if (track.id !== lastTrackId.current) {
      lastTrackId.current = track.id;
      setActive(track);
      setBrokenCover(null);
    }
  }, [query.data, query.isError, query.error, lastTrackId, onAccessLost]);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setActive(null), 6000);
    return () => clearTimeout(timer);
  }, [active]);
  useEffect(() => {
    const hide = () => {
      if (document.hidden) setActive(null);
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);
  if (!active || document.hidden) return null;
  return (
    <aside
      key={active.id}
      className={styles.alert}
      aria-label="Morceau en cours"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <a
        className={styles.inner}
        href={active.spotifyUrl}
        target="_blank"
        rel="noopener noreferrer"
      >
        <div className={styles.coverWrap}>
          {active.coverUrl && brokenCover !== active.id ? (
            <img
              className={styles.cover}
              src={active.coverUrl}
              alt={`Pochette de ${active.title}`}
              width="92"
              height="92"
              onError={() => setBrokenCover(active.id)}
            />
          ) : (
            <span className={styles.placeholder} aria-hidden="true">
              ♫
            </span>
          )}
        </div>
        <div className={styles.metadata}>
          <div className={styles.label}>
            <SpotifyMark />
            <span>Spotify</span>
            <span className={styles.wave} aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
            <span className={styles.playing}>En écoute</span>
          </div>
          <h2>{active.title}</h2>
          <p>{active.artists.join(", ")}</p>
        </div>
      </a>
      <div className={styles.life} aria-hidden="true" />
    </aside>
  );
}
