import styles from "./tv-leaderboard.module.scss";
import type { MissionSuccess } from "./useTvMissionCelebrations";

export function TvMissionSuccess({ event }: { event: MissionSuccess }) {
  const action = event.leader
    ? "prend la tête !"
    : event.overtaken
      ? `dépasse ${event.overtaken} ${event.overtaken === 1 ? "joueur" : "joueurs"} !`
      : event.points === 1
        ? "a réussi une mission"
        : `a réussi ${event.points} missions`;
  return (
    <div
      className={styles.notification}
      data-overtake={!!event.overtaken}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className={styles.noticeBody}>
        <span className={styles.check} aria-hidden="true">
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m5 12 4 4L19 6" />
          </svg>
        </span>
        <div>
          <p>
            <b>{event.player.firstName}</b> {action}
          </p>
          <small>
            +{event.points} {event.points === 1 ? "point" : "points"}
            {event.player.rank < event.previousRank &&
              ` · ${String(event.previousRank).padStart(2, "0")} → ${String(event.player.rank).padStart(2, "0")}`}
          </small>
        </div>
      </div>
      <div className={styles.life} aria-hidden="true" />
    </div>
  );
}
