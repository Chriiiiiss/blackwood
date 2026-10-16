import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useOrganizerLayout } from "./OrganizerLayout";
import styles from "./organizer.module.scss";
import accessStyles from "./profile-access.module.scss";
import { organizerProfileAccessQuery } from "./queries";
import {
  disableGuestAccess,
  issueGuestCode,
  OrganizerRequestError,
  type ProfileAccess,
} from "./requests";

export function OrganizerProfileAccessPage() {
  const { expire } = useOrganizerLayout();
  const profiles = useQuery({
    ...organizerProfileAccessQuery(),
    refetchOnWindowFocus: false,
  });
  const [issued, setIssued] = useState<{
    profileId: string;
    name: string;
    code: string;
  } | null>(null);
  const submitting = useRef(false);
  const mounted = useRef(true);
  const mutation = useMutation({
    mutationFn: async ({
      profileId,
      disable,
    }: {
      profileId: string;
      disable: boolean;
    }) => {
      if (!disable) return issueGuestCode(profileId);
      await disableGuestAccess(profileId);
      return null;
    },
    retry: false,
    gcTime: 0,
  });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (
      profiles.error instanceof OrganizerRequestError &&
      profiles.error.status === 401
    )
      expire();
  }, [profiles.error, expire]);

  async function change(profile: ProfileAccess, disable: boolean) {
    if (submitting.current) return;
    submitting.current = true;
    setIssued(null);
    try {
      const result = await mutation.mutateAsync({
        profileId: profile.id,
        disable,
      });
      if (!mounted.current) return;
      if (result)
        setIssued({
          profileId: profile.id,
          name: profile.firstName,
          code: result.code,
        });
      else
        toast.success(
          `L’accès de ${profile.firstName} est désactivé. Ses sessions sont révoquées.`,
        );
      await profiles.refetch();
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof OrganizerRequestError && error.status === 401)
        expire();
      else
        toast.error(
          "Impossible de modifier cet accès. Réessaie. Si la génération a abouti, une nouvelle génération remplacera le code perdu.",
        );
    } finally {
      mutation.reset();
      submitting.current = false;
    }
  }

  return (
    <section aria-labelledby="profile-access-title">
      <h2 id="profile-access-title">Les clés des invités</h2>
      <p>
        Génère un code personnel, puis transmets-le à la bonne personne. Il
        permet de retrouver son profil sur un autre navigateur.
      </p>
      <p>
        Régénérer remplace l’ancien code et conserve les sessions ouvertes.
        Désactiver révoque toutes les sessions et bloque la reprise depuis
        l’ancien navigateur ; un nouveau code sera nécessaire.
      </p>
      {profiles.isPending && <p role="status">Chargement des profils…</p>}
      {profiles.isError && (
        <div role="alert">
          <p>Impossible de charger les profils.</p>
          <button type="button" onClick={() => void profiles.refetch()}>
            Réessayer
          </button>
        </div>
      )}
      {issued && (
        <div className={accessStyles.issued} role="status">
          <h3>Code de {issued.name}</h3>
          <p>
            Ce code ne sera plus affiché après fermeture. Copie-le pour le
            transmettre.
          </p>
          <code className={accessStyles.code}>{issued.code}</code>
          <button type="button" onClick={() => setIssued(null)}>
            Masquer le code
          </button>
        </div>
      )}
      {profiles.data &&
        !profiles.error &&
        (profiles.data.length ? (
          <ul className={styles.responses}>
            {profiles.data.map((profile) => (
              <li key={profile.id} className={styles.response}>
                <h3>{profile.firstName}</h3>
                <p>
                  {profile.role === "companion"
                    ? "Accompagnant"
                    : "Invité principal"}{" "}
                  ·{" "}
                  {!profile.accessEnabled
                    ? "Accès désactivé"
                    : profile.codeEnabled
                      ? "Code actif"
                      : "Aucun code généré"}
                </p>
                <div className={accessStyles.actions}>
                  <button
                    type="button"
                    className={styles.primary}
                    disabled={mutation.isPending}
                    onClick={() => void change(profile, false)}
                  >
                    {profile.codeEnabled
                      ? "Régénérer le code"
                      : "Générer un code"}
                  </button>
                  {profile.accessEnabled && (
                    <button
                      type="button"
                      disabled={mutation.isPending}
                      onClick={() => void change(profile, true)}
                    >
                      Désactiver l’accès
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p>Aucun profil pour le moment.</p>
        ))}
    </section>
  );
}
