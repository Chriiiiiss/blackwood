import { type PointerEvent, useEffect, useRef, useState } from "react";
import {
  avatarCrop,
  type CropView,
  cropSide,
  type ImageDimensions,
  initialCrop,
  moveCrop,
  type Point,
} from "./avatar-crop";
import { PhotoDialog } from "./PhotoDialog";
import styles from "./photo-dialog.module.scss";

export function AvatarCropDialog({
  file,
  busy,
  onSave,
  onClose,
}: {
  file: File;
  busy: boolean;
  onSave: (crop?: { left: number; top: number; size: number }) => void;
  onClose: () => void;
}) {
  const [url, setUrl] = useState("");
  const [dimensions, setDimensions] = useState<ImageDimensions | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [view, setView] = useState<CropView>(initialCrop);
  const frame = useRef<HTMLButtonElement>(null);
  const pointers = useRef(new Map<number, Point>());
  useEffect(() => {
    const source = URL.createObjectURL(file);
    setUrl(source);
    return () => URL.revokeObjectURL(source);
  }, [file]);
  useEffect(() => {
    const element = frame.current;
    if (!element || !dimensions || busy) return;
    function wheel(event: WheelEvent) {
      event.preventDefault();
      const bounds = element?.getBoundingClientRect();
      if (!bounds?.width) return;
      const point = {
        x: (event.clientX - bounds.left) / bounds.width,
        y: (event.clientY - bounds.top) / bounds.width,
      };
      const delta =
        event.deltaY *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.width : 1);
      setView((previous) =>
        moveCrop(
          previous,
          dimensions as ImageDimensions,
          point,
          point,
          Math.exp(-delta * 0.002),
        ),
      );
    }
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [dimensions, busy]);
  function point(event: PointerEvent<HTMLButtonElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) / bounds.width,
      y: (event.clientY - bounds.top) / bounds.width,
    };
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    if (!dimensions || busy || !pointers.current.has(event.pointerId)) return;
    const before = [...pointers.current.values()];
    pointers.current.set(event.pointerId, point(event));
    const after = [...pointers.current.values()];
    const first = before[0];
    const next = after[0];
    if (!first || !next) return;
    const second = before[1];
    const other = after[1];
    if (second && other) {
      const distance = Math.hypot(first.x - second.x, first.y - second.y);
      const nextDistance = Math.hypot(next.x - other.x, next.y - other.y);
      const oldCenter = {
        x: (first.x + second.x) / 2,
        y: (first.y + second.y) / 2,
      };
      const newCenter = {
        x: (next.x + other.x) / 2,
        y: (next.y + other.y) / 2,
      };
      setView((previous) =>
        moveCrop(
          previous,
          dimensions,
          oldCenter,
          newCenter,
          distance > 0.001 ? nextDistance / distance : 1,
        ),
      );
    } else setView((previous) => moveCrop(previous, dimensions, first, next));
  }
  function zoom(scale: number) {
    if (dimensions)
      setView((previous) =>
        moveCrop(
          previous,
          dimensions,
          { x: 0.5, y: 0.5 },
          { x: 0.5, y: 0.5 },
          scale,
        ),
      );
  }
  const side = dimensions ? cropSide(dimensions, view.zoom) : 1;
  return (
    <PhotoDialog title="Cadre ta photo" busy={busy} onClose={onClose}>
      <p className={styles.hint} id="crop-instructions">
        Glisse la photo pour la placer. Pince avec deux doigts ou utilise la
        molette pour zoomer. Au clavier : flèches pour déplacer, + et − pour
        zoomer.
      </p>
      {url && (
        <button
          ref={frame}
          type="button"
          className={styles.crop}
          aria-label="Déplacer la photo"
          aria-describedby="crop-instructions"
          hidden={previewFailed}
          disabled={busy || !dimensions}
          onPointerDown={(event) => {
            if (
              !dimensions ||
              busy ||
              (event.pointerType === "mouse" && event.button !== 0) ||
              pointers.current.size >= 2
            )
              return;
            event.preventDefault();
            event.currentTarget.focus({ preventScroll: true });
            pointers.current.set(event.pointerId, point(event));
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={move}
          onPointerUp={(event) => pointers.current.delete(event.pointerId)}
          onPointerCancel={(event) => pointers.current.delete(event.pointerId)}
          onLostPointerCapture={(event) =>
            pointers.current.delete(event.pointerId)
          }
          onKeyDown={(event) => {
            const shifts: Record<string, Point> = {
              ArrowLeft: { x: -0.04, y: 0 },
              ArrowRight: { x: 0.04, y: 0 },
              ArrowUp: { x: 0, y: -0.04 },
              ArrowDown: { x: 0, y: 0.04 },
            };
            const shift = shifts[event.key];
            if (shift && dimensions) {
              event.preventDefault();
              setView((previous) =>
                moveCrop(
                  previous,
                  dimensions,
                  { x: 0.5, y: 0.5 },
                  { x: 0.5 + shift.x, y: 0.5 + shift.y },
                ),
              );
            } else if (["+", "=", "-", "_"].includes(event.key)) {
              event.preventDefault();
              zoom(["-", "_"].includes(event.key) ? 1 / 1.2 : 1.2);
            }
          }}
        >
          <img
            src={url}
            alt="Aperçu du cadrage"
            draggable={false}
            onLoad={(event) =>
              setDimensions({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
            onError={() => {
              setDimensions(null);
              setPreviewFailed(true);
            }}
            style={
              dimensions
                ? {
                    width: `${(dimensions.width / side) * 100}%`,
                    height: `${(dimensions.height / side) * 100}%`,
                    left: `${(-(view.x * dimensions.width - side / 2) / side) * 100}%`,
                    top: `${(-(view.y * dimensions.height - side / 2) / side) * 100}%`,
                  }
                : { width: "100%", height: "100%", objectFit: "cover" }
            }
          />
        </button>
      )}
      {previewFailed ? (
        <p role="status">
          Ce navigateur ne peut pas afficher l’aperçu de ce fichier. Tu peux
          l’envoyer : le serveur vérifiera l’image et appliquera un cadrage
          carré centré.
        </p>
      ) : dimensions ? (
        <div className={styles.zoomControls}>
          <button
            type="button"
            aria-label="Réduire le zoom"
            disabled={busy || view.zoom <= 1}
            onClick={() => zoom(1 / 1.2)}
          >
            −
          </button>
          <output aria-label="Niveau de zoom">
            {Math.round(view.zoom * 100)} %
          </output>
          <button
            type="button"
            aria-label="Agrandir"
            disabled={busy || view.zoom >= 4}
            onClick={() => zoom(1.2)}
          >
            +
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setView(initialCrop)}
          >
            Recentrer
          </button>
        </div>
      ) : (
        <p role="status">Préparation de l’aperçu…</p>
      )}
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={busy || (!dimensions && !previewFailed)}
          onClick={() =>
            onSave(dimensions ? avatarCrop(view, dimensions) : undefined)
          }
        >
          {busy ? "Traitement…" : "Enregistrer ma photo"}
        </button>
        <button type="button" disabled={busy} onClick={onClose}>
          Annuler le choix
        </button>
      </div>
    </PhotoDialog>
  );
}
