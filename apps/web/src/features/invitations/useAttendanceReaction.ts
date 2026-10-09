import { useEffect, useState } from "react";
import type { Attendance } from "./model";

export function useAttendanceReaction() {
  const [reactionId, setReactionId] = useState(0);

  useEffect(() => {
    if (!reactionId) return;
    const timer = window.setTimeout(() => setReactionId(0), 4_000);
    return () => window.clearTimeout(timer);
  }, [reactionId]);

  return {
    reactionId,
    react: (attendance: Attendance | "") =>
      setReactionId((current) => (attendance === "yes" ? 0 : current + 1)),
    dismiss: () => setReactionId(0),
  };
}
