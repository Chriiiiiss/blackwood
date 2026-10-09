import { mutationOptions, queryOptions } from "@tanstack/react-query";
import type { InvitationInput } from "./model";
import { loadResponse, saveResponse } from "./requests";

export const invitationResponseKey = (id: string | null) =>
  ["invitations", "responses", id] as const;

export function invitationResponseOptions(id: string | null) {
  return queryOptions({
    queryKey: invitationResponseKey(id),
    queryFn: ({ signal }) => (id ? loadResponse(id, signal) : null),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    networkMode: "always",
  });
}

export const saveInvitationOptions = mutationOptions({
  mutationKey: ["invitations", "save"],
  mutationFn: ({
    id,
    input,
    signal,
  }: {
    id: string;
    input: InvitationInput;
    signal: AbortSignal;
  }) => saveResponse(id, input, signal),
  retry: false,
  networkMode: "always",
});
