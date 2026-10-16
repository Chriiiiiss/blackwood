import { createFileRoute } from "@tanstack/react-router";
import { GuestLoginPage } from "../features/guest-access/GuestLoginPage";

export const Route = createFileRoute("/login")({ component: GuestLoginPage });
