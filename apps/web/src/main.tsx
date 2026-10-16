import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Notifications } from "./components/Notifications";
import { queryClient } from "./query-client";
import { router } from "./router";
import "./styles.scss";

const root = document.getElementById("root");
if (!root) {
  throw new Error("The application root element was not found.");
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Notifications />
    </QueryClientProvider>
  </StrictMode>,
);
