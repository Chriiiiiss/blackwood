import type { ProfileService } from "../profiles/service.ts";
import type { ActivityRepository } from "./repository.ts";
import type { ActivityInput } from "./schemas.ts";

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
export function canonicalActivityRoute(route?: string) {
  if (
    !route ||
    !/^\/api\/(?:guest-access|profiles|companion-invitations|coffre|missions|media|invitation-responses)(?:\/|$)/.test(
      route,
    )
  )
    return null;
  return (
    route
      .split(/[?#]/)[0]
      ?.split("/")
      .map((segment) => (!segment || segments.has(segment) ? segment : ":id"))
      .join("/") ?? null
  );
}
export function createActivityService(
  repository: ActivityRepository,
  profiles: Pick<ProfileService, "access">,
  clock = () => Date.now(),
) {
  const budgets = new Map<string, { start: number; count: number }>();
  return {
    async record(input: ActivityInput, token?: string) {
      const { profile } = await profiles.access(token);
      const key = profile?.id ?? "anonymous";
      const now = clock();
      let bucket = budgets.get(key);
      if (!bucket || now - bucket.start >= 60_000) {
        if (budgets.size >= 512) budgets.clear();
        bucket = { start: now, count: 0 };
        budgets.set(key, bucket);
      }
      if (++bucket.count > 60) return;
      await repository.record({
        ...input,
        profileId: profile?.id ?? null,
        route: canonicalActivityRoute(input.route),
      });
    },
    feed: repository.feed,
  };
}
export type ActivityService = ReturnType<typeof createActivityService>;
