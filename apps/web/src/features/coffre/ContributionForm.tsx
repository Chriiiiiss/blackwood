import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CameraDialog } from "../profiles/CameraDialog";
import { PhotoDialog } from "../profiles/PhotoDialog";
import { ContributionCard } from "./ContributionCard";
import styles from "./coffre.module.scss";
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
  const [sent, setSent] = useState(false);
  const guard = useRef(false);
  const mounted = useRef(true);
  const nativeCamera = useRef<HTMLInputElement>(null);
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
      setDraft(newDraft());
      setSent(true);
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
  if (sent)
    return (
      <section className={styles.stateCard}>
        <p className={styles.eyebrow}>Un morceau de la soirée, bien gardé</p>
        <h2>Et si on en gardait un autre ?</h2>
        <p>Les souvenirs publics se retrouveront à l’ouverture.</p>
        <button
          type="button"
          className={styles.primary}
          onClick={() => setSent(false)}
        >
          Ajouter un autre souvenir
        </button>
      </section>
    );
  return (
    <>
      <section className={styles.composer} aria-labelledby="deposit-title">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>À glisser dans le Coffre</p>
            <h2 id="deposit-title">Qu’est-ce qu’on garde ?</h2>
          </div>
          <span className={styles.optional}>
            Un message, une photo, ou les deux.
          </span>
        </div>
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
          <fieldset className={styles.editorFields} disabled={editingDisabled}>
            <label htmlFor="coffre-message" className={styles.label}>
              Ton message
            </label>
            <textarea
              id="coffre-message"
              rows={4}
              value={draft.text}
              onChange={(event) =>
                setDraft((previous) => ({
                  ...previous,
                  text: event.target.value,
                }))
              }
              placeholder="Un vœu, un secret de soirée, un mot pour plus tard…"
              aria-describedby="coffre-count"
              aria-invalid={length > 500}
            />
            <p
              id="coffre-count"
              className={styles.counter}
              data-invalid={length > 500}
            >
              {length > 500 ? "500 caractères maximum · " : "Facultatif · "}
              {length} / 500
            </p>
            {draft.file && (
              <div className={styles.selectedPhoto}>
                {source && (
                  <img
                    key={source}
                    src={source}
                    alt="Sélection pour ce dépôt"
                    onError={(event) => {
                      event.currentTarget.hidden = true;
                    }}
                  />
                )}
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
            <div className={styles.photoActions}>
              <label className={styles.upload}>
                <span>
                  {draft.file ? "Remplacer la photo" : "Choisir une photo"}
                </span>
                <input
                  type="file"
                  aria-label={
                    draft.file ? "Remplacer la photo" : "Choisir une photo"
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
            <p className={styles.hint}>
              JPEG, PNG, WebP ou HEIC · 20 Mo maximum.
            </p>
            <fieldset className={styles.choices}>
              <legend>Choisis son écrin</legend>
              <label>
                <input
                  type="radio"
                  name="frame"
                  value="plain"
                  checked={draft.frameId === "plain"}
                  onChange={() =>
                    setDraft((previous) => ({ ...previous, frameId: "plain" }))
                  }
                />
                <span>
                  <strong>Classique</strong>
                  <small>Les mots et les images.</small>
                </span>
              </label>
              <label>
                <input
                  type="radio"
                  name="frame"
                  value="one-wish-willow"
                  checked={draft.frameId === "one-wish-willow"}
                  disabled={!!draft.file}
                  onChange={() =>
                    setDraft((previous) => ({
                      ...previous,
                      frameId: "one-wish-willow",
                    }))
                  }
                />
                <span>
                  <strong>One Wish Willow</strong>
                  <small>Un vœu, en mots seulement.</small>
                </span>
              </label>
            </fieldset>
            <fieldset className={styles.choices}>
              <legend>À qui le confier ?</legend>
              <label>
                <input
                  type="radio"
                  name="visibility"
                  value="public"
                  checked={draft.visibility === "public"}
                  onChange={() =>
                    setDraft((previous) => ({
                      ...previous,
                      visibility: "public",
                    }))
                  }
                />
                <span>
                  <strong>À partager</strong>
                  <small>Révélé aux invités et sur la TV à l’ouverture.</small>
                </span>
              </label>
              <label>
                <input
                  type="radio"
                  name="visibility"
                  value="private"
                  checked={draft.visibility === "private"}
                  onChange={() =>
                    setDraft((previous) => ({
                      ...previous,
                      visibility: "private",
                    }))
                  }
                />
                <span>
                  <strong>Pour Chris</strong>
                  <small>Privé, consultable par Chris dès l’envoi.</small>
                </span>
              </label>
            </fieldset>
            {draft.visibility === "private" && (
              <p className={styles.privacy}>
                Ce souvenir ne sera partagé ni sur la télévision, ni dans la
                liste des invités.
              </p>
            )}
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
            {attempt ? "Retrouver l’envoi à confirmer" : "Voir l’aperçu"}
            <span aria-hidden="true"> →</span>
          </button>
          <p className={styles.hint}>
            Après envoi, tu ne pourras plus revoir ce dépôt individuellement, le
            modifier ou le supprimer.
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
          title="Un dernier regard"
          eyebrow="Avant de confier ton souvenir"
          busy={mutation.isPending}
          onClose={() => {
            setPreview(false);
            toast.dismiss("coffre-error");
          }}
        >
          <ContributionCard
            text={current.text.trim() || null}
            image={source}
            frameId={current.frameId}
            preview
          />
          <p className={styles.previewVisibility}>
            {current.visibility === "private"
              ? "Pour Chris uniquement · jamais sur la TV ni dans la liste publique."
              : "À partager · révélé aux invités et sur la TV à l’ouverture."}
          </p>
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
              {attempt ? "Revenir au dépôt" : "Revenir à mon brouillon"}
            </button>
          </div>
        </PhotoDialog>
      )}
    </>
  );
}
