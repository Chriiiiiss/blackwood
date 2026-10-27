import { createFileRoute } from "@tanstack/react-router";
import { CoffreTvPage } from "../features/coffre-tv/CoffreTvPage";
export const Route = createFileRoute("/coffre_/tv")({
  component: CoffreTvPage,
});
