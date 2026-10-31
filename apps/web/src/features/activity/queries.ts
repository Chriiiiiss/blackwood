import { infiniteQueryOptions } from "@tanstack/react-query";
import { organizerQueryKey } from "../organizer/queries";
import { type ActivityFilters, readActivity } from "./requests";
export const activityQuery = (filters: ActivityFilters) =>
  infiniteQueryOptions({
    queryKey: [...organizerQueryKey, "activity", filters],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      readActivity(filters, pageParam, signal),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchInterval: 10_000,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
