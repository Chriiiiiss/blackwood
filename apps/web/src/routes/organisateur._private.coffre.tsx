import { createFileRoute } from "@tanstack/react-router";
import { OrganizerCoffrePage } from "../features/organizer/coffre/OrganizerCoffrePage";

export const Route = createFileRoute("/organisateur/_private/coffre")({
  component: OrganizerCoffrePage,
});
