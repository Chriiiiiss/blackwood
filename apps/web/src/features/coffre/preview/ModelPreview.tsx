import { useEffect, useId, useRef, useState } from "react";
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
  const instructions = useId();
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
        aria-describedby={instructions}
        role="img"
        tabIndex={state === "ready" ? 0 : -1}
        onKeyDown={(event) => {
          const viewer = controller.current;
          if (!viewer) return;
          switch (event.key) {
            case "ArrowLeft":
              viewer.turn(-1);
              break;
            case "ArrowRight":
              viewer.turn(1);
              break;
            case "+":
            case "=":
              viewer.zoom(0.8);
              break;
            case "-":
              viewer.zoom(1.25);
              break;
            case "Home":
              viewer.reset();
              break;
            default:
              return;
          }
          event.preventDefault();
        }}
        hidden={state !== "ready"}
      />
      {state === "loading" && (
        <p role="status" className={styles.loading}>
          Chargement de l’aperçu…
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
          <p className={styles.hint}>
            Scène 3D · glisse pour tourner, pince pour zoomer
          </p>
          <p id={instructions} className={styles.keyboardHint}>
            Au clavier : ← / → pour tourner, + / − pour zoomer, Début pour
            réinitialiser.
          </p>
        </>
      )}
      {state !== "fallback" && (
        <figcaption
          className={readable && text ? styles.message : "visually-hidden"}
        >
          {text ||
            (frameId === "one-wish-willow"
              ? "Ton vœu ici"
              : "Ton message ou ta photo ici")}
          {image && (
            <span className="visually-hidden"> Photo de ton dépôt.</span>
          )}
        </figcaption>
      )}
    </figure>
  );
}
