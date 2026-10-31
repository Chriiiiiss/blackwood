import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { leaderboardOptions } from "./queries";
import { MissionRequestError } from "./requests";
import { TvLeaderboardRows } from "./TvLeaderboardRows";
import { TvMissionSuccess } from "./TvMissionSuccess";
import styles from "./tv-leaderboard.module.scss";
import { useTvMissionCelebrations } from "./useTvMissionCelebrations";

export function TvLeaderboard({
  phase,
  onAccessLost,
}: {
  phase: "collecting" | "revealed";
  onAccessLost: () => void;
}) {
  const query = useQuery(leaderboardOptions());
  const [page, setPage] = useState(0);
  const [visible, setVisible] = useState(!document.hidden);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  const lost =
    query.error instanceof MissionRequestError && query.error.status === 401;
  const { snapshot, active } = useTvMissionCelebrations(
    query,
    phase === "collecting" && visible && !lost,
  );
  const players = snapshot?.players ?? [];
  const pages = Math.max(1, Math.ceil(players.length / 5));
  useEffect(() => {
    if (pages <= 1 || active || !visible) return;
    const timer = setInterval(
      () => setPage((value) => (value + 1) % pages),
      10_000,
    );
    return () => clearInterval(timer);
  }, [pages, active, visible]);
  useEffect(() => {
    if (!active) return;
    const index = players.findIndex((row) => row.id === active.player.id);
    if (index >= 0) setPage(Math.floor(index / 5));
  }, [active, players]);
  useEffect(() => {
    if (lost) onAccessLost();
  }, [lost, onAccessLost]);
  if (
    lost ||
    !visible ||
    (phase === "revealed" && !query.data?.showScoresWithMemories)
  )
    return null;
  return (
    <aside className={styles.placement} aria-label="Classement des missions">
      <div className={styles.panel}>
        <header>
          <span>Missions</span>
          <span>PTS</span>
        </header>
        {query.isError ? (
          <p className={styles.status}>Scores indisponibles</p>
        ) : query.isPending || !snapshot ? (
          <p className={styles.status}>Chargement…</p>
        ) : !players.length ? (
          <p className={styles.status}>Aucun participant pour le moment.</p>
        ) : (
          <TvLeaderboardRows snapshot={snapshot} page={page % pages} />
        )}
        {pages > 1 && (
          <p className={styles.pagination}>
            {(page % pages) + 1} / {pages}
          </p>
        )}
      </div>
      {phase === "collecting" && !query.isError && active && (
        <TvMissionSuccess key={active.eventId} event={active} />
      )}
    </aside>
  );
}
