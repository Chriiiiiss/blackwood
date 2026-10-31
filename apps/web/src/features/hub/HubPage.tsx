import { Link } from "@tanstack/react-router";
import type { GuestProfile } from "../guest-access/requests";
import styles from "./hub.module.scss";

export function HubPage({ profile }: { profile: GuestProfile }) {
  return (
    <main className={styles.page}>
      <p className={styles.eyebrow}>Halloween 2026</p>
      <h1>Bienvenue, {profile.firstName}.</h1>
      <p className={styles.intro}>
        L’hôtel t’ouvre ses portes. Retrouve ici les applis de la soirée.
      </p>
      <nav className={styles.cards} aria-label="Applications de la soirée">
        <Link to="/invitation" className={styles.card}>
          <h2>Mon invitation</h2>
          <p>
            {profile.hasInvitationResponse
              ? "Retrouver ou modifier ma réponse."
              : "Retrouver mon invitation en tant qu’accompagnant."}
          </p>
          <span className={styles.status}>Ouvrir →</span>
        </Link>
        <Link to="/coffre" className={styles.card}>
          <h2>Coffre</h2>
          <p>Confier un message, une photo et les retrouver ensemble.</p>
          <span className={styles.status}>Ouvrir →</span>
        </Link>
        <Link to="/missions" className={styles.card}>
          <h2>Missions secrètes</h2>
          <p>
            Piéger les autres, confirmer leurs exploits et gagner des points.
          </p>
          <span className={styles.status}>Ouvrir →</span>
        </Link>
        <Link to="/profiles" className={styles.card}>
          <h2>Mon profil</h2>
          <p>Modifier mon prénom, ma photo et retrouver mon +1.</p>
          <span className={styles.status}>Ouvrir →</span>
        </Link>
      </nav>
    </main>
  );
}
