import { createFileRoute } from "@tanstack/react-router";
import { GuestPage } from "../features/hub/GuestPage";
import { PartyGate } from "../features/party-access/PartyGate";

export const Route = createFileRoute("/coffre")({
  component: () => (
    <PartyGate destination="coffre">
      <GuestPage destination="coffre" />
    </PartyGate>
  ),
});
