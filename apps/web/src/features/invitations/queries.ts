import { mutationOptions, queryOptions } from "@tanstack/react-query";
import type { InvitationInput } from "./model";
import { loadResponse, saveResponse } from "./requests";

export const invitationResponseKey = (
  id: string | null,
  authenticated = false,
) =>
  ["invitations", authenticated ? "current-profile" : "responses", id] as const;

export function invitationResponseOptions(
  id: string | null,
  authenticated = false,
) {
  return queryOptions({
    queryKey: invitationResponseKey(id, authenticated),
    queryFn: ({ signal }) =>
      id ? loadResponse(id, signal, authenticated) : null,
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
    authenticated,
  }: {
    id: string;
    input: InvitationInput;
    signal: AbortSignal;
    authenticated: boolean;
  }) => saveResponse(id, input, signal, authenticated),
  retry: false,
  networkMode: "always",
});
