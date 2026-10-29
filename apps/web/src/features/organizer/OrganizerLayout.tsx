import { Link, Outlet } from "@tanstack/react-router";
import { createContext, useContext, useEffect, useState } from "react";
import type { ComposerStore } from "../coffre/composer-state";
import { OrganizerHubSettings } from "./OrganizerHubSettings";
import styles from "./organizer.module.scss";
import { useOrganizerAccess } from "./useOrganizerAccess";

type OrganizerAccess = Pick<
  ReturnType<typeof useOrganizerAccess>,
  "refresh" | "expire"
> & {
  coffreComposer: ComposerStore;
  selectedCoffre: [number | undefined, (id: number) => void];
};
const OrganizerContext = createContext<OrganizerAccess | null>(null);

export function useOrganizerLayout() {
  const access = useContext(OrganizerContext);
  if (!access)
    throw new Error("Organizer sections require the private layout.");
  return access;
}

export function OrganizerLayout() {
  const { view, refresh, signOut, expire } = useOrganizerAccess();
  const coffreComposer: ComposerStore = useState({});
  const selectedCoffre = useState<number>();
  const resetComposer = coffreComposer[1];
  useEffect(() => {
    if (view.status === "logging-out") resetComposer({});
  }, [view.status]);
  if (view.status === "ready")
    return (
      <div className={styles.dashboard}>
        <aside className={styles.sidebar} aria-label="Espace organisateur">
          <Link
            to="/"
            className={styles.brand}
            aria-label="Accueil — Hôtel Blackwood"
          >
            <span>Hôtel</span>
            Blackwood
          </Link>
          <p className={styles.navigationLabel}>Organisation</p>
          <nav
            className={styles.navigation}
            aria-label="Applications organisateur"
          >
            <Link
              to="/organisateur/invitations"
              activeProps={{ "aria-current": "page" }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="3" />
                <path d="m4 7 8 6 8-6" />
              </svg>
              Invitations
            </Link>
            <Link
              to="/organisateur/acces"
              activeProps={{ "aria-current": "page" }}
            >
              Invités
            </Link>
            <Link
              to="/organisateur/coffre"
              activeProps={{ "aria-current": "page" }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="4" y="8" width="16" height="12" rx="3" />
                <path d="M8 8V6a4 4 0 0 1 8 0v2M12 13v3" />
              </svg>
              Coffre
            </Link>
          </nav>
          <div className={styles.sidebarFooter}>
            <Link to="/" className={styles.siteLink}>
              Voir le site invité <span aria-hidden="true">↗</span>
            </Link>
            <button type="button" onClick={() => void signOut()}>
              Se déconnecter
            </button>
            <p>Halloween 2026</p>
          </div>
        </aside>
        <main className={styles.workspace}>
          <header className={styles.dashboardHeader}>
            <div>
              <p className={styles.eyebrow}>Hôtel Blackwood / Organisation</p>
              <h1>Tableau de bord</h1>
              <p className={styles.muted}>
                Gère les invitations, les accès et les souvenirs de la soirée.
              </p>
            </div>
            <span className={styles.privateBadge}>Espace privé</span>
          </header>
          <OrganizerContext.Provider
            value={{ refresh, expire, coffreComposer, selectedCoffre }}
          >
            <div className={styles.workspaceGrid}>
              <div className={styles.sectionContent}>
                <Outlet />
              </div>
              <aside
                className={styles.controlRail}
                aria-label="Réglages du site"
              >
                <OrganizerHubSettings />
              </aside>
            </div>
          </OrganizerContext.Provider>
        </main>
      </div>
    );
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
    </main>
  );
}
