import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext } from "@tanstack/react-router";
import { App } from "../App";
import { NotFoundPage } from "../NotFoundPage";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    component: App,
    notFoundComponent: NotFoundPage,
  },
);
