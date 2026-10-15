import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useOrganizerLayout } from "./OrganizerLayout";
import styles from "./organizer.module.scss";
import { organizerResponsesQuery } from "./queries";
import { OrganizerRequestError } from "./requests";

const attendanceLabel = { yes: "Oui", no: "Non", to_confirm: "À confirmer" };

export function OrganizerInvitationsPage() {
  const { refresh, expire } = useOrganizerLayout();
  const { data, error, isPending } = useQuery({
    ...organizerResponsesQuery(),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const unauthenticated =
    error instanceof OrganizerRequestError && error.status === 401;
  useEffect(() => {
    if (unauthenticated) expire();
  }, [unauthenticated, expire]);

  return (
    <section aria-labelledby="invitations-title">
      <div className={styles.sectionHeader}>
        <h2 id="invitations-title">Les réponses à l’invitation</h2>
        {data && !error && (
          <button type="button" onClick={() => void refresh()}>
            Actualiser
          </button>
        )}
      </div>
      {(isPending || unauthenticated) && (
        <p role="status">Chargement des réponses…</p>
      )}
      {error && !unauthenticated && (
        <div role="alert">
          <p>Impossible de charger les réponses pour le moment.</p>
          <button
            className={styles.primary}
            type="button"
            onClick={() => void refresh()}
          >
            Réessayer
          </button>
        </div>
      )}
      {data && !error && (
        <>
          <dl className={styles.totals} aria-label="Totaux des réponses">
            <div>
              <dt>Présents</dt>
              <dd>{data.totals.attending}</dd>
            </div>
            <div>
              <dt>À confirmer</dt>
              <dd>{data.totals.toConfirm}</dd>
            </div>
            <div>
              <dt>Accompagnants confirmés</dt>
              <dd>{data.totals.plusOnes}</dd>
            </div>
            <div>
              <dt>Réponses reçues</dt>
              <dd>{data.responses.length}</dd>
            </div>
          </dl>
          <div className={styles.responseListHeader}>
            <h2>Réponses ({data.responses.length})</h2>
            <span className={styles.readOnly}>Consultation seule</span>
          </div>
          {data.responses.length === 0 ? (
            <p>Aucune réponse pour le moment.</p>
          ) : (
            <ul className={styles.responses}>
              {data.responses.map((response, index) => (
                <li
                  key={
                    // biome-ignore lint/suspicious/noArrayIndexKey: Read-only cards remount on refresh; guest capability IDs stay private.
                    index
                  }
                  className={styles.response}
                >
                  <h3>{response.firstName}</h3>
                  <dl>
                    <div>
                      <dt>Présence</dt>
                      <dd>{attendanceLabel[response.attendance]}</dd>
                    </div>
                    <div>
                      <dt>Accompagnant</dt>
                      <dd>{response.plusOne ? "Oui" : "Non"}</dd>
                    </div>
                  </dl>
                  {response.ideas && (
                    <p className={styles.idea}>
                      <span>Idée</span>
                      {response.ideas}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
