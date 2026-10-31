import { Link } from "@tanstack/react-router";
import type { GuestProfile } from "../guest-access/requests";
import { AvatarEditor } from "./AvatarEditor";
import { CompanionPanel } from "./CompanionPanel";
import styles from "./profile.module.scss";

export function ProfilePage({ profile }: { profile: GuestProfile }) {
  return (
    <main className={styles.page}>
      <div className={styles.topbar}>
        <Link to="/" className={styles.back}>
          ← Retour au hub
        </Link>
        <span className={styles.roleBadge}>
          {profile.role === "main" ? "Invité principal" : "Accompagnant"}
        </span>
      </div>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Profil invité</p>
        <h1>
          Mon profil<span aria-hidden="true">.</span>
        </h1>
        <p>Ton prénom et ta photo, dans les applis de la soirée.</p>
      </header>
      <div className={styles.identityCard}>
        <AvatarEditor profile={profile} embedded />
      </div>
      {profile.role === "main" && <CompanionPanel />}
      <aside className={styles.accessFooter}>
        <p className={styles.accessTitle}>Sur un autre appareil</p>
        <p className={styles.hint}>
          Sur un autre appareil, retrouve ce profil avec le code personnel
          transmis par Chris.
        </p>
        <nav className={styles.actions} aria-label="Accès et invitation">
          <Link to="/login" className={styles.back}>
            Retrouver mon profil par code
          </Link>
          <Link to="/invitation" className={styles.back}>
            Mon invitation
          </Link>
        </nav>
      </aside>
    </main>
  );
}
