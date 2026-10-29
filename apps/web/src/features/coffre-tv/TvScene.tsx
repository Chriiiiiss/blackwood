import { useEffect, useRef, useState } from "react";
import { ContributionCard } from "../coffre/ContributionCard";
import type { PublicContribution } from "../coffre/requests";
import type { createTvScene } from "./createTvScene";
import styles from "./tv.module.scss";

export function TvScene({
  items,
  onPhotoFailure,
}: {
  items: PublicContribution[];
  onPhotoFailure: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const controller = useRef<ReturnType<typeof createTvScene> | null>(null);
  const latest = useRef(items);
  latest.current = items;
  const photoFailure = useRef(onPhotoFailure);
  photoFailure.current = onPhotoFailure;
  const [status, setStatus] = useState<"loading" | "ready" | "fallback">(
    "loading",
  );
  const [displayed, setDisplayed] = useState<PublicContribution[]>([]);
  const [focused, setFocused] = useState<PublicContribution | null>(null);
  const [restart, setRestart] = useState(0);
  useEffect(() => {
    let active = true;
    setStatus("loading");
    if (canvas.current) canvas.current.dataset.attempt = String(restart);
    void import("./createTvScene")
      .then((module) => {
        if (!active || !canvas.current) return;
        try {
          controller.current = module.createTvScene(
            canvas.current,
            (next, focus) => {
              if (active) {
                setDisplayed(next);
                setFocused(focus);
              }
            },
            () => {
              controller.current?.dispose();
              controller.current = null;
              if (active) setStatus("fallback");
            },
            () => photoFailure.current(),
          );
          controller.current.setItems(latest.current);
          setStatus("ready");
        } catch {
          if (active) setStatus("fallback");
        }
      })
      .catch(() => {
        if (active) setStatus("fallback");
      });
    return () => {
      active = false;
      controller.current?.dispose();
      controller.current = null;
    };
  }, [restart]);
  useEffect(() => {
    controller.current?.setItems(items);
  }, [items]);
  useEffect(() => {
    if (status !== "fallback" || !items.length) return;
    let index = 0;
    setDisplayed(items.slice(0, 1));
    const interval = setInterval(() => {
      index = (index + 1) % items.length;
      setDisplayed(items.slice(index, index + 1));
    }, 30_000);
    return () => clearInterval(interval);
  }, [status, items]);
  const long = (focused?.text?.length ?? 0) > 180;
  return (
    <section
      className={styles.projection}
      aria-label="Projection des souvenirs"
      data-state={status}
    >
      <canvas
        key={restart}
        ref={canvas}
        className={styles.canvas}
        role="img"
        aria-label="Les souvenirs flottent en trois dimensions"
        hidden={status === "fallback"}
      />
      {status === "loading" && (
        <p className={styles.sceneLoading} role="status">
          La scène prend vie…
        </p>
      )}
      {status === "ready" && (
        <>
          <ul className="visually-hidden" aria-label="Souvenirs affichés">
            {displayed.map((item) => (
              <li key={item.id}>
                {item.text}
                {item.photoMediaId && " · Une photo de la soirée"}
              </li>
            ))}
          </ul>
          {long && (
            <div className={styles.longText}>
              <p>{focused?.text}</p>
            </div>
          )}
        </>
      )}
      {status === "fallback" && (
        <div className={styles.fallback}>
          <p role="status">
            La 3D n’est pas disponible sur ce navigateur. Voici un affichage de
            secours.
          </p>
          {displayed.map((item) => (
            <div className={styles.fallbackCard} key={item.id}>
              <ContributionCard
                text={item.text}
                image={
                  item.photoMediaId
                    ? `/api/tv/coffre/media/${encodeURIComponent(item.photoMediaId)}/image`
                    : null
                }
                frameId={item.frameId}
              />
            </div>
          ))}
          <button
            type="button"
            onClick={() => setRestart((value) => value + 1)}
          >
            Réessayer la 3D
          </button>
        </div>
      )}
    </section>
  );
}
