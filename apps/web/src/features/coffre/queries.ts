import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { readCoffre, readContributions } from "./requests";

export const coffreKey = (profileId: string) => ["coffre", profileId] as const;
export const coffreOptions = (profileId: string) =>
  queryOptions({
    queryKey: [...coffreKey(profileId), "state"],
    queryFn: ({ signal }) => readCoffre(signal),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    networkMode: "always",
    refetchInterval: 15_000,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });
export const contributionsOptions = (profileId: string) =>
  infiniteQueryOptions({
    queryKey: [...coffreKey(profileId), "contributions"],
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) => readContributions(signal, pageParam),
    getNextPageParam: (last) => last.nextCursor,
    gcTime: 0,
    staleTime: 0,
    retry: false,
    networkMode: "always",
    refetchInterval: 30_000,
    refetchOnWindowFocus: "always",
  });
