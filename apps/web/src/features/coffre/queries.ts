import { queryOptions } from "@tanstack/react-query";
import { readCoffre } from "./requests";

export const coffreKey = (profileId: string) => ["coffre", profileId] as const;
export const coffreOptions = (profileId: string, coffreId?: number) =>
  queryOptions({
    queryKey: [...coffreKey(profileId), "state", coffreId ?? "current"],
    queryFn: ({ signal }) => readCoffre(signal, coffreId),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    networkMode: "always",
    refetchInterval: 15_000,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });
