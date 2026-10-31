import { useQuery } from "@tanstack/react-query";
import { Link, Navigate } from "@tanstack/react-router";
import { PartyCheckState, type PartyDestination } from "./PartyGate";
import styles from "./party-access.module.scss";
import { partyAccessOptions } from "./queries";

export function PartyWaitingPage({
  destination,
}: {
  destination: PartyDestination;
}) {
  const query = useQuery(partyAccessOptions());
  if (query.isPending || query.isError)
    return (
      <PartyCheckState
        pending={query.isPending}
        retry={() => void query.refetch()}
      />
    );
  if (query.data.isOpen)
    return (
      <Navigate
        to={destination === "missions" ? "/missions" : "/coffre"}
        replace
      />
    );
  const time = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    hour: "numeric",
    minute: "2-digit",
  })
    .format(new Date(query.data.opensAt))
    .replace(":", " h ");
  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="party-opening-title">
        <p className={styles.eyebrow}>Hôtel Blackwood · Ce soir</p>
        <span className={styles.mark} aria-hidden="true">
          ✦
        </span>
        <h1 id="party-opening-title">Le Coffre et les Missions secrètes</h1>
        <p className={styles.time}>Ouverture à {time}, heure de Paris.</p>
        <p className={styles.hint}>
          La page s’actualisera automatiquement à l’ouverture.
        </p>
        <Link to="/" className={styles.back}>
          ← Retour au hub
        </Link>
      </section>
    </main>
  );
}
