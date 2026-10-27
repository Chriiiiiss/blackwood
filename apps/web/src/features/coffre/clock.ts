import { useEffect, useState } from "react";
import type { CoffreState } from "./requests";

export function coffreTime(state: CoffreState) {
  return Date.parse(state.serverNow) + performance.now() - state.receivedAt;
}
export function useCoffreClock(state: CoffreState | undefined) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (state?.state !== "collecting") return;
    const timer = setInterval(() => tick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [state?.state]);
  return state?.deadline
    ? Math.max(
        0,
        Math.ceil((Date.parse(state.deadline) - coffreTime(state)) / 1000),
      )
    : 0;
}
export const clockLabel = (seconds: number) =>
  [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60]
    .map((value) => String(value).padStart(2, "0"))
    .join(" : ");
