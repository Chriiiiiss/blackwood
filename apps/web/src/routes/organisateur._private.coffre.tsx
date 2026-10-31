import { createFileRoute } from "@tanstack/react-router";
import { OrganizerCoffrePage } from "../features/organizer/coffre/OrganizerCoffrePage";

export const Route = createFileRoute("/organisateur/_private/coffre")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { spotify?: "connected" | "denied" | "error" } =>
    ["connected", "denied", "error"].includes(String(search.spotify))
      ? { spotify: search.spotify as "connected" | "denied" | "error" }
      : {},
  component: OrganizerCoffrePage,
});
