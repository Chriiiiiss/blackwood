import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { GuestProfile } from "../guest-access/requests";
import { ContributionCard } from "./ContributionCard";
import { ContributionForm } from "./ContributionForm";
import styles from "./coffre.module.scss";
import { coffreOptions, contributionsOptions } from "./queries";
import { CoffreRequestError, type CoffreState } from "./requests";

export function AccessRedirect({ error }: { error: unknown }) {
  if (!(error instanceof CoffreRequestError)) return null;
  if (error.status === 401) return <Navigate to="/login" replace />;
  if (error.code === "HUB_CLOSED") return <Navigate to="/invitation" replace />;
  return null;
}
function secondsRemaining(state: CoffreState | undefined) {
  return state?.deadline
    ? Math.max(
        0,
        Math.ceil(
          (Date.parse(state.deadline) -
            Date.parse(state.serverNow) -
            (performance.now() - state.receivedAt)) /
            1000,
        ),
      )
    : 0;
}
export function CoffrePage({ profile }: { profile: GuestProfile }) {
  const query = useQuery(coffreOptions(profile.id));
  const [, setTick] = useState(0);
  const remaining = secondsRemaining(query.data);
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);
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
            Le Coffre<span>.</span>
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
              <PublicMemories profileId={profile.id} />
            )}
          </>
        )
      )}
      {state && (
        <ContributionForm
          profileId={profile.id}
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

function PublicMemories({ profileId }: { profileId: string }) {
  const query = useInfiniteQuery(contributionsOptions(profileId));
  const rows = query.data?.pages.flatMap((page) => page.contributions) ?? [];
  const unique = rows.filter(
    (item, index) => rows.findIndex((other) => other.id === item.id) === index,
  );
  return (
    <section aria-labelledby="memories-title">
      <div className={styles.revealedHeader}>
        <p className={styles.eyebrow}>Le moment est arrivé</p>
        <h2 id="memories-title">Ce qu’on garde de cette nuit.</h2>
        <p>
          Le Coffre est ouvert. Les dépôts sont fermés ; les souvenirs partagés
          sont à vous.
        </p>
      </div>
      {query.isPending ? (
        <p role="status">Les souvenirs arrivent…</p>
      ) : query.isError ? (
        <>
          <AccessRedirect error={query.error} />
          <p role="alert">Impossible de retrouver les souvenirs. Réessaie.</p>
          <button
            className={styles.secondary}
            type="button"
            onClick={() => void query.refetch()}
          >
            Réessayer les souvenirs
          </button>
        </>
      ) : unique.length === 0 ? (
        <div className={styles.stateCard}>
          <h3>Un peu de mystère, encore.</h3>
          <p>Aucun souvenir public n’est disponible pour le moment.</p>
        </div>
      ) : (
        <>
          <div className={styles.memories}>
            {unique.map((item) => (
              <article key={item.id} aria-label="Souvenir partagé">
                <ContributionCard
                  text={item.text}
                  image={
                    item.photoMediaId
                      ? `/api/media/${encodeURIComponent(item.photoMediaId)}/image`
                      : null
                  }
                  frameId={item.frameId}
                />
              </article>
            ))}
          </div>
          {query.hasNextPage && (
            <button
              className={styles.secondary}
              type="button"
              disabled={query.isFetching}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage
                ? "Encore un instant…"
                : "Voir d’autres souvenirs"}
            </button>
          )}
        </>
      )}
      <p className={styles.hint}>Les dépôts privés restent réservés à Chris.</p>
    </section>
  );
}
