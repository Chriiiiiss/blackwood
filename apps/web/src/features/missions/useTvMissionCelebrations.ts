import type { UseQueryResult } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { Leaderboard, LeaderboardPlayer } from "./requests";

export interface MissionSuccess {
  eventId: string;
  player: LeaderboardPlayer;
  previousRank: number;
  points: number;
  overtaken: number;
  leader: boolean;
}
export interface ScoreSnapshot {
  players: LeaderboardPlayer[];
  successes: MissionSuccess[];
  version: number;
}

export function useTvMissionCelebrations(
  query: UseQueryResult<Leaderboard>,
  enabled: boolean,
) {
  const [snapshot, setSnapshot] = useState<ScoreSnapshot>();
  const [queue, setQueue] = useState<MissionSuccess[]>([]);
  const previous = useRef<LeaderboardPlayer[] | undefined>(undefined);
  const processed = useRef(0);
  const { data, dataUpdatedAt, isError, isFetchedAfterMount } = query;
  useEffect(() => {
    if (!enabled || isError) {
      previous.current = undefined;
      processed.current = dataUpdatedAt;
      setQueue([]);
      if (data)
        setSnapshot({
          players: data.players,
          successes: [],
          version: dataUpdatedAt,
        });
      return;
    }
    // Cached data is not a live baseline after mounting or returning to the TV.
    if (!data || !isFetchedAfterMount || processed.current === dataUpdatedAt)
      return;
    processed.current = dataUpdatedAt;
    const before = previous.current;
    const successes: MissionSuccess[] = [];
    if (before) {
      for (const player of data.players) {
        const old = before.find((row) => row.id === player.id);
        const points = player.points - (old?.points ?? 0);
        if (points <= 0) continue;
        const overtaken = old
          ? before.filter((row) => {
              const current = data.players.find((next) => next.id === row.id);
              return (
                row.id !== player.id &&
                row.points >= old.points &&
                current &&
                current.points < player.points
              );
            }).length
          : 0;
        successes.push({
          eventId: `${dataUpdatedAt}:${player.id}`,
          player,
          previousRank: old?.rank ?? player.rank,
          points,
          overtaken,
          leader:
            overtaken > 0 &&
            data.players.every(
              (row) => row.id === player.id || row.points < player.points,
            ),
        });
      }
    }
    previous.current = data.players;
    setSnapshot({ players: data.players, successes, version: dataUpdatedAt });
    setQueue((pending) => [
      ...pending.filter((event) =>
        data.players.some((row) => row.id === event.player.id),
      ),
      ...successes,
    ]);
  }, [data, dataUpdatedAt, isError, isFetchedAfterMount, enabled]);
  const active = queue[0];
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(
      () =>
        setQueue((pending) =>
          pending.filter((event) => event.eventId !== active.eventId),
        ),
      4000,
    );
    return () => clearTimeout(timer);
  }, [active]);
  return { snapshot, active };
}
