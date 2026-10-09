import styles from "./App.module.scss";
import { InvitationPage } from "./features/invitations";

export function App() {
  return (
    <>
      <a href="#guest-register" className={styles.skipLink}>
        Aller au formulaire
      </a>
      <header className={styles.siteHeader}>
        <a
          className={styles.wordmark}
          href="/"
          aria-label="Accueil — Hôtel Blackwood"
        >
          <span>Hôtel Blackwood</span>
        </a>
        <span className={styles.headerNote}>Halloween 2026</span>
      </header>
      <InvitationPage />
      <footer className={styles.siteFooter}>
        <strong>L’hôtel se prépare encore…</strong>
        <p>Le site évoluera au fil des préparatifs. Repasse faire un tour !</p>
      </footer>
    </>
  );
}
