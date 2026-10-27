export type MediaActor =
  | { kind: "anonymous" }
  | { kind: "guest"; profileId: string }
  | { kind: "organizer" };

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
) {
  if (!context || context.deleted || actor.kind === "anonymous") return false;
  return (
    actor.kind === "organizer" ||
    (context.visibility === "public" && context.revealed && context.current)
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
  if (!context || actor.kind === "anonymous" || context.state === "revealed")
    return false;
  if (context.state === "prepared") return actor.kind === "organizer";
  return context.deadline !== null && now < context.deadline;
}
