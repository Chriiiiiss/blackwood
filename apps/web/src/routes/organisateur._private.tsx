import { createFileRoute } from "@tanstack/react-router";
import { OrganizerLayout } from "../features/organizer/OrganizerLayout";

export const Route = createFileRoute("/organisateur/_private")({
  component: OrganizerLayout,
});
