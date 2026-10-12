import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  organizerQueryKey,
  organizerResponsesQuery,
  organizerSessionQuery,
} from "./queries";
import {
  logout,
  OrganizerRequestError,
  type OrganizerResponses,
  type OrganizerSession,
} from "./requests";

type View =
  | { status: "checking" | "error" | "logging-out" | "logout-error" }
  | { status: "ready"; session: OrganizerSession; data: OrganizerResponses };

export function useOrganizerAccess() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [view, setView] = useState<View>({ status: "checking" });
  const generation = useRef(0);
  const signingOut = useRef(false);

  const clearPrivateQueries = useCallback(async () => {
    await client.cancelQueries({ queryKey: organizerQueryKey });
    client.removeQueries({ queryKey: organizerQueryKey });
  }, [client]);

  const check = useCallback(async () => {
    if (signingOut.current || document.visibilityState === "hidden") return;
    const current = ++generation.current;
    setView({ status: "checking" });
    await clearPrivateQueries();
    if (current !== generation.current) return;
    try {
      const session = await client.fetchQuery(organizerSessionQuery());
      if (current !== generation.current) return;
      const data = await client.fetchQuery(organizerResponsesQuery());
      if (current !== generation.current) return;
      setView({ status: "ready", session, data });
    } catch (error) {
      if (current !== generation.current) return;
      setView({ status: "error" });
      await clearPrivateQueries();
      if (current !== generation.current) return;
      if (error instanceof OrganizerRequestError && error.status === 401) {
        void navigate({
          to: "/organisateur/connexion",
          search: { reason: "expired" },
          replace: true,
        });
      }
    }
  }, [client, clearPrivateQueries, navigate]);

  const signOut = useCallback(async () => {
    signingOut.current = true;
    const current = ++generation.current;
    setView({ status: "logging-out" });
    await clearPrivateQueries();
    try {
      await logout();
      if (current !== generation.current) return;
      void navigate({
        to: "/organisateur/connexion",
        search: { reason: "signed-out" },
        replace: true,
      });
    } catch {
      if (current === generation.current) setView({ status: "logout-error" });
    }
  }, [clearPrivateQueries, navigate]);

  useEffect(() => {
    void check();
    const visibility = () => {
      if (signingOut.current) return;
      if (document.visibilityState === "hidden") {
        generation.current++;
        setView({ status: "checking" });
        void clearPrivateQueries();
      } else void check();
    };
    const focus = () => {
      void check();
    };
    window.addEventListener("focus", focus);
    window.addEventListener("pageshow", focus);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      generation.current++;
      window.removeEventListener("focus", focus);
      window.removeEventListener("pageshow", focus);
      document.removeEventListener("visibilitychange", visibility);
      void clearPrivateQueries();
    };
  }, [check, clearPrivateQueries]);

  useEffect(() => {
    if (view.status !== "ready") return;
    const expires = Math.min(
      Date.parse(view.session.expiresAt),
      Date.parse(view.session.idleExpiresAt),
    );
    const timer = window.setTimeout(
      () => {
        generation.current++;
        setView({ status: "checking" });
        void clearPrivateQueries();
        void navigate({
          to: "/organisateur/connexion",
          search: { reason: "expired" },
          replace: true,
        });
      },
      Math.max(0, expires - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [view, clearPrivateQueries, navigate]);

  return { view, refresh: check, signOut };
}
