import {
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { guestAccessKey } from "../guest-access/queries";
import type { GuestAccess, GuestProfile } from "../guest-access/requests";
import { readCompanion } from "./requests";

export const companionKey = ["profiles", "companion"] as const;
export const companionOptions = () =>
  queryOptions({
    queryKey: companionKey,
    queryFn: ({ signal }) => readCompanion(signal),
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

export function useProfileMutation<T>(
  mutationFn: (input: T) => Promise<GuestProfile>,
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    retry: false,
    gcTime: 0,
    onSuccess: async (profile) => {
      await client.cancelQueries({ queryKey: guestAccessKey });
      client.setQueriesData<GuestAccess>(
        { queryKey: guestAccessKey },
        (previous) => (previous ? { ...previous, profile } : previous),
      );
      await client.invalidateQueries({ queryKey: ["invitations"] });
    },
  });
}
