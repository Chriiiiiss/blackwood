import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useOrganizerLayout } from "../organizer/OrganizerLayout";
import { organizerProfileAccessQuery } from "../organizer/queries";
import { OrganizerRequestError } from "../organizer/requests";
import styles from "./activity.module.scss";
import { activityQuery } from "./queries";
import type { ActivityEvent, ActivityFilters } from "./requests";

const pages: Record<string, string> = {
  hub: "Accueil",
  invitation: "Invitation",
  coffre: "Coffre",
  missions: "Missions secrètes",
  profile: "Profil",
  companion: "Inscription +1",
  login: "Connexion",
  waiting: "Page d’attente",
  not_found: "Page introuvable",
};
function description(event: ActivityEvent) {
  if (event.kind === "page_view") return "Page consultée";
  if (event.kind === "client_error") return "Erreur JavaScript";
  if (event.kind === "network_error") return "Échec réseau";
  if (event.kind === "api_error") return `Erreur HTTP ${event.status ?? ""}`;
  if (event.route === "/api/guest-access/login") return "Connexion par code";
  if (event.route === "/api/guest-access/restore") return "Accès retrouvé";
  if (event.route?.endsWith("/contributions")) return "Envoi d’un souvenir";
  if (event.route?.endsWith("/decision")) return "Réponse à une confirmation";
  if (event.route?.endsWith("/assignments")) return "Mission tirée";
  if (event.route?.endsWith("/claims")) return "Confirmation demandée";
  if (event.route?.endsWith("/avatar"))
    return event.method === "DELETE"
      ? "Photo de profil supprimée"
      : "Photo de profil enregistrée";
  return "Action effectuée";
}
export function OrganizerActivityPage() {
  const { expire } = useOrganizerLayout();
  const [filters, setFilters] = useState<ActivityFilters>({
    profileId: "",
    page: "",
    onlyErrors: false,
  });
  const query = useInfiniteQuery(activityQuery(filters));
  const profiles = useQuery(organizerProfileAccessQuery());
  useEffect(() => {
    if (
      [query.error, profiles.error].some(
        (error) =>
          error instanceof OrganizerRequestError && error.status === 401,
      )
    )
      expire();
  }, [query.error, profiles.error, expire]);
  const events = query.data?.pages.flatMap((page) => page.events) ?? [];
  return (
    <section className={styles.page} aria-labelledby="activity-title">
      <header>
        <div>
          <h2 id="activity-title">Activité</h2>
          <p>
            Pages consultées, actions et erreurs signalées par l’application.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          Actualiser
        </button>
      </header>
      <div className={styles.filters}>
        <label>
          Invité
          <select
            aria-label="Invité"
            value={filters.profileId}
            onChange={(event) =>
              setFilters((old) => ({ ...old, profileId: event.target.value }))
            }
          >
            <option value="">Tous les visiteurs</option>
            <option value="anonymous">Visiteurs non identifiés</option>
            {profiles.data?.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.firstName} · {profile.id.slice(0, 4)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Page
          <select
            aria-label="Page"
            value={filters.page}
            onChange={(event) =>
              setFilters((old) => ({ ...old, page: event.target.value }))
            }
          >
            <option value="">Toutes les pages</option>
            {Object.entries(pages).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.errors}>
          <input
            type="checkbox"
            checked={filters.onlyErrors}
            onChange={(event) =>
              setFilters((old) => ({
                ...old,
                onlyErrors: event.target.checked,
              }))
            }
          />
          Erreurs uniquement
        </label>
      </div>
      {profiles.isError && (
        <p role="alert">
          Le filtre par invité est indisponible.{" "}
          <button type="button" onClick={() => void profiles.refetch()}>
            Réessayer les invités
          </button>
        </p>
      )}
      {query.isPending ? (
        <p role="status">Chargement de l’activité…</p>
      ) : query.isError ? (
        <div role="alert">
          <p>Impossible de charger l’activité.</p>
          <button type="button" onClick={() => void query.refetch()}>
            Réessayer
          </button>
        </div>
      ) : (
        <>
          <ol className={styles.feed} aria-label="Journal d’activité">
            {events.map((event) => (
              <li key={event.id} data-error={event.kind.endsWith("error")}>
                <time dateTime={event.createdAt}>
                  {new Intl.DateTimeFormat("fr-FR", {
                    timeZone: "Europe/Paris",
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  }).format(new Date(event.createdAt))}
                </time>
                <div>
                  <strong>{event.firstName ?? "Visiteur non identifié"}</strong>
                  <span>
                    {description(event)} · {pages[event.page] ?? event.page}
                  </span>
                  {(event.route || event.code || event.source) && (
                    <small>
                      {[event.method, event.route, event.code, event.source]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  )}
                </div>
                {event.profileId && (
                  <button
                    type="button"
                    className={styles.filterGuest}
                    onClick={() =>
                      setFilters((old) => ({
                        ...old,
                        profileId: event.profileId ?? "",
                      }))
                    }
                  >
                    Voir son activité
                  </button>
                )}
              </li>
            ))}
          </ol>
          {!events.length && <p>Aucune activité pour ces filtres.</p>}
          {query.hasNextPage && (
            <button
              type="button"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage
                ? "Chargement…"
                : "Activité plus ancienne"}
            </button>
          )}
        </>
      )}
      <p className={styles.note}>
        Heure de Paris · Actualisation toutes les 10 secondes. Le suivi commence
        avec cette version ; les visites précédentes ne peuvent pas être
        reconstituées.
      </p>
    </section>
  );
}
