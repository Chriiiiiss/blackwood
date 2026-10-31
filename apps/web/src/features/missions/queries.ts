import { queryOptions } from "@tanstack/react-query";
import {
  readConfirmations,
  readLeaderboard,
  readOwnMissions,
  readPlayers,
  readTvMissionSettings,
} from "./requests";
export const missionsKey = (profileId: string) =>
  ["missions", profileId] as const;
const privateOptions = {
  gcTime: 0,
  staleTime: 0,
  retry: false,
  networkMode: "always",
  refetchOnWindowFocus: true,
} as const;
export const ownMissionsOptions = (profileId: string) =>
  queryOptions({
    queryKey: [...missionsKey(profileId), "own"],
    queryFn: ({ signal }) => readOwnMissions(signal),
    ...privateOptions,
    refetchInterval: 5000,
  });
export const confirmationsOptions = (profileId: string) =>
  queryOptions({
    queryKey: [...missionsKey(profileId), "incoming"],
    queryFn: ({ signal }) => readConfirmations(signal),
    ...privateOptions,
    refetchInterval: 5000,
  });
export const playersOptions = (profileId: string) =>
  queryOptions({
    queryKey: [...missionsKey(profileId), "players"],
    queryFn: ({ signal }) => readPlayers(signal),
    ...privateOptions,
    refetchInterval: 10_000,
  });
export const tvMissionSettingsOptions = () =>
  queryOptions({
    queryKey: ["organizer", "mission-settings"],
    queryFn: ({ signal }) => readTvMissionSettings(signal),
    ...privateOptions,
  });
export const leaderboardOptions = () =>
  queryOptions({
    queryKey: ["tv-missions"],
    queryFn: ({ signal }) => readLeaderboard(signal),
    ...privateOptions,
    refetchInterval: 5000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
