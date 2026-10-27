export type MediaActor =
  | { kind: "anonymous" }
  | { kind: "guest"; profileId: string }
  | { kind: "organizer" }
  | { kind: "tv" };

export interface ContributionMediaContext {
  visibility: "public" | "private";
  revealed: boolean;
  current: boolean;
  deleted: boolean;
}

// Context must come from Coffre's stored contribution and server clock, never a client.
export function canReadContributionMedia(
  actor: MediaActor,
  context: ContributionMediaContext | null,
  tv = false,
) {
  if (!context || context.deleted || actor.kind === "anonymous") return false;
  return (
    (!tv && actor.kind === "organizer") ||
    (tv &&
      actor.kind === "tv" &&
      context.visibility === "public" &&
      context.revealed &&
      context.current)
  );
}

export function canDepositContributionMedia(
  actor: MediaActor,
  context: {
    state: "prepared" | "collecting" | "revealed";
    deadline: Date | null;
  } | null,
  now: Date,
) {
  if (
    !context ||
    actor.kind === "anonymous" ||
    actor.kind === "tv" ||
    context.state === "revealed"
  )
    return false;
  if (context.state === "prepared") return actor.kind === "organizer";
  return context.deadline !== null && now < context.deadline;
}
