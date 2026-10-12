import { createFileRoute } from "@tanstack/react-router";
import { InvitationPage } from "../features/invitations";

export const Route = createFileRoute("/")({
  component: InvitationPage,
});
