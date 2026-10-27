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
export const organizerCoffreQuery = () =>
  queryOptions({
    queryKey: [...organizerCoffreKey, "state"],
    queryFn: ({ signal }) => readOrganizerCoffre(signal),
    ...privateOptions,
    refetchInterval: 15_000,
  });
export const metadataQuery = (visibility: "" | "public" | "private") =>
  infiniteQueryOptions({
    queryKey: [...organizerCoffreKey, "list", visibility],
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) =>
      readMetadata(signal, pageParam, visibility),
    getNextPageParam: (last) => last.nextCursor,
    ...privateOptions,
    refetchInterval: 30_000,
  });
export const contributionQuery = (id: string) =>
  queryOptions({
    queryKey: [...organizerCoffreKey, "detail", id],
    queryFn: ({ signal }) => readContribution(id, signal),
    ...privateOptions,
  });
