import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { toast } from "sonner";
import { Notifications } from "../../src/components/Notifications";
import { ModelPreview } from "../../src/features/coffre/preview/ModelPreview";
import type { FrameId } from "../../src/features/coffre/requests";
import { usePhotoSource } from "../../src/features/coffre/usePhotoSource";
import { PhotoDialog } from "../../src/features/profiles/PhotoDialog";
import "../../src/styles.scss";
import "./prototype.scss";

function Prototype() {
  const [text, setText] = useState(
    "Je nous souhaite encore mille soirées comme celle-ci.",
  );
  const [frame, setFrame] = useState<FrameId>("one-wish-willow");
  const [file, setFile] = useState<File | null>(null);
  const [review, setReview] = useState(false);
  const [visibility, setVisibility] = useState("public");
  const camera = useRef<HTMLInputElement>(null);
  const image = usePhotoSource(file);
  const count = [...text].length;
  function choose(selected?: File) {
    if (!selected) return;
    if (selected.size > 20 * 1024 * 1024) {
      toast.error("Choisis une photo de moins de 20 Mo.");
      return;
    }
    setFile(selected);
    setFrame("plain");
  }
  return (
    <div className="ux-study">
      <header className="ux-study-bar">
        <span>Atelier UX · proposition</span>
        <span>Maquette locale · aucun envoi réel</span>
        <a href="/coffre">Voir la version actuelle ↗</a>
      </header>
      <div className="ux-layout">
        <main className="ux-app">
          <header className="ux-header">
            <a href="/">← Le hub</a>
            <span className="ux-phase">
              <i /> Les dépôts sont ouverts
            </span>
          </header>
          <div className="ux-title">
            <div>
              <p className="ux-kicker">Un morceau de cette nuit</p>
              <h1>
                Le Coffre<span>.</span>
              </h1>
            </div>
            <p className="ux-timer">
              Révélation dans <strong>04 : 32 : 18</strong>
            </p>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setReview(true);
            }}
          >
            <div className="ux-model">
              <ModelPreview
                text={text.trim() || null}
                image={image}
                frameId={frame}
              />
            </div>
            <fieldset className="ux-frames">
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
                    name="ux-frame"
                    checked={frame === id}
                    disabled={id === "one-wish-willow" && !!file}
                    onChange={() => setFrame(id)}
                  />
                  <span>{name}</span>
                </label>
              ))}
            </fieldset>
            <div className="ux-message-label">
              <label htmlFor="ux-message">Un mot pour plus tard.</label>
              <span>{count} / 500</span>
            </div>
            <textarea
              id="ux-message"
              value={text}
              rows={3}
              aria-invalid={count > 500}
              onChange={(event) => setText(event.target.value)}
              placeholder="Un vœu, un souvenir, ce que tu n’as pas encore osé dire…"
            />
            <div className="ux-photo-actions">
              <label className="ux-button ux-secondary">
                <span>{file ? "Remplacer la photo" : "Ajouter une photo"}</span>
                <input
                  type="file"
                  aria-label="Ajouter une photo"
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
                  onChange={(event) => {
                    choose(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
              </label>
              <button
                className="ux-button ux-secondary"
                type="button"
                onClick={() => camera.current?.click()}
              >
                Prendre une photo
              </button>
            </div>
            <input
              ref={camera}
              type="file"
              className="visually-hidden"
              tabIndex={-1}
              aria-label="Photo depuis l’appareil"
              accept="image/*"
              capture="user"
              onChange={(event) => {
                choose(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            {file ? (
              <div className="ux-selected">
                <span>{file.name}</span>
                <button
                  type="button"
                  className="ux-button ux-remove"
                  onClick={() => setFile(null)}
                >
                  Retirer la photo
                </button>
              </div>
            ) : (
              <p className="ux-file-hint">Photo facultative · 20 Mo maximum</p>
            )}
            <button
              type="submit"
              className="ux-button ux-primary"
              disabled={count > 500 || (!text.trim() && !file)}
            >
              Continuer <span aria-hidden="true">→</span>
            </button>
            <p className="ux-next">
              Tu choisiras ensuite à qui confier ton souvenir.
            </p>
          </form>
        </main>
        <aside className="ux-notes" aria-labelledby="ux-notes-title">
          <p className="ux-kicker">Pour notre prochaine revue</p>
          <h2 id="ux-notes-title">
            L’objet d’abord.
            <br />
            Le reste au bon moment.
          </h2>
          <p>
            Une première piste à essayer. La version actuelle et ses règles
            restent la référence tant que cette proposition n’est pas validée.
          </p>
          <ol>
            <li>
              <strong>Le vrai modèle devient le point d’entrée.</strong> Le
              rendu Three.js reste au centre ; les choix d’écrin prennent moins
              de place.
            </li>
            <li>
              <strong>Le compteur explique la phase.</strong> On peut déposer
              maintenant. La révélation arrive plus tard ; « ouverture » ne
              désigne plus deux choses.
            </li>
            <li>
              <strong>Une seule action pour avancer.</strong> Composer, puis
              choisir la visibilité dans la confirmation. Les deux étapes
              gardent le même modèle.
            </li>
            <li>
              <strong>Les choix ont une conséquence claire.</strong> Partagé
              entre invités après révélation, ou réservé à Chris dès l’envoi.
              Jamais d’accès public anonyme.
            </li>
            <li>
              <strong>Plusieurs souvenirs, moins de détours.</strong> Après une
              simulation réussie, le formulaire se vide avec un toast ; il est
              prêt pour la suite.
            </li>
            <li>
              <strong>Les détails se discutent.</strong> Hauteur de la scène,
              indication de manipulation de la scène 3D, saisie au-dessus ou
              sous l’objet, et lecture des longs messages sur téléphone.
            </li>
          </ol>
          <details>
            <summary>Points à conserver pendant la refonte</summary>
            <ul>
              <li>Message/photo restent sur l’appareil avant confirmation.</li>
              <li>
                Un envoi incertain garde exactement le même identifiant et
                contenu pour éviter les doublons.
              </li>
              <li>
                Pas de consultation individuelle, modification ou suppression
                invité après succès.
              </li>
              <li>Le serveur pilote les droits et la fermeture des dépôts.</li>
              <li>
                Repli illustré explicite, clavier et réduction des mouvements.
              </li>
            </ul>
          </details>
          <p className="ux-note-small">
            Le compteur est fictif. Le modèle Three.js est réel. Les imports
            restent dans la mémoire de cette page et le bouton final simule
            uniquement une confirmation.
          </p>
        </aside>
      </div>
      {review && (
        <PhotoDialog
          title="À qui le confier ?"
          eyebrow="Un dernier regard"
          onClose={() => setReview(false)}
        >
          <ModelPreview
            text={text.trim() || null}
            image={image}
            frameId={frame}
            readable
          />
          <fieldset className="ux-visibility">
            <legend className="visually-hidden">Visibilité du souvenir</legend>
            <label>
              <input
                type="radio"
                name="ux-visibility"
                checked={visibility === "public"}
                onChange={() => setVisibility("public")}
              />
              <span>
                <strong>Avec les invités</strong>
                <small>Révélé aux invités et sur la TV à l’échéance.</small>
              </span>
            </label>
            <label>
              <input
                type="radio"
                name="ux-visibility"
                checked={visibility === "private"}
                onChange={() => setVisibility("private")}
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
          <p className="ux-final-note">
            Une fois envoyé, tu ne pourras plus revoir ce dépôt
            individuellement, le modifier ou le supprimer.
          </p>
          <button
            type="button"
            className="ux-button ux-primary"
            onClick={() => {
              setReview(false);
              setText("");
              setFile(null);
              toast.success(
                "Simulation réussie. Aucun souvenir n’a été envoyé.",
              );
            }}
          >
            Simuler le dépôt
          </button>
          <button
            type="button"
            className="ux-button ux-secondary ux-return"
            onClick={() => setReview(false)}
          >
            Revenir à mon souvenir
          </button>
        </PhotoDialog>
      )}
      <Notifications />
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("The UX prototype root is missing.");
createRoot(root).render(<Prototype />);
