import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/organisateur/")({
  beforeLoad: () => {
    throw redirect({ to: "/organisateur/invitations", replace: true });
  },
});
