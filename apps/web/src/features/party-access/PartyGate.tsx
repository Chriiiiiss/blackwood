import { useQuery } from "@tanstack/react-query";
import { Link, Navigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import styles from "./party-access.module.scss";
import { partyAccessOptions } from "./queries";
export type PartyDestination = "coffre" | "missions";

export function PartyGate({
  destination,
  children,
}: {
  destination: PartyDestination;
  children: ReactNode;
}) {
  const query = useQuery(partyAccessOptions());
  if (query.isPending || query.isError)
    return (
      <PartyCheckState
        pending={query.isPending}
        retry={() => void query.refetch()}
      />
    );
  if (!query.data.isOpen)
    return <Navigate to="/a-ce-soir" search={{ destination }} replace />;
  return children;
}

export function PartyCheckState({
  pending,
  retry,
}: {
  pending: boolean;
  retry: () => void;
}) {
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <p className={styles.eyebrow}>Accès à la soirée</p>
        <h1>Vérification de l’accès</h1>
        {pending ? (
          <p role="status">Vérification de l’heure d’ouverture…</p>
        ) : (
          <>
            <p role="alert">
              Impossible de vérifier l’ouverture pour le moment.
            </p>
            <button type="button" onClick={retry}>
              Réessayer
            </button>
          </>
        )}
        <Link to="/" className={styles.back}>
          ← Retour au hub
        </Link>
      </section>
    </main>
  );
}
