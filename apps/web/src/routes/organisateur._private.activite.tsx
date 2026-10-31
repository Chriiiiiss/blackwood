import { createFileRoute } from "@tanstack/react-router";
import { OrganizerActivityPage } from "../features/activity/OrganizerActivityPage";
export const Route = createFileRoute("/organisateur/_private/activite")({
  component: OrganizerActivityPage,
});
