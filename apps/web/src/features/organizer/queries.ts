import { queryOptions } from "@tanstack/react-query";
import {
  readHubSettings,
  readProfileAccess,
  readResponses,
  readSession,
} from "./requests";

export const organizerQueryKey = ["organizer"] as const;
const privateOptions = { staleTime: 0, gcTime: 0, retry: false } as const;
export const organizerSessionQuery = () =>
  queryOptions({
    queryKey: [...organizerQueryKey, "session"],
    queryFn: ({ signal }) => readSession(signal),
    ...privateOptions,
  });
export const organizerResponsesQuery = () =>
  queryOptions({
    queryKey: [...organizerQueryKey, "responses"],
    queryFn: ({ signal }) => readResponses(signal),
    ...privateOptions,
  });
export const organizerHubSettingsQuery = () =>
  queryOptions({
    queryKey: [...organizerQueryKey, "hub-settings"],
    queryFn: ({ signal }) => readHubSettings(signal),
    ...privateOptions,
  });
export const organizerProfileAccessQuery = () =>
  queryOptions({
    queryKey: [...organizerQueryKey, "profile-access"],
    queryFn: ({ signal }) => readProfileAccess(signal),
    ...privateOptions,
  });
