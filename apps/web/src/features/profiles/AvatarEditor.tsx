import { useRef, useState } from "react";
import { toast } from "sonner";
import type { GuestProfile } from "../guest-access/requests";
import { AvatarCropDialog } from "./AvatarCropDialog";
import { CameraDialog } from "./CameraDialog";
import { ProfileNameEditor } from "./ProfileNameEditor";
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
  const [cameraOpen, setCameraOpen] = useState(false);
  const [brokenAvatar, setBrokenAvatar] = useState<string | null>(null);
  const guard = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const mutation = useProfileMutation(
    async (
      operation:
        | {
            kind: "upload";
            file: File;
            crop?: { left: number; top: number; size: number };
          }
        | { kind: "delete" },
    ) =>
      operation.kind === "delete"
        ? deleteAvatar()
        : uploadAvatar(operation.file, operation.crop),
  );
  function clear() {
    setFile(null);
    if (input.current) input.current.value = "";
  }
  function choose(chosen?: File) {
    clear();
    if (!chosen) return;
    if (chosen.size > 20 * 1024 * 1024) {
      toast.error("La photo dépasse 20 Mo. Choisis un fichier plus petit.", {
        id: "avatar",
      });
      return;
    }
    setFile(chosen);
  }
  async function save(
    operation: "upload" | "delete",
    crop?: { left: number; top: number; size: number },
  ) {
    if (guard.current || (operation === "upload" && !file)) return;
    guard.current = true;
    try {
      await mutation.mutateAsync(
        operation === "delete"
          ? { kind: "delete" }
          : { kind: "upload", file: file as File, ...(crop ? { crop } : {}) },
      );
      clear();
      toast.success(
        operation === "delete"
          ? "Ta photo a été supprimée."
          : "Ta photo a été enregistrée.",
        { id: "avatar" },
      );
    } catch (error) {
      toast.error(profileError(error), {
        id: operation === "upload" ? "avatar-error" : "avatar",
        ...(operation === "upload" ? { toasterId: "photo-dialog" } : {}),
      });
    } finally {
      guard.current = false;
    }
  }
  return (
    <section
      className={`${styles.section} ${styles.avatarSection} ${embedded ? styles.embeddedAvatar : ""}`}
      aria-label="Ton identité"
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
        <ProfileNameEditor profile={profile} />
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
          aria-label={
            profile.avatarMediaId ? "Remplacer ma photo" : "Choisir une photo"
          }
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
          disabled={mutation.isPending}
          onChange={(event) => choose(event.target.files?.[0])}
        />
      </div>
      <button
        type="button"
        className={styles.cameraButton}
        disabled={mutation.isPending}
        onClick={() => {
          if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
            cameraInput.current?.click();
          else setCameraOpen(true);
        }}
      >
        Prendre une photo
      </button>
      <input
        ref={cameraInput}
        className="visually-hidden"
        type="file"
        accept="image/*"
        capture="user"
        tabIndex={-1}
        aria-label="Photo depuis l’appareil photo"
        onChange={(event) => {
          choose(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      {cameraOpen && (
        <CameraDialog
          onClose={() => setCameraOpen(false)}
          onCapture={(captured) => {
            setCameraOpen(false);
            choose(captured);
          }}
        />
      )}
      {file && (
        <AvatarCropDialog
          file={file}
          busy={mutation.isPending}
          onSave={(crop) => void save("upload", crop)}
          onClose={() => {
            clear();
          }}
        />
      )}
      {profile.avatarMediaId && (
        <button
          type="button"
          disabled={mutation.isPending}
          onClick={() => void save("delete")}
          className={styles.destructiveButton}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <path
              d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Supprimer ma photo
        </button>
      )}
    </section>
  );
}
