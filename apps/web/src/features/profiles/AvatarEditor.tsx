import { useEffect, useRef, useState } from "react";
import type { GuestProfile } from "../guest-access/requests";
import styles from "./profile.module.scss";
import { useProfileMutation } from "./queries";
import { deleteAvatar, profileError, uploadAvatar } from "./requests";

export function AvatarEditor({
  profile,
  embedded = false,
}: {
  profile: GuestProfile;
  embedded?: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [dimensions, setDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [horizontal, setHorizontal] = useState(50);
  const [vertical, setVertical] = useState(50);
  const [feedback, setFeedback] = useState("");
  const [failed, setFailed] = useState(false);
  const [brokenAvatar, setBrokenAvatar] = useState<string | null>(null);
  const guard = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const mutation = useProfileMutation(
    async (operation: "upload" | "delete") => {
      if (operation === "delete") return deleteAvatar();
      if (!file) throw Error("No file selected.");
      const size = dimensions
        ? Math.min(dimensions.width, dimensions.height) / zoom
        : 0;
      return uploadAvatar(
        file,
        dimensions
          ? {
              left:
                ((dimensions.width - size) * horizontal) /
                100 /
                dimensions.width,
              top:
                ((dimensions.height - size) * vertical) /
                100 /
                dimensions.height,
              size: 1 / zoom,
            }
          : undefined,
      );
    },
  );
  useEffect(() => {
    if (!file) {
      setUrl("");
      return;
    }
    const preview = URL.createObjectURL(file);
    setUrl(preview);
    return () => URL.revokeObjectURL(preview);
  }, [file]);
  function clear() {
    setFile(null);
    setDimensions(null);
    setPreviewFailed(false);
    if (input.current) input.current.value = "";
  }
  async function save(operation: "upload" | "delete") {
    if (guard.current) return;
    guard.current = true;
    setFeedback("");
    try {
      await mutation.mutateAsync(operation);
      clear();
      setFailed(false);
      setFeedback(
        operation === "delete"
          ? "Ta photo a été supprimée."
          : "Ta photo a été enregistrée.",
      );
    } catch (error) {
      setFailed(true);
      setFeedback(profileError(error));
    } finally {
      guard.current = false;
    }
  }
  const size = dimensions
    ? Math.min(dimensions.width, dimensions.height) / zoom
    : 1;
  return (
    <section
      className={`${styles.section} ${styles.avatarSection} ${embedded ? styles.embeddedAvatar : ""}`}
      aria-labelledby="avatar-heading"
    >
      <div className={styles.avatarIntro}>
        {profile.avatarMediaId && brokenAvatar !== profile.avatarMediaId ? (
          <img
            className={styles.avatar}
            src={`/api/media/${profile.avatarMediaId}/image`}
            alt="Ton avatar actuel"
            onError={() => setBrokenAvatar(profile.avatarMediaId)}
          />
        ) : (
          <div
            className={styles.avatar}
            role="img"
            aria-label="Avatar par défaut"
          >
            {[...profile.firstName.trim()][0]?.toLocaleUpperCase("fr") ?? "?"}
          </div>
        )}
        <div>
          <h2 id="avatar-heading">Ta photo</h2>
          <p className={styles.hint}>
            Un visage pour ton profil.
            <br />À toi de choisir.
          </p>
        </div>
      </div>
      <div className={styles.uploadControl}>
        <label htmlFor="avatar-file">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <path d="M4 6h4l2-3h4l2 3h4v14H4z" strokeLinejoin="round" />
            <circle cx="12" cy="12" r="3.5" />
          </svg>
          {profile.avatarMediaId ? "Remplacer ma photo" : "Choisir une photo"}
        </label>
        <input
          ref={input}
          id="avatar-file"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
          disabled={mutation.isPending}
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            setFile(null);
            setDimensions(null);
            setPreviewFailed(false);
            setFeedback("");
            if (!chosen) return;
            if (chosen.size > 20 * 1024 * 1024) {
              setFailed(true);
              setFeedback(
                "La photo dépasse 20 Mo. Choisis un fichier plus petit.",
              );
              return;
            }
            setZoom(1);
            setHorizontal(50);
            setVertical(50);
            setFile(chosen);
          }}
        />
      </div>
      <p className={styles.fileHint}>
        Facultative · JPEG, PNG, WebP ou HEIC
        <br />
        20 Mo maximum
      </p>
      {file && (
        <div className={styles.cropEditor}>
          <p>Aperçu avant enregistrement</p>
          {url && (
            <div className={styles.crop} hidden={previewFailed}>
              <img
                key={url}
                src={url}
                alt="Aperçu du cadrage"
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
                        width: `${(dimensions.width / size) * 100}%`,
                        height: `${(dimensions.height / size) * 100}%`,
                        left: `${(-(dimensions.width - size) * horizontal) / size}%`,
                        top: `${(-(dimensions.height - size) * vertical) / size}%`,
                      }
                    : { width: "100%", height: "100%", objectFit: "cover" }
                }
              />
            </div>
          )}
          {previewFailed ? (
            <p role="status">
              Ce navigateur ne peut pas afficher l’aperçu de ce fichier. Tu peux
              l’envoyer : le serveur vérifiera l’image et appliquera un cadrage
              carré centré.
            </p>
          ) : dimensions ? (
            <fieldset disabled={mutation.isPending}>
              <legend>Cadrer ma photo</legend>
              <label htmlFor="avatar-zoom">Zoom</label>
              <input
                id="avatar-zoom"
                type="range"
                min="1"
                max="3"
                step="0.05"
                value={zoom}
                onChange={(event) => setZoom(Number(event.target.value))}
              />
              <label htmlFor="avatar-horizontal">Position horizontale</label>
              <input
                id="avatar-horizontal"
                type="range"
                min="0"
                max="100"
                value={horizontal}
                onChange={(event) => setHorizontal(Number(event.target.value))}
              />
              <label htmlFor="avatar-vertical">Position verticale</label>
              <input
                id="avatar-vertical"
                type="range"
                min="0"
                max="100"
                value={vertical}
                onChange={(event) => setVertical(Number(event.target.value))}
              />
            </fieldset>
          ) : (
            <p role="status">Préparation de l’aperçu…</p>
          )}
          <div className={styles.actions}>
            <button
              className={styles.primaryButton}
              type="button"
              disabled={mutation.isPending || (!dimensions && !previewFailed)}
              onClick={() => void save("upload")}
            >
              {mutation.isPending ? "Traitement…" : "Enregistrer ma photo"}
            </button>
            <button type="button" disabled={mutation.isPending} onClick={clear}>
              Annuler le choix
            </button>
          </div>
        </div>
      )}
      {profile.avatarMediaId && (
        <button
          type="button"
          disabled={mutation.isPending}
          onClick={() => void save("delete")}
          className={styles.textButton}
        >
          Supprimer ma photo
        </button>
      )}
      {feedback && <p role={failed ? "alert" : "status"}>{feedback}</p>}
    </section>
  );
}
