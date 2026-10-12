import { Link } from "@tanstack/react-router";
import styles from "./organizer.module.scss";
import { useOrganizerAccess } from "./useOrganizerAccess";

const attendanceLabel = { yes: "Oui", no: "Non", to_confirm: "À confirmer" };

export function OrganizerPage() {
  const { view, refresh, signOut } = useOrganizerAccess();
  return (
    <main className={styles.page}>
      <p className={styles.eyebrow}>Espace organisateur</p>
      <h1>Les réponses à l’invitation</h1>
      {view.status === "checking" && (
        <p role="status">Vérification de l’accès et chargement des réponses…</p>
      )}
      {view.status === "error" && (
        <div role="alert">
          <p>Impossible de charger les réponses pour le moment.</p>
          <button
            className={styles.primary}
            type="button"
            onClick={() => void refresh()}
          >
            Réessayer
          </button>
          <p>
            <Link to="/organisateur/connexion">Retour à la connexion</Link>
          </p>
        </div>
      )}
      {view.status === "logging-out" && <p role="status">Déconnexion…</p>}
      {view.status === "logout-error" && (
        <div role="alert">
          <p>
            La déconnexion n’a pas pu être confirmée. Les réponses sont
            masquées.
          </p>
          <button
            className={styles.primary}
            type="button"
            onClick={() => void signOut()}
          >
            Réessayer la déconnexion
          </button>
        </div>
      )}
      {view.status === "ready" && (
        <>
          <div className={styles.actions}>
            <button type="button" onClick={() => void refresh()}>
              Actualiser
            </button>
            <button type="button" onClick={() => void signOut()}>
              Se déconnecter
            </button>
          </div>
          <dl className={styles.totals} aria-label="Totaux des réponses">
            <div>
              <dt>Présents</dt>
              <dd>{view.data.totals.attending}</dd>
            </div>
            <div>
              <dt>À confirmer</dt>
              <dd>{view.data.totals.toConfirm}</dd>
            </div>
            <div>
              <dt>Accompagnants confirmés</dt>
              <dd>{view.data.totals.plusOnes}</dd>
            </div>
          </dl>
          <h2>Réponses ({view.data.responses.length})</h2>
          {view.data.responses.length === 0 ? (
            <p>Aucune réponse pour le moment.</p>
          ) : (
            <ul className={styles.responses}>
              {view.data.responses.map((response, index) => (
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
    </main>
  );
}
