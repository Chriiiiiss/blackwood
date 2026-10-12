import { Link, Outlet, useMatchRoute } from "@tanstack/react-router";
import styles from "./App.module.scss";

export function App() {
  const isInvitationPage = useMatchRoute()({ to: "/" });

  return (
    <>
      {isInvitationPage && (
        <a href="#guest-register" className={styles.skipLink}>
          Aller au formulaire
        </a>
      )}
      <header className={styles.siteHeader}>
        <Link
          className={styles.wordmark}
          to="/"
          aria-label="Accueil — Hôtel Blackwood"
        >
          <span>Hôtel Blackwood</span>
        </Link>
        <span className={styles.headerNote}>Halloween 2026</span>
      </header>
      <Outlet />
      <footer className={styles.siteFooter}>
        <strong>L’hôtel se prépare encore…</strong>
        <p>Le site évoluera au fil des préparatifs. Repasse faire un tour !</p>
      </footer>
    </>
  );
}
