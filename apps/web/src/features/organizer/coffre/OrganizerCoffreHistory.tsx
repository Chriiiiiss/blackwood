import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { OrganizerRequestError } from "../requests";
import styles from "./coffre-history.module.scss";
import { readCoffreHistory } from "./requests";

export function OrganizerCoffreHistory({
  selected,
  onSelect,
  onUnauthorized,
  onLatestChange,
}: {
  selected: number | null;
  onSelect: (id: number) => void;
  onUnauthorized?: () => void;
  onLatestChange?: (id: number) => void;
}) {
  const query = useInfiniteQuery({
    queryKey: ["organizer", "coffre", "history"],
    initialPageParam: null as number | null,
    queryFn: ({ signal, pageParam }) => readCoffreHistory(signal, pageParam),
    getNextPageParam: (page) => page.nextCursor,
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchInterval: 15_000,
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    if (
      query.error instanceof OrganizerRequestError &&
      query.error.status === 401
    )
      onUnauthorized?.();
  }, [query.error, onUnauthorized]);
  const rows = query.data?.pages.flatMap((page) => page.coffres) ?? [];
  const latest = !query.isError ? rows[0]?.id : null;
  useEffect(() => {
    if (latest) onLatestChange?.(latest);
  }, [latest, onLatestChange]);
  if (query.isPending) return null;
  if (query.isError)
    return (
      <div className={styles.history}>
        <p role="alert">Impossible de retrouver les autres Coffres.</p>
        <button type="button" onClick={() => void query.refetch()}>
          Réessayer les Coffres
        </button>
      </div>
    );
  if (rows.length < 2) return null;
  return (
    <nav className={styles.history} aria-label="Les Coffres de la soirée">
      <p>Chaque Coffre garde ses souvenirs.</p>
      <div className={styles.choices}>
        {rows.map(
          (row, index) =>
            row.id && (
              <button
                type="button"
                key={row.id}
                aria-pressed={row.id === selected}
                onClick={() => onSelect(row.id as number)}
              >
                <strong>Coffre {row.id}</strong>
                <span>
                  {index === 0 ? "Actuel · " : ""}
                  {row.state === "revealed"
                    ? "Souvenirs révélés"
                    : row.state === "collecting"
                      ? "Dépôts ouverts"
                      : "En préparation"}
                </span>
              </button>
            ),
        )}
      </div>
      {query.hasNextPage && (
        <button
          type="button"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          Coffres plus anciens
        </button>
      )}
    </nav>
  );
}
