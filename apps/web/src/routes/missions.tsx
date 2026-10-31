import { createFileRoute } from "@tanstack/react-router";
import { GuestPage } from "../features/hub/GuestPage";
export const Route = createFileRoute("/missions")({
  component: () => <GuestPage destination="missions" />,
});
