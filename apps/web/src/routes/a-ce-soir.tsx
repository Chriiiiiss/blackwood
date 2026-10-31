import { createFileRoute } from "@tanstack/react-router";
import { PartyWaitingPage } from "../features/party-access/PartyWaitingPage";
export const Route = createFileRoute("/a-ce-soir")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { destination: "coffre" | "missions" } => ({
    destination: search.destination === "missions" ? "missions" : "coffre",
  }),
  component: WaitingRoute,
});
function WaitingRoute() {
  const { destination } = Route.useSearch();
  return <PartyWaitingPage destination={destination} />;
}
