import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { leaderboardOptions } from "./queries";
import { MissionRequestError } from "./requests";
import styles from "./tv-leaderboard.module.scss";

export function TvLeaderboard({
  phase,
  onAccessLost,
}: {
  phase: "collecting" | "revealed";
  onAccessLost: () => void;
}) {
  const query = useQuery(leaderboardOptions());
  const [page, setPage] = useState(0);
  const players = query.data?.players ?? [];
  const pages = Math.max(1, Math.ceil(players.length / 5));
  useEffect(() => {
    if (pages <= 1) return;
    const timer = setInterval(
      () => setPage((value) => (value + 1) % pages),
      10_000,
    );
    return () => clearInterval(timer);
  }, [pages]);
  const lost =
    query.error instanceof MissionRequestError && query.error.status === 401;
  useEffect(() => {
    if (lost) onAccessLost();
  }, [lost, onAccessLost]);
  if (
    lost ||
    document.hidden ||
    (phase === "revealed" && !query.data?.showScoresWithMemories)
  )
    return null;
  return (
    <aside className={styles.panel} aria-label="Classement des missions">
      <header>
        <span>Missions</span>
        <span>PTS</span>
      </header>
      {query.isError ? (
        <p className={styles.status}>Scores indisponibles</p>
      ) : query.isPending ? (
        <p className={styles.status}>Chargement…</p>
      ) : !players.length ? (
        <p className={styles.status}>La partie attend ses joueurs.</p>
      ) : (
        <ol start={(page % pages) * 5 + 1}>
          {players
            .slice((page % pages) * 5, (page % pages) * 5 + 5)
            .map((row, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: Stateless scoreboard slots intentionally retain their position as ranks change.
              <li key={index}>
                <span className={styles.rank}>
                  {String(row.rank).padStart(2, "0")}
                </span>
                <span className={styles.name}>{row.firstName}</span>
                <strong>{String(row.points).padStart(2, "0")}</strong>
              </li>
            ))}
        </ol>
      )}
      {pages > 1 && (
        <p className={styles.pagination}>
          {(page % pages) + 1} / {pages}
        </p>
      )}
    </aside>
  );
}
