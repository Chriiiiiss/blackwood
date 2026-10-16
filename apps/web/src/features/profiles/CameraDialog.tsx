import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PhotoDialog } from "./PhotoDialog";
import styles from "./photo-dialog.module.scss";

export function CameraDialog({
  onCapture,
  onClose,
}: {
  onCapture: (file: File) => void;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    let stream: MediaStream | undefined;
    let active = true;
    mounted.current = true;
    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia)
          throw Error("CAMERA_UNAVAILABLE");
        const acquired = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 1280 },
          },
          audio: false,
        });
        if (!active) {
          acquired.getTracks().forEach((track) => {
            track.stop();
          });
          return;
        }
        stream = acquired;
        if (video.current) {
          video.current.srcObject = acquired;
          await video.current.play();
        }
      } catch (caught) {
        if (!active) return;
        stream?.getTracks().forEach((track) => {
          track.stop();
        });
        const name = caught instanceof Error ? caught.name : "";
        setError(
          "La caméra n’est pas disponible. Tu peux choisir une photo depuis ton appareil.",
        );
        toast.error(
          name === "NotAllowedError"
            ? "L’accès à la caméra a été refusé. Autorise-le dans ton navigateur, ou ferme cette fenêtre pour choisir une photo."
            : name === "NotFoundError"
              ? "Aucune caméra disponible. Tu peux fermer cette fenêtre et choisir une photo."
              : "Impossible d’ouvrir la caméra. Ferme cette fenêtre et choisis une photo depuis ton appareil.",
          { id: "camera", toasterId: "photo-dialog" },
        );
      }
    }
    void start();
    return () => {
      active = false;
      mounted.current = false;
      stream?.getTracks().forEach((track) => {
        track.stop();
      });
    };
  }, []);
  async function capture() {
    const element = video.current;
    if (!element || !ready || busy) return;
    setBusy(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = element.videoWidth;
      canvas.height = element.videoHeight;
      const context = canvas.getContext("2d");
      if (!context || !canvas.width || !canvas.height)
        throw Error("CAMERA_UNAVAILABLE");
      context.drawImage(element, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.92),
      );
      if (!blob) throw Error("CAMERA_UNAVAILABLE");
      if (mounted.current)
        onCapture(
          new File([blob], "blackwood-avatar.jpg", { type: "image/jpeg" }),
        );
    } catch {
      if (mounted.current)
        toast.error(
          "Impossible de prendre la photo. Réessaie ou choisis un fichier.",
          { id: "camera", toasterId: "photo-dialog" },
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <PhotoDialog title="Prends la pose" busy={busy} onClose={onClose}>
      <p className={styles.hint}>
        La photo reste sur ton appareil jusqu’à sa validation. Tu pourras la
        cadrer juste après.
      </p>
      <video
        ref={video}
        className={styles.camera}
        autoPlay
        muted
        playsInline
        aria-label="Aperçu de la caméra"
        onLoadedData={() => setReady(true)}
        hidden={!!error}
      />
      {error ? (
        <p role="alert">{error}</p>
      ) : !ready ? (
        <p role="status">Ouverture de la caméra…</p>
      ) : null}
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={!ready || busy || !!error}
          onClick={() => void capture()}
        >
          Prendre la photo
        </button>
        <button type="button" disabled={busy} onClick={onClose}>
          Annuler
        </button>
      </div>
    </PhotoDialog>
  );
}
