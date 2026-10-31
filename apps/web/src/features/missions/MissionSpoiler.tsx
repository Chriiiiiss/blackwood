import { useEffect, useId, useState } from "react";
import styles from "./missions.module.scss";

export function MissionSpoiler({
  text,
  label = "Ta mission secrète",
}: {
  text: string;
  label?: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const id = useId();
  useEffect(() => {
    const hide = () => {
      if (document.hidden) setRevealed(false);
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", hide);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", hide);
    };
  }, []);
  return (
    <>
      <div className={styles.missionCard}>
        <p className={styles.cardLabel}>{label}</p>
        <p
          id={id}
          className={`${styles.missionText} ${!revealed ? styles.concealed : ""}`}
          aria-hidden={!revealed}
        >
          {text}
        </p>
      </div>
      <button
        className={styles.reveal}
        type="button"
        aria-controls={id}
        aria-expanded={revealed}
        onClick={() => setRevealed((value) => !value)}
      >
        {revealed ? "Masquer la mission" : "Afficher la mission"}
      </button>
    </>
  );
}
