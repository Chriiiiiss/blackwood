import { queryOptions } from "@tanstack/react-query";
import { organizerQueryKey } from "../organizer/queries";
import { readCurrentTrack, readSpotifyStatus } from "./requests";
export const spotifyStatusOptions = () =>
  queryOptions({
    queryKey: [...organizerQueryKey, "spotify"],
    queryFn: ({ signal }) => readSpotifyStatus(signal),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchInterval: 15000,
  });
export const currentTrackOptions = () =>
  queryOptions({
    queryKey: ["tv", "spotify"],
    queryFn: ({ signal }) => readCurrentTrack(signal),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchInterval: 5000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
