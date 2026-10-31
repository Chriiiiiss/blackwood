import { Link } from "@tanstack/react-router";
import styles from "./NotFoundPage.module.scss";

export function NotFoundPage() {
  return (
    <main className={styles.page}>
      <h1>Page introuvable</h1>
      <p>Cette page n’existe pas.</p>
      <Link to="/invitation">Retour à l’invitation</Link>
    </main>
  );
}
