import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { CoffreRequestError } from "../coffre/requests";
import { readTvPage, readTvState } from "./requests";
export const tvKey = ["coffre-tv"] as const;
const privateQuery = {
  gcTime: 0,
  staleTime: 0,
  retry: false,
  networkMode: "always",
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const;
export const tvStateQuery = () =>
  queryOptions({
    queryKey: [...tvKey, "state"],
    queryFn: ({ signal }) => readTvState(signal),
    ...privateQuery,
    // Refetching an unauthenticated query clears its error and unmounts the code form.
    refetchInterval: (query) =>
      query.state.error instanceof CoffreRequestError &&
      query.state.error.status === 401
        ? false
        : 3000,
  });
export const tvContributionsQuery = (coffreId: number) =>
  infiniteQueryOptions({
    queryKey: [...tvKey, "contributions", coffreId],
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) => readTvPage(coffreId, pageParam, signal),
    getNextPageParam: (page) => page.nextCursor,
    ...privateQuery,
    refetchInterval: 5000,
  });
