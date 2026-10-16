import { createFileRoute } from "@tanstack/react-router";
import { CompanionPage } from "../features/profiles/CompanionPage";

export const Route = createFileRoute("/companions/$mainProfileId")({
  component: CompanionRoute,
});
function CompanionRoute() {
  const { mainProfileId } = Route.useParams();
  return <CompanionPage key={mainProfileId} mainProfileId={mainProfileId} />;
}
