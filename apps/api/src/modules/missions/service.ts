import { missionCatalog } from "./catalog.ts";
import type { MissionActor, MissionRepository } from "./repository.ts";

export function createMissionService(repository: MissionRepository) {
  async function own(profileId: string) {
    const { rows, pending } = await repository.own(profileId);
    const history = rows
      .filter((row) => row.completedAt)
      .map((row) => ({
        id: row.id,
        text: row.text,
        completedAt: row.completedAt?.toISOString() ?? "",
      }));
    const current = rows.find((row) => !row.completedAt);
    const claim = current
      ? pending.find((row) => row.assignmentId === current.id)
      : undefined;
    return {
      score: history.length,
      exhausted: history.length >= missionCatalog.length,
      current: current
        ? {
            id: current.id,
            text: current.text,
            pending: claim
              ? { id: claim.id, recipient: claim.recipient }
              : null,
          }
        : null,
      history,
    };
  }
  return {
    own,
    async draw(actor: MissionActor, id: string, after: string | null) {
      await repository.draw(actor, id, after);
      return own(actor.profileId);
    },
    players: repository.players,
    claim: repository.claim,
    incoming: repository.incoming,
    decide: repository.decide,
    settings: repository.settings,
    saveSettings: repository.saveSettings,
    async leaderboard() {
      const [players, settings] = await Promise.all([
        repository.leaderboard(),
        repository.settings(),
      ]);
      return { players, ...settings, refreshedAt: new Date().toISOString() };
    },
  };
}
export type MissionService = ReturnType<typeof createMissionService>;
