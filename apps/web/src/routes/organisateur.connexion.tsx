import { createFileRoute } from "@tanstack/react-router";
import { OrganizerLoginPage } from "../features/organizer/OrganizerLoginPage";

export const Route = createFileRoute("/organisateur/connexion")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { reason?: "expired" | "signed-out" } =>
    search.reason === "expired" || search.reason === "signed-out"
      ? { reason: search.reason }
      : {},
  component: LoginRoute,
});

function LoginRoute() {
  return <OrganizerLoginPage reason={Route.useSearch().reason} />;
}
