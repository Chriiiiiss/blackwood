import { useQuery } from "@tanstack/react-query";
import { Link, Navigate } from "@tanstack/react-router";
import { guestAccessOptions } from "../guest-access/queries";
import type { GuestAccess } from "../guest-access/requests";
import { InvitationPage } from "../invitations";
import { StorageUnavailableError } from "../invitations/response-storage";
import { HubPage } from "./HubPage";
import styles from "./hub.module.scss";

type Destination = "hub" | "invitation" | "profile";

export function GuestPage({ destination }: { destination: Destination }) {
  const access = useQuery(guestAccessOptions());
  if (access.isPending || (destination !== "invitation" && access.isFetching))
    return (
      <main className={styles.page}>
        <h1>Un petit instant…</h1>
        <p role="status">Je retrouve ton accès…</p>
      </main>
    );
  const errorState = access.isError ? (
    <main className={styles.page}>
      <h1>On réessaie ?</h1>
      <p role="alert">
        {access.error instanceof StorageUnavailableError
          ? "Autorise le stockage dans ton navigateur pour retrouver ta réponse, puis réessaie."
          : "Impossible de retrouver ton accès. Réessaie."}
      </p>
      <button type="button" onClick={() => void access.refetch()}>
        Réessayer
      </button>
    </main>
  ) : null;
  if (!access.data || (access.isError && destination !== "invitation"))
    return errorState;
  return (
    <>
      {errorState}
      <div hidden={access.isError}>
        <GuestContent destination={destination} access={access.data} />
      </div>
    </>
  );
}

function GuestContent({
  destination,
  access,
}: {
  destination: Destination;
  access: GuestAccess;
}) {
  const { profile, hubEnabled } = access;
  if (destination !== "invitation" && (!hubEnabled || !profile))
    return <Navigate to="/invitation" replace />;
  if (destination === "hub" && profile) return <HubPage profile={profile} />;
  if (destination === "profile")
    return (
      <main className={styles.page}>
        <Link to="/" className={styles.back}>
          ← Retour au hub
        </Link>
        <h1>Mon profil</h1>
        <p>
          La modification du profil n’est pas encore disponible. Ton accès est
          bien conservé.
        </p>
      </main>
    );
  return (
    <>
      {hubEnabled && profile && (
        <nav
          className={styles.invitationNavigation}
          aria-label="Navigation invité"
        >
          <Link to="/" className={styles.back}>
            ← Retour au hub
          </Link>
        </nav>
      )}
      {profile && !profile.hasInvitationResponse ? (
        <main className={styles.page}>
          <h1>Ton invitation, {profile.firstName}.</h1>
          <p>
            Tu es reconnu en tant qu’accompagnant. Tu n’as pas de réponse
            personnelle à remplir.
          </p>
        </main>
      ) : (
        <InvitationPage profile={profile} />
      )}
      {!profile && (
        <aside
          className={styles.accessNotice}
          aria-label="Retrouver une inscription existante"
        >
          <p>
            Déjà inscrit depuis un autre navigateur ? La connexion par code
            personnel sera bientôt disponible. Garde ton navigateur d’origine
            pour retrouver ta réponse ; inutile de t’inscrire à nouveau.
          </p>
        </aside>
      )}
    </>
  );
}
