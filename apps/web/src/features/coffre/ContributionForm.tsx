import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CameraDialog } from "../profiles/CameraDialog";
import { PhotoDialog } from "../profiles/PhotoDialog";
import styles from "./coffre.module.scss";
import { ModelPreview } from "./preview/ModelPreview";
import {
  CoffreRequestError,
  type ContributionDraft,
  coffreError,
  depositContribution,
  newDraft,
} from "./requests";
import { usePhotoSource } from "./usePhotoSource";

export function ContributionForm({
  collecting,
  closed,
  canReadState,
  onStateChange,
}: {
  profileId: string;
  collecting: boolean;
  closed: boolean;
  canReadState: boolean;
  onStateChange: () => void;
}) {
  const [draft, setDraft] = useState(newDraft);
  const [attempt, setAttempt] = useState<ContributionDraft | null>(null);
  const [preview, setPreview] = useState(false);
  const [camera, setCamera] = useState(false);
  const guard = useRef(false);
  const mounted = useRef(true);
  const nativeCamera = useRef<HTMLInputElement>(null);
  const messageInput = useRef<HTMLTextAreaElement>(null);
  const navigate = useNavigate();
  const mutation = useMutation({
    mutationFn: depositContribution,
    retry: false,
    gcTime: 0,
    networkMode: "always",
  });
  const current = attempt ?? draft;
  const source = usePhotoSource(current.file);
  const length = [...draft.text].length;
  const editingDisabled = mutation.isPending || !!attempt || !collecting;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      toast.dismiss("coffre-error");
    };
  }, []);
  function choose(file?: File) {
    if (!file || editingDisabled) return;
    if (file.size > 20 * 1024 * 1024) {
      toast.error("La photo dépasse 20 Mo. Choisis un fichier plus petit.");
      return;
    }
    if (draft.frameId === "one-wish-willow")
      toast.info("Le cadre Classique est utilisé pour accueillir ta photo.");
    setDraft((previous) => ({ ...previous, file, frameId: "plain" }));
  }
  async function send() {
    if (guard.current || (!attempt && !collecting)) return;
    guard.current = true;
    const submitted = attempt ?? { ...draft };
    setAttempt(submitted);
    try {
      await mutation.mutateAsync(submitted);
      if (!mounted.current) return;
      setPreview(false);
      setAttempt(null);
      setDraft({
        ...newDraft(),
        frameId: submitted.frameId,
        visibility: submitted.visibility,
      });
      requestAnimationFrame(() =>
        messageInput.current?.focus({ preventScroll: true }),
      );
      toast.success("Ton souvenir a trouvé sa place dans le Coffre.", {
        id: "coffre-success",
      });
      onStateChange();
    } catch (error) {
      if (!mounted.current) return;
      if (
        error instanceof CoffreRequestError &&
        (error.status === 401 || error.code === "HUB_CLOSED")
      ) {
        setPreview(false);
        await navigate({
          to: error.status === 401 ? "/login" : "/invitation",
          replace: true,
        });
        return;
      }
      // Unknown outcomes must retry the identical payload/UUID; a lost receipt may follow a committed insert.
      if (
        error instanceof CoffreRequestError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.code !== "CONTRIBUTION_CONFLICT"
      )
        setAttempt(null);
      if (
        error instanceof CoffreRequestError &&
        [
          "COFFRE_REVEALED",
          "COFFRE_NOT_PREPARED",
          "COFFRE_NOT_COLLECTING",
        ].includes(error.code)
      ) {
        setPreview(false);
        onStateChange();
        toast.error(coffreError(error));
      } else
        toast.error(coffreError(error), {
          id: "coffre-error",
          toasterId: "photo-dialog",
        });
    } finally {
      mutation.reset();
      guard.current = false;
    }
  }
  if ((!collecting || !canReadState) && !attempt) return null;
  return (
    <>
      <section className={styles.composer} aria-labelledby="deposit-title">
        <h2 id="deposit-title" className="visually-hidden">
          Déposer un souvenir
        </h2>
        {attempt && !mutation.isPending && (
          <p className={styles.recovery}>
            L’envoi reste à confirmer. Réessaie avec ce même dépôt : il ne sera
            pas enregistré deux fois.
          </p>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (
              attempt ||
              (collecting && length <= 500 && (draft.text.trim() || draft.file))
            )
              setPreview(true);
          }}
        >
          <section
            className={styles.framePreview}
            aria-label="Aperçu de ton écrin"
          >
            <ModelPreview
              key={current.id}
              text={current.text.trim() || null}
              image={source}
              frameId={current.frameId}
            />
          </section>
          <fieldset className={styles.editorFields} disabled={editingDisabled}>
            <fieldset className={styles.frames}>
              <legend className="visually-hidden">Choisis ton écrin</legend>
              {(
                [
                  ["plain", "Classique"],
                  ["one-wish-willow", "One Wish Willow"],
                ] as const
              ).map(([id, name]) => (
                <label key={id}>
                  <input
                    type="radio"
                    name="frame"
                    checked={draft.frameId === id}
                    disabled={id === "one-wish-willow" && !!draft.file}
                    onChange={() =>
                      setDraft((previous) => ({ ...previous, frameId: id }))
                    }
                  />
                  <span>{name}</span>
                </label>
              ))}
            </fieldset>
            <div className={styles.messageHeading}>
              <label htmlFor="coffre-message">Un mot pour plus tard.</label>
              <p
                id="coffre-count"
                className={styles.counter}
                data-invalid={length > 500}
              >
                {length > 500 ? "500 caractères maximum · " : ""}
                {length} / 500
              </p>
            </div>
            <textarea
              ref={messageInput}
              id="coffre-message"
              rows={3}
              value={draft.text}
              onChange={(event) =>
                setDraft((previous) => ({
                  ...previous,
                  text: event.target.value,
                }))
              }
              placeholder="Un vœu, un souvenir, ce que tu n’as pas encore osé dire…"
              aria-describedby="coffre-count"
              aria-invalid={length > 500}
            />
            <div className={styles.photoActions}>
              <label className={styles.upload}>
                <span>
                  {draft.file ? "Remplacer la photo" : "Ajouter une photo"}
                </span>
                <input
                  type="file"
                  aria-label={
                    draft.file ? "Remplacer la photo" : "Ajouter une photo"
                  }
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
                  onChange={(event) => {
                    choose(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
              </label>
              <button
                type="button"
                className={styles.secondary}
                onClick={() => {
                  if (
                    !window.isSecureContext ||
                    !navigator.mediaDevices?.getUserMedia
                  )
                    nativeCamera.current?.click();
                  else setCamera(true);
                }}
              >
                Prendre une photo
              </button>
            </div>
            {draft.file && (
              <div className={styles.selectedPhoto}>
                <span>{draft.file.name}</span>
                <button
                  type="button"
                  className={styles.destructive}
                  onClick={() =>
                    setDraft((previous) => ({ ...previous, file: null }))
                  }
                >
                  Retirer la photo
                </button>
              </div>
            )}
            <p className={styles.hint}>
              Photo facultative · JPEG, PNG, WebP ou HEIC · 20 Mo maximum.
            </p>
          </fieldset>
          <button
            type="submit"
            className={styles.primary}
            disabled={
              mutation.isPending ||
              (!attempt &&
                (!collecting ||
                  length > 500 ||
                  (!draft.text.trim() && !draft.file)))
            }
          >
            {attempt ? "Retrouver l’envoi à confirmer" : "Continuer"}
            <span aria-hidden="true"> →</span>
          </button>
          <p className={styles.next}>
            Tu choisiras ensuite à qui confier ton souvenir.
          </p>
        </form>
      </section>
      <input
        ref={nativeCamera}
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
      {camera && collecting && (
        <CameraDialog
          hint="La photo reste sur ton appareil. Tu pourras vérifier ton souvenir avant de l’envoyer."
          onClose={() => setCamera(false)}
          onCapture={(file) => {
            setCamera(false);
            choose(file);
          }}
        />
      )}
      {preview && (!closed || attempt) && (
        <PhotoDialog
          title="À qui le confier ?"
          eyebrow="Un dernier regard"
          busy={mutation.isPending}
          onClose={() => {
            setPreview(false);
            toast.dismiss("coffre-error");
          }}
        >
          <ModelPreview
            text={current.text.trim() || null}
            image={source}
            frameId={current.frameId}
            readable
          />
          <fieldset
            className={styles.choices}
            disabled={mutation.isPending || !!attempt}
          >
            <legend className="visually-hidden">Visibilité du souvenir</legend>
            <label>
              <input
                type="radio"
                name="visibility"
                value="public"
                checked={current.visibility === "public"}
                onChange={() =>
                  setDraft((previous) => ({
                    ...previous,
                    visibility: "public",
                  }))
                }
              />
              <span>
                <strong>Avec les invités</strong>
                <small>Révélé aux invités et sur la TV à l’échéance.</small>
              </span>
            </label>
            <label>
              <input
                type="radio"
                name="visibility"
                value="private"
                checked={current.visibility === "private"}
                onChange={() =>
                  setDraft((previous) => ({
                    ...previous,
                    visibility: "private",
                  }))
                }
              />
              <span>
                <strong>Juste pour Chris</strong>
                <small>
                  Consultable dès l’envoi. Jamais dans la liste collective ni
                  sur la TV.
                </small>
              </span>
            </label>
          </fieldset>
          <p className={styles.hint}>
            Une fois envoyé, ce dépôt ne pourra plus être revu individuellement,
            modifié ou supprimé.
          </p>
          <div className={styles.previewActions}>
            <button
              type="button"
              className={styles.primary}
              disabled={mutation.isPending}
              onClick={() => void send()}
            >
              {mutation.isPending
                ? "On le met à l’abri…"
                : attempt
                  ? "Réessayer le même envoi"
                  : "Confier au Coffre"}
            </button>
            <button
              type="button"
              className={styles.secondary}
              disabled={mutation.isPending}
              onClick={() => {
                setPreview(false);
                toast.dismiss("coffre-error");
              }}
            >
              {attempt ? "Revenir au dépôt" : "Revenir à mon souvenir"}
            </button>
          </div>
        </PhotoDialog>
      )}
    </>
  );
}
