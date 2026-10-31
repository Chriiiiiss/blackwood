import { createUuid } from "../../lib/uuid";

export type ActivityPage =
  | "hub"
  | "invitation"
  | "coffre"
  | "missions"
  | "profile"
  | "companion"
  | "login"
  | "waiting"
  | "not_found";
type EventInput = {
  kind: "page_view" | "action" | "api_error" | "network_error" | "client_error";
  page: ActivityPage;
  route?: string;
  method?: string;
  status?: number;
  code?: string;
  source?: string;
};
const send = window.fetch.bind(window);
const segments = new Set([
  "api",
  "guest-access",
  "login",
  "restore",
  "profiles",
  "me",
  "companion-invitations",
  "claim",
  "invitation-response",
  "avatar",
  "media",
  "coffre",
  "contributions",
  "image",
  "thumbnail",
  "missions",
  "assignments",
  "claims",
  "confirmations",
  "decision",
  "players",
  "invitation-responses",
]);
export function activityPage(pathname: string): ActivityPage | undefined {
  if (pathname.startsWith("/organisateur") || pathname === "/coffre/tv")
    return undefined;
  if (pathname === "/") return "hub";
  if (pathname === "/profiles") return "profile";
  if (pathname.startsWith("/companions/")) return "companion";
  if (pathname === "/a-ce-soir") return "waiting";
  if (["/invitation", "/coffre", "/missions", "/login"].includes(pathname))
    return pathname.slice(1) as ActivityPage;
  return "not_found";
}
export function reportActivity(input: EventInput) {
  try {
    void send("/api/activity/events", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json", "X-Guest-Request": "1" },
      body: JSON.stringify({ id: createUuid(), ...input }),
    }).catch(() => {});
  } catch {
    /* Monitoring must never interrupt an invitation or contribution. */
  }
}
function apiRoute(input: RequestInfo | URL) {
  try {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      window.location.href,
    );
    if (
      url.origin !== window.location.origin ||
      !/^\/api\/(?:guest-access|profiles|companion-invitations|coffre|missions|media|invitation-responses)(?:\/|$)/.test(
        url.pathname,
      )
    )
      return undefined;
    return url.pathname
      .split("/")
      .map((segment) => (!segment || segments.has(segment) ? segment : ":id"))
      .join("/");
  } catch {
    return undefined;
  }
}
let installed = false;
export function installActivityCapture() {
  if (installed) return;
  installed = true;
  window.fetch = async (input, init) => {
    const route = apiRoute(input);
    const page = activityPage(window.location.pathname);
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    try {
      const response = await send(input, init);
      if (
        route &&
        page &&
        ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(method)
      ) {
        if (response.status >= 400)
          reportActivity({
            kind: "api_error",
            page,
            route,
            method,
            status: response.status,
            code: "HTTP_ERROR",
          });
        else if (["POST", "PUT", "PATCH", "DELETE"].includes(method))
          reportActivity({
            kind: "action",
            page,
            route,
            method,
            status: response.status,
          });
      }
      return response;
    } catch (error) {
      if (
        route &&
        page &&
        !(error instanceof Error && error.name === "AbortError")
      )
        reportActivity({
          kind: "network_error",
          page,
          route,
          method,
          code:
            error instanceof Error && error.name === "TimeoutError"
              ? "TimeoutError"
              : "NETWORK_ERROR",
        });
      throw error;
    }
  };
  const code = (error: unknown) =>
    error instanceof Error &&
    ["TypeError", "ReferenceError", "SyntaxError", "RangeError"].includes(
      error.name,
    )
      ? error.name
      : "Error";
  window.addEventListener("error", (event) => {
    const page = activityPage(window.location.pathname);
    if (!page) return;
    let source: string | undefined;
    try {
      const filename = new URL(event.filename, window.location.href).pathname
        .split("/")
        .at(-1);
      if (
        filename &&
        /^[a-zA-Z0-9_-]+\.js$/.test(filename) &&
        event.lineno < 10_000_000 &&
        event.colno < 10_000_000
      )
        source = `${filename}:${event.lineno}:${event.colno}`;
    } catch {
      /* Keep malformed or non-script sources out of telemetry. */
    }
    reportActivity({
      kind: "client_error",
      page,
      code: code(event.error),
      ...(source ? { source } : {}),
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const page = activityPage(window.location.pathname);
    if (page)
      reportActivity({
        kind: "client_error",
        page,
        code:
          event.reason instanceof Error
            ? code(event.reason)
            : "UnhandledRejection",
      });
  });
}
