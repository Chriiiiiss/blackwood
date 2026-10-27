import { useQuery } from "@tanstack/react-query";
import { Link, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { GuestProfile } from "../guest-access/requests";
import { ContributionForm } from "./ContributionForm";
import { useCoffreClock } from "./clock";
import styles from "./coffre.module.scss";
import { type ComposerStore, useCoffreComposer } from "./composer-state";
import { coffreOptions } from "./queries";
import { CoffreRequestError } from "./requests";

export function AccessRedirect({ error }: { error: unknown }) {
  if (!(error instanceof CoffreRequestError)) return null;
  if (error.status === 401) return <Navigate to="/login" replace />;
  if (error.code === "HUB_CLOSED") return <Navigate to="/invitation" replace />;
  return null;
}
export function CoffrePage({ profile }: { profile: GuestProfile }) {
  const composers: ComposerStore = useState({});
  const query = useQuery(coffreOptions(profile.id));
  const composer = useCoffreComposer(composers, query.data?.id ?? 1);
  const remaining = useCoffreClock(query.data);
  const opening = query.data?.state === "collecting" && remaining === 0;
  useEffect(() => {
    if (opening) void query.refetch();
  }, [opening, query.refetch]);
  const state = query.data;
  return (
    <main className={styles.page}>
      <div className={styles.pageHeader}>
        <Link className={styles.back} to="/">
          ← Le hub
        </Link>
        {state?.state === "collecting" && !opening && !query.isError && (
          <p className={styles.phase}>Les dépôts sont ouverts</p>
        )}
      </div>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Un morceau de cette nuit</p>
          <h1>
            {state?.name ?? (
              <>
                Le Coffre{state?.id && state.id > 1 ? ` ${state.id}` : ""}
                <span>.</span>
              </>
            )}
          </h1>
        </div>
        {state?.state === "collecting" && !query.isError && (
          <p className={styles.countdown}>
            Révélation dans
            <span
              role="timer"
              aria-label={`Révélation dans ${Math.floor(remaining / 3600)} heures ${Math.floor((remaining % 3600) / 60)} minutes ${remaining % 60} secondes`}
            >
              {[
                Math.floor(remaining / 3600),
                Math.floor((remaining % 3600) / 60),
                remaining % 60,
              ]
                .map((n) => String(n).padStart(2, "0"))
                .join(" : ")}
            </span>
          </p>
        )}
      </header>
      {query.isPending ? (
        <p role="status">Le Coffre se prépare…</p>
      ) : query.isError ? (
        <>
          <AccessRedirect error={query.error} />
          <section className={styles.stateCard}>
            <h2>On reprend dans un instant ?</h2>
            <p role="alert">
              Impossible de vérifier le Coffre. Ton brouillon reste sur cette
              page.
            </p>
            <button
              className={styles.secondary}
              type="button"
              onClick={() => void query.refetch()}
            >
              Réessayer
            </button>
          </section>
        </>
      ) : (
        state && (
          <>
            {(state.state === "unprepared" || state.state === "prepared") && (
              <section className={styles.stateCard}>
                <span className={styles.lockMark} aria-hidden="true">
                  ◇
                </span>
                <p className={styles.eyebrow}>Chaque chose en son temps</p>
                <h2>Les souvenirs attendent leur heure.</h2>
                <p>
                  Chris n’a pas encore lancé le Coffre. Reviens pendant la
                  soirée pour y glisser ton premier souvenir.
                </p>
              </section>
            )}
            {opening && (
              <p role="status" className={styles.hint}>
                Le compte à rebours est terminé. On vérifie l’ouverture…
              </p>
            )}
            {state.state === "revealed" && (
              <section className={styles.stateCard}>
                <p className={styles.eyebrow}>Les dépôts sont fermés</p>
                <h2>Les souvenirs attendent le grand écran.</h2>
                <p>
                  Le compte à rebours est terminé. Rendez-vous sur la télévision
                  de la soirée pour découvrir les souvenirs partagés.
                </p>
              </section>
            )}
          </>
        )
      )}
      {state && (
        <ContributionForm
          key={state.id}
          coffreId={state.id ?? 1}
          composerState={composer}
          collecting={
            state.state === "collecting" && !opening && !query.isError
          }
          canReadState={!query.isError}
          closed={opening || state.state === "revealed"}
          onStateChange={() => void query.refetch()}
        />
      )}
    </main>
  );
}
