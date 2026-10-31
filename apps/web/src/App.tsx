import { useQuery } from "@tanstack/react-query";
import { Link, Outlet, useMatchRoute } from "@tanstack/react-router";
import styles from "./App.module.scss";
import { ActivityTracker } from "./features/activity/ActivityTracker";
import { guestAccessOptions } from "./features/guest-access/queries";

export function App() {
  const matchRoute = useMatchRoute();
  const isTvPage = matchRoute({ to: "/coffre/tv" });
  const isInvitationPage = matchRoute({ to: "/invitation" });
  const isOrganizerPage =
    matchRoute({ to: "/organisateur", fuzzy: true }) &&
    !matchRoute({ to: "/organisateur/connexion" });
  const access = useQuery({ ...guestAccessOptions(), enabled: false });
  const home =
    isInvitationPage && !(access.data?.hubEnabled && access.data.profile)
      ? "/invitation"
      : "/";

  return (
    <>
      <ActivityTracker />
      {isInvitationPage &&
        !(
          access.data?.profile && !access.data.profile.hasInvitationResponse
        ) && (
          <a href="#guest-register" className={styles.skipLink}>
            Aller au formulaire
          </a>
        )}
      {!isOrganizerPage && !isTvPage && (
        <header className={styles.siteHeader}>
          <Link
            className={styles.wordmark}
            to={home}
            aria-label="Accueil — Hôtel Blackwood"
          >
            <span>Hôtel Blackwood</span>
          </Link>
          <span className={styles.headerNote}>Halloween 2026</span>
        </header>
      )}
      <Outlet />
      {!isOrganizerPage && !isTvPage && (
        <footer className={styles.siteFooter}>
          <p>31 octobre 2026</p>
        </footer>
      )}
    </>
  );
}
