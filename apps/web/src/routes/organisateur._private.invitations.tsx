import { createFileRoute } from "@tanstack/react-router";
import { OrganizerInvitationsPage } from "../features/organizer/OrganizerInvitationsPage";

export const Route = createFileRoute("/organisateur/_private/invitations")({
  component: OrganizerInvitationsPage,
});
