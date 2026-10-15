import { Link, Outlet } from "@tanstack/react-router";
import { createContext, useContext } from "react";
import styles from "./organizer.module.scss";
import { useOrganizerAccess } from "./useOrganizerAccess";

type OrganizerAccess = Pick<
  ReturnType<typeof useOrganizerAccess>,
  "refresh" | "expire"
>;
const OrganizerContext = createContext<OrganizerAccess | null>(null);

export function useOrganizerLayout() {
  const access = useContext(OrganizerContext);
  if (!access)
    throw new Error("Organizer sections require the private layout.");
  return access;
}

export function OrganizerLayout() {
  const { view, refresh, signOut, expire } = useOrganizerAccess();
  return (
    <main className={styles.page}>
      <p className={styles.eyebrow}>Hôtel Blackwood</p>
      <h1>Espace organisateur</h1>
      {view.status === "checking" && (
        <p role="status">Vérification de l’accès…</p>
      )}
      {view.status === "error" && (
        <div role="alert">
          <p>Impossible de vérifier l’accès pour le moment.</p>
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
            La déconnexion n’a pas pu être confirmée. Les données privées sont
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
            <button type="button" onClick={() => void signOut()}>
              Se déconnecter
            </button>
          </div>
          <nav
            className={styles.navigation}
            aria-label="Applications organisateur"
          >
            <Link
              to="/organisateur/invitations"
              activeProps={{ "aria-current": "page" }}
            >
              Invitations
            </Link>
            <button type="button" disabled>
              Coffre <span className={styles.unavailable}>À venir</span>
            </button>
          </nav>
          <OrganizerContext.Provider value={{ refresh, expire }}>
            <Outlet />
          </OrganizerContext.Provider>
        </>
      )}
    </main>
  );
}
