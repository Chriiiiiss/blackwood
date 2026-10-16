import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";
import { guestAccessKey } from "../guest-access/queries";
import { useOrganizerLayout } from "./OrganizerLayout";
import styles from "./organizer.module.scss";
import { organizerHubSettingsQuery } from "./queries";
import { OrganizerRequestError, saveHubSettings } from "./requests";

export function OrganizerHubSettings() {
  const client = useQueryClient();
  const { expire } = useOrganizerLayout();
  const settings = useQuery(organizerHubSettingsQuery());
  const save = useMutation({
    mutationFn: saveHubSettings,
    retry: false,
    onSuccess: (data) => {
      client.setQueryData(organizerHubSettingsQuery().queryKey, data);
      toast.success("Accueil mis à jour.", { id: "hub-settings" });
      void client.invalidateQueries({ queryKey: guestAccessKey });
    },
    onError: (error) => {
      if (!(error instanceof OrganizerRequestError && error.status === 401))
        toast.error(
          "Impossible de confirmer la modification. Vérifie le réglage avant de réessayer.",
          { id: "hub-settings" },
        );
    },
  });
  const error = save.error ?? settings.error;
  useEffect(() => {
    if (error instanceof OrganizerRequestError && error.status === 401)
      expire();
  }, [error, expire]);
  return (
    <section
      className={styles.hubSettings}
      aria-labelledby="hub-settings-title"
    >
      <p className={styles.panelEyebrow}>Accès invité</p>
      <h2 id="hub-settings-title">Accueil du site</h2>
      {settings.isPending ? (
        <p role="status">Chargement de l’accueil…</p>
      ) : settings.isError ? (
        <>
          <p role="alert">Impossible de charger le réglage de l’accueil.</p>
          <button type="button" onClick={() => void settings.refetch()}>
            Réessayer le réglage
          </button>
        </>
      ) : (
        <>
          <label className={styles.hubToggle}>
            <input
              type="checkbox"
              role="switch"
              aria-checked={settings.data.hubEnabled}
              checked={settings.data.hubEnabled}
              disabled={save.isPending}
              onChange={(event) => save.mutate(event.currentTarget.checked)}
            />
            Ouvrir le hub aux invités identifiés
          </label>
          <p className={styles.muted}>
            {settings.data.hubEnabled
              ? "Accueil actuel : Hub"
              : "Accueil actuel : Invitations"}
            . Les accès mémorisés et les réponses sont conservés.
          </p>
          {save.isPending && <p role="status">Enregistrement de l’accueil…</p>}
          {save.isError && (
            <div>
              <button
                type="button"
                onClick={() => {
                  save.reset();
                  void settings.refetch();
                }}
              >
                Actualiser le réglage
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
