import { useLocation } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { activityPage, reportActivity } from "./capture";

export function ActivityTracker() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const previous = useRef("");
  useEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    const page = activityPage(pathname);
    if (page) reportActivity({ kind: "page_view", page });
  }, [pathname]);
  return null;
}
