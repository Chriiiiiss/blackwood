import { createFileRoute } from "@tanstack/react-router";
import { GuestPage } from "../features/hub/GuestPage";

export const Route = createFileRoute("/invitation")({
  component: () => <GuestPage destination="invitation" />,
});
