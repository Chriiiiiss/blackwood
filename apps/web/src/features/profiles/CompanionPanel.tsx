import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import styles from "./profile.module.scss";
import { companionOptions } from "./queries";
import { issueCompanion, profileError } from "./requests";

export function CompanionPanel() {
  const status = useQuery(companionOptions());
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: issueCompanion,
    retry: false,
    gcTime: 0,
  });
  const [link, setLink] = useState("");
  const [expires, setExpires] = useState("");
  const [feedback, setFeedback] = useState("");
  const guard = useRef(false);
  return (
    <section className={styles.section} aria-labelledby="companion-heading">
      <h2 id="companion-heading">Ton +1</h2>
      {status.isPending ? (
        <p role="status">Je retrouve ton +1…</p>
      ) : status.isError ? (
        <div>
          <p role="alert">{profileError(status.error)}</p>
          <button type="button" onClick={() => void status.refetch()}>
            Réessayer
          </button>
        </div>
      ) : status.data.companion ? (
        <p>
          {status.data.companion.firstName} a déjà son propre profil. Pour un
          retrait ou un remplacement, contacte Chris.
        </p>
      ) : !status.data.eligible ? (
        <p>
          Pour inviter ton +1, indique que tu viens à deux dans{" "}
          <Link to="/invitation">ta réponse</Link>.
        </p>
      ) : (
        <>
          <p>
            Ton +1 renseigne lui-même son prénom et sa photo depuis le lien que
            tu lui transmets, sur son propre navigateur.
          </p>
          <button
            type="button"
            disabled={mutation.isPending}
            onClick={async () => {
              if (guard.current) return;
              guard.current = true;
              setFeedback("");
              try {
                const result = await mutation.mutateAsync();
                setLink(
                  `${window.location.origin}/companions/${result.mainProfileId}#token=${result.token}`,
                );
                setExpires(
                  new Date(result.expiresAt).toLocaleDateString("fr-FR"),
                );
              } catch (error) {
                setFeedback(profileError(error));
                await client.invalidateQueries({
                  queryKey: companionOptions().queryKey,
                });
              } finally {
                mutation.reset();
                guard.current = false;
              }
            }}
          >
            {mutation.isPending
              ? "Création du lien…"
              : link
                ? "Remplacer le lien"
                : "Créer le lien pour mon +1"}
          </button>
          {link && (
            <div>
              <label htmlFor="companion-link">
                Lien à transmettre à ton +1
              </label>
              <input
                id="companion-link"
                readOnly
                value={link}
                onFocus={(event) => event.target.select()}
              />
              <p className={styles.hint}>
                Valable jusqu’au {expires}, pour une seule création. Un nouveau
                lien invalide le précédent. Garde-le pour la personne que tu
                invites.
              </p>
              <div className={styles.actions}>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(link);
                      setFeedback(
                        "Lien copié. Tu peux le transmettre à ton +1.",
                      );
                    } catch {
                      setFeedback(
                        "Sélectionne le lien ci-dessus et copie-le manuellement.",
                      );
                    }
                  }}
                >
                  Copier le lien
                </button>
                <button type="button" onClick={() => setLink("")}>
                  Masquer le lien
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {feedback && <p role="status">{feedback}</p>}
    </section>
  );
}
