import { useEffect, useRef, useState } from "react";
import { ContributionCard } from "../ContributionCard";
import type { FrameId } from "../requests";
import type { createModelPreview } from "./createModelPreview";
import styles from "./model-preview.module.scss";

export function ModelPreview({
  text,
  image,
  frameId,
  readable = false,
}: {
  text: string | null;
  image: string | null;
  frameId: FrameId;
  readable?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const controller = useRef<ReturnType<typeof createModelPreview> | null>(null);
  const mounted = useRef(true);
  const unavailable = useRef(false);
  const [state, setState] = useState<"loading" | "ready" | "fallback">(
    "loading",
  );
  const name = frameId === "one-wish-willow" ? "One Wish Willow" : "Classique";
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      void Promise.all([
        import("./createModelPreview"),
        import("./createPreviewModel"),
      ])
        .then(([viewer, models]) => {
          if (!active || !canvas.current || unavailable.current) return;
          try {
            controller.current ??= viewer.createModelPreview(
              canvas.current,
              (next) => {
                if (mounted.current) setState(next);
              },
            );
            void controller.current.replace(() =>
              models.createPreviewModel(frameId, text, image),
            );
          } catch {
            unavailable.current = true;
            if (active) setState("fallback");
          }
        })
        .catch(() => {
          if (active) setState("fallback");
        });
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [frameId, text, image]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.dispose();
      controller.current = null;
    };
  }, []);
  return (
    <figure
      className={styles.preview}
      aria-label={`Écrin ${name}`}
      data-state={state}
      data-has-photo={!!image}
    >
      <canvas
        ref={canvas}
        className={styles.canvas}
        aria-label={`Modèle 3D ${name}`}
        role="img"
        hidden={state !== "ready"}
      />
      {state === "loading" && (
        <p role="status" className={styles.loading}>
          Ton écrin prend forme…
        </p>
      )}
      {state === "fallback" && (
        <div className={styles.fallback}>
          <ContributionCard
            text={text}
            image={image}
            frameId={frameId}
            preview
          />
          <p>La vue 3D est indisponible. Voici l’aperçu illustré.</p>
        </div>
      )}
      {state === "ready" && (
        <>
          <fieldset className={styles.controls} aria-label="Manipuler l’écrin">
            <button
              type="button"
              aria-label="Tourner à gauche"
              onClick={() => controller.current?.turn(-1)}
            >
              ↶
            </button>
            <button
              type="button"
              aria-label="Tourner à droite"
              onClick={() => controller.current?.turn(1)}
            >
              ↷
            </button>
            <button
              type="button"
              aria-label="Zoomer"
              onClick={() => controller.current?.zoom(0.8)}
            >
              +
            </button>
            <button
              type="button"
              aria-label="Dézoomer"
              onClick={() => controller.current?.zoom(1.25)}
            >
              −
            </button>
            <button
              type="button"
              aria-label="Réinitialiser la vue"
              onClick={() => controller.current?.reset()}
            >
              ⟲
            </button>
          </fieldset>
          <p className={styles.hint}>Glisse pour tourner · pince pour zoomer</p>
        </>
      )}
      {state !== "fallback" && (
        <figcaption
          className={readable && text ? styles.message : "visually-hidden"}
        >
          {text ||
            (frameId === "one-wish-willow"
              ? "Ton vœu prend forme ici…"
              : "Un mot, une photo, un morceau de la soirée.")}
          {image && (
            <span className="visually-hidden"> Photo de ton dépôt.</span>
          )}
        </figcaption>
      )}
    </figure>
  );
}
