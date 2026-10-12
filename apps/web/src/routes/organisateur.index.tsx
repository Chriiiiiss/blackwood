import { createFileRoute } from "@tanstack/react-router";
import { OrganizerPage } from "../features/organizer/OrganizerPage";

export const Route = createFileRoute("/organisateur/")({
  component: OrganizerPage,
});
