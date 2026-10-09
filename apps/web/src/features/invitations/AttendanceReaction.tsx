import styles from "./AttendanceReaction.module.scss";
import angryChris from "./assets/angry-chris.jpg";

export function AttendanceReaction() {
  return (
    <div
      className={styles.attendanceReaction}
      data-testid="attendance-reaction"
      aria-hidden="true"
    >
      <img src={angryChris} alt="" width={2316} height={3088} />
    </div>
  );
}
