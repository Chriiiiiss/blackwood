import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { organizerQueryKey } from "../queries";
import {
  readContribution,
  readMetadata,
  readOrganizerCoffre,
} from "./requests";

export const organizerCoffreKey = [...organizerQueryKey, "coffre"] as const;
const privateOptions = {
  gcTime: 0,
  staleTime: 0,
  retry: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const;
export const organizerCoffreQuery = (coffreId?: number) =>
  queryOptions({
    queryKey: [...organizerCoffreKey, "state", coffreId ?? "current"],
    queryFn: ({ signal }) => readOrganizerCoffre(signal, coffreId),
    ...privateOptions,
    refetchInterval: 15_000,
  });
export const metadataQuery = (
  visibility: "" | "public" | "private",
  coffreId = 1,
) =>
  infiniteQueryOptions({
    queryKey: [...organizerCoffreKey, "list", coffreId, visibility],
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) =>
      readMetadata(signal, pageParam, visibility, coffreId),
    getNextPageParam: (last) => last.nextCursor,
    ...privateOptions,
    refetchInterval: 30_000,
  });
export const contributionQuery = (id: string, coffreId = 1) =>
  queryOptions({
    queryKey: [...organizerCoffreKey, "detail", coffreId, id],
    queryFn: ({ signal }) => readContribution(id, signal, coffreId),
    ...privateOptions,
  });
