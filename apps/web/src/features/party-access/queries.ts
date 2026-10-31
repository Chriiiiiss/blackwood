import { queryOptions } from "@tanstack/react-query";
import { readPartyAccess } from "./requests";
export const partyAccessOptions = () =>
  queryOptions({
    queryKey: ["party-access"],
    queryFn: ({ signal }) => readPartyAccess(signal),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    networkMode: "always",
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.isOpen) return false;
      // Use the server's remaining time, never the phone clock, to schedule the next check.
      return data
        ? Math.max(
            1000,
            Math.min(
              30_000,
              Date.parse(data.opensAt) - Date.parse(data.serverNow),
            ),
          )
        : 5000;
    },
  });
