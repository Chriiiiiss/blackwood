import { queryOptions } from "@tanstack/react-query";
import { readResponseId } from "../invitations/response-storage";
import { readGuestAccess, restoreGuestAccess } from "./requests";

export const guestAccessKey = ["guest-access"] as const;

export function guestAccessOptions() {
  return queryOptions({
    queryKey: guestAccessKey,
    queryFn: async ({ signal }) => {
      const access = await readGuestAccess(signal);
      if (access.profile) return access;
      const responseId = readResponseId();
      return responseId
        ? ((await restoreGuestAccess(responseId, signal)) ?? access)
        : access;
    },
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    networkMode: "always",
  });
}
