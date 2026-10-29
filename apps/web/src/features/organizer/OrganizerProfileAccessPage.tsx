import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PhotoDialog } from "../profiles/PhotoDialog";
import { useOrganizerLayout } from "./OrganizerLayout";
import styles from "./organizer.module.scss";
import accessStyles from "./profile-access.module.scss";
import {
  organizerProfileAccessQuery,
  organizerResponsesQuery,
} from "./queries";
import {
  disableGuestAccess,
  issueGuestCode,
  OrganizerRequestError,
  type ProfileAccess,
  removeGuestProfile,
} from "./requests";

export function OrganizerProfileAccessPage() {
  const { expire } = useOrganizerLayout();
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState<ProfileAccess | null>(null);
  const remove = useMutation({
    mutationFn: removeGuestProfile,
    retry: false,
    gcTime: 0,
  });
  const profiles = useQuery({
    ...organizerProfileAccessQuery(),
    refetchOnWindowFocus: false,
  });
  const [search, setSearch] = useState("");
  const visibleProfiles = profiles.data?.filter((profile) =>
    profile.firstName
      .toLocaleLowerCase("fr")
      .includes(search.trim().toLocaleLowerCase("fr")),
  );
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

  async function confirmRemoval() {
    if (!removing || submitting.current) return;
    submitting.current = true;
    const target = removing;
    try {
      await remove.mutateAsync(target.id);
      if (!mounted.current) return;
      setRemoving(null);
      toast.success(`Le profil de ${target.firstName} a été supprimé.`);
      await Promise.all([
        profiles.refetch(),
        queryClient.invalidateQueries({
          queryKey: organizerResponsesQuery().queryKey,
        }),
      ]);
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof OrganizerRequestError && error.status === 401)
        expire();
      else
        toast.error("Impossible de confirmer la suppression. Réessaie.", {
          toasterId: "photo-dialog",
        });
    } finally {
      remove.reset();
      submitting.current = false;
    }
  }

  return (
    <section aria-labelledby="profile-access-title">
      <h2 id="profile-access-title">Les invités</h2>
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
      {profiles.data && !profiles.error && profiles.data.length > 0 && (
        <label className={accessStyles.search}>
          Rechercher un invité
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Son prénom…"
          />
        </label>
      )}
      {profiles.data &&
        !profiles.error &&
        (visibleProfiles?.length ? (
          <ul className={styles.responses}>
            {visibleProfiles.map((profile) => (
              <li key={profile.id} className={styles.response}>
                <h3>{profile.firstName}</h3>
                <p className={accessStyles.identity}>
                  {profile.relatedFirstName
                    ? profile.role === "companion"
                      ? `Accompagne ${profile.relatedFirstName}`
                      : `Vient avec ${profile.relatedFirstName}`
                    : profile.role === "companion"
                      ? "Profil indépendant"
                      : "Sans accompagnant inscrit"}
                  {" · "}
                  <span>Réf. {profile.id.slice(0, 8)}</span>
                </p>
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
                    disabled={mutation.isPending || remove.isPending}
                    onClick={() => void change(profile, false)}
                  >
                    {profile.codeEnabled
                      ? "Régénérer le code"
                      : "Générer un code"}
                  </button>
                  {profile.accessEnabled && (
                    <button
                      type="button"
                      disabled={mutation.isPending || remove.isPending}
                      onClick={() => void change(profile, true)}
                    >
                      Désactiver l’accès
                    </button>
                  )}
                  <button
                    type="button"
                    className={accessStyles.destructive}
                    disabled={mutation.isPending || remove.isPending}
                    onClick={(event) => {
                      event.currentTarget.focus({ preventScroll: true });
                      setIssued(null);
                      setRemoving(profile);
                    }}
                  >
                    Supprimer le profil
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p>
            {profiles.data.length
              ? "Aucun invité ne correspond à ta recherche."
              : "Aucun profil pour le moment."}
          </p>
        ))}
      {removing && (
        <PhotoDialog
          title={`Supprimer le profil de ${removing.firstName} ?`}
          eyebrow="Gestion des invités"
          busy={remove.isPending}
          onClose={() => setRemoving(null)}
        >
          <p className={accessStyles.identity}>
            Réf. {removing.id.slice(0, 8)}
          </p>
          <p>
            Ses codes et ses sessions seront révoqués. Ses souvenirs et leurs
            photos resteront dans les Coffres.
          </p>
          {removing.role === "main" && (
            <p>
              Sa réponse aux invitations sera retirée de la liste et des totaux.
            </p>
          )}
          {removing.relatedFirstName && (
            <p>
              {removing.role === "companion"
                ? `${removing.relatedFirstName} pourra inviter un autre +1 avec un nouveau lien.`
                : `${removing.relatedFirstName} conservera son propre profil et ses accès.`}
            </p>
          )}
          <div className={accessStyles.confirmActions}>
            <button
              type="button"
              className={accessStyles.destructive}
              disabled={remove.isPending}
              onClick={() => void confirmRemoval()}
            >
              {remove.isPending ? "Suppression…" : "Confirmer la suppression"}
            </button>
            <button
              type="button"
              disabled={remove.isPending}
              onClick={() => setRemoving(null)}
            >
              Annuler
            </button>
          </div>
        </PhotoDialog>
      )}
    </section>
  );
}
