import { type CSSProperties, useLayoutEffect, useRef } from "react";
import styles from "./tv-leaderboard.module.scss";
import type { ScoreSnapshot } from "./useTvMissionCelebrations";

const angles = Array.from({ length: 8 }, (_, index) => (index * Math.PI) / 4);
export function TvLeaderboardRows({
  snapshot,
  page,
}: {
  snapshot: ScoreSnapshot;
  page: number;
}) {
  const list = useRef<HTMLOListElement>(null);
  const positions = useRef(new Map<string, number>());
  const version = useRef(0);
  const previousPage = useRef(page);
  useLayoutEffect(() => {
    const rows = Array.from(list.current?.children ?? []) as HTMLLIElement[];
    const current = new Map(
      rows.map((row) => [
        row.dataset.playerId ?? "",
        row.getBoundingClientRect().top,
      ]),
    );
    const before = positions.current;
    positions.current = current;
    const fresh = version.current !== snapshot.version;
    const turnedPage = previousPage.current !== page;
    previousPage.current = page;
    version.current = snapshot.version;
    if (
      turnedPage ||
      !fresh ||
      !snapshot.successes.length ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const animations: Animation[] = [];
    for (const row of rows) {
      if (typeof row.animate !== "function") continue;
      const id = row.dataset.playerId ?? "";
      const dy =
        (before.get(id) ?? current.get(id) ?? 0) - (current.get(id) ?? 0);
      const success = snapshot.successes.find(
        (event) => event.player.id === id,
      );
      if (success?.overtaken) {
        animations.push(
          row.animate(
            [
              { transform: `translate(0, ${dy}px) scale(1)`, offset: 0 },
              {
                transform: `translate(-5px, ${dy + 2}px) scale(.97)`,
                offset: 0.12,
              },
              {
                transform: `translate(13px, ${dy}px) scale(1.07)`,
                offset: 0.25,
              },
              { transform: "translate(12px, -5px) scale(1.07)", offset: 0.7 },
              { transform: "translate(-2px, 2px) scale(.99)", offset: 0.87 },
              { transform: "translate(0, 0) scale(1)", offset: 1 },
            ],
            { duration: 1000, easing: "cubic-bezier(.2,.65,.3,1)" },
          ),
        );
        const rank = row.querySelector(`.${styles.rank}`);
        if (rank)
          animations.push(
            rank.animate(
              [
                { transform: "scale(1)" },
                { transform: "scale(1.6)" },
                { transform: "scale(.9)" },
                { transform: "scale(1)" },
              ],
              { duration: 650, delay: 680 },
            ),
          );
        if (success.leader) {
          const panel = list.current?.parentElement;
          if (panel)
            animations.push(
              panel.animate(
                [
                  { transform: "translateX(0)" },
                  { transform: "translateX(-3px)" },
                  { transform: "translateX(2px)" },
                  { transform: "translateX(0)" },
                ],
                { duration: 230, delay: 720 },
              ),
            );
        }
      } else if (dy)
        animations.push(
          row.animate(
            [
              { transform: `translateY(${dy}px)`, opacity: 1, offset: 0 },
              { transform: `translateY(${dy}px)`, opacity: 0.6, offset: 0.2 },
              { transform: "translateY(3px)", opacity: 0.8, offset: 0.8 },
              { transform: "translateY(0)", opacity: 1, offset: 1 },
            ],
            { duration: 900, easing: "cubic-bezier(.2,.65,.3,1)" },
          ),
        );
    }
    return () => {
      for (const animation of animations) animation.cancel();
    };
  }, [snapshot, page]);
  return (
    <ol ref={list} start={page * 5 + 1}>
      {snapshot.players.slice(page * 5, page * 5 + 5).map((row) => {
        const success = snapshot.successes.find(
          (event) => event.player.id === row.id,
        );
        return (
          <li
            key={row.id}
            data-player-id={row.id}
            className={
              success
                ? success.overtaken
                  ? styles.overtaking
                  : styles.earned
                : undefined
            }
            data-leader={success?.leader || undefined}
          >
            <span className={styles.rank}>
              {String(row.rank).padStart(2, "0")}
            </span>
            <span className={styles.name}>{row.firstName}</span>
            <strong>{String(row.points).padStart(2, "0")}</strong>
            {success && (
              <span
                key={success.eventId}
                className={styles.pointPop}
                aria-hidden="true"
              >
                +{success.points}
              </span>
            )}
            {!!success?.overtaken &&
              angles.map((angle) => (
                <i
                  key={`${success.eventId}:${angle}`}
                  className={styles.spark}
                  aria-hidden="true"
                  style={
                    {
                      "--dx": `${Math.cos(angle) * 43}px`,
                      "--dy": `${Math.sin(angle) * 30}px`,
                    } as CSSProperties
                  }
                />
              ))}
          </li>
        );
      })}
    </ol>
  );
}
