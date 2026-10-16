import { createFileRoute } from "@tanstack/react-router";
import { OrganizerProfileAccessPage } from "../features/organizer/OrganizerProfileAccessPage";

export const Route = createFileRoute("/organisateur/_private/acces")({
  component: OrganizerProfileAccessPage,
});
