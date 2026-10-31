import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";
import { useOrganizerLayout } from "../organizer/OrganizerLayout";
import styles from "./organizer-settings.module.scss";
import { tvMissionSettingsOptions } from "./queries";
import { MissionRequestError, saveTvMissionSettings } from "./requests";

export function OrganizerMissionSettings() {
  const client = useQueryClient();
  const { expire } = useOrganizerLayout();
  const query = useQuery(tvMissionSettingsOptions());
  const save = useMutation({
    mutationFn: saveTvMissionSettings,
    retry: false,
    onSuccess: (data) => {
      client.setQueryData(tvMissionSettingsOptions().queryKey, data);
      toast.success("Affichage des scores mis à jour.");
    },
    onError: (error) => {
      if (!(error instanceof MissionRequestError && error.status === 401))
        toast.error(
          "Impossible de confirmer le réglage. Actualise-le avant de réessayer.",
        );
    },
  });
  const error = save.error ?? query.error;
  useEffect(() => {
    if (error instanceof MissionRequestError && error.status === 401) expire();
  }, [error, expire]);
  return (
    <div className={styles.settings}>
      <h4>Le classement des missions</h4>
      {query.isPending ? (
        <p role="status">Chargement du réglage…</p>
      ) : query.isError ? (
        <>
          <p role="alert">Impossible de lire le réglage des scores.</p>
          <button type="button" onClick={() => void query.refetch()}>
            Réessayer le réglage des scores
          </button>
        </>
      ) : (
        <>
          <label>
            <input
              type="checkbox"
              role="switch"
              checked={query.data.showScoresWithMemories}
              aria-checked={query.data.showScoresWithMemories}
              disabled={save.isPending}
              onChange={(event) => save.mutate(event.currentTarget.checked)}
            />
            Afficher le classement avec les souvenirs
          </label>
          <p>
            Les scores accompagnent toujours le compte à rebours. Après
            l’ouverture du Coffre, tu choisis de les garder à l’écran.
          </p>
          {save.isError && (
            <button
              type="button"
              onClick={() => {
                save.reset();
                void query.refetch();
              }}
            >
              Actualiser le réglage des scores
            </button>
          )}
        </>
      )}
    </div>
  );
}
