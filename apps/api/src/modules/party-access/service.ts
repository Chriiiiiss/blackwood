// 31 October 2026, 21:00 Europe/Paris (CET).
export const defaultPartyOpensAt = "2026-10-31T20:00:00.000Z";

export function createPartyAccessService(
  opensAt = defaultPartyOpensAt,
  clock = () => new Date(),
) {
  const opening = new Date(opensAt).getTime();
  return {
    state() {
      const now = clock();
      return {
        opensAt,
        serverNow: now.toISOString(),
        isOpen: now.getTime() >= opening,
      };
    },
  };
}
export type PartyAccessService = ReturnType<typeof createPartyAccessService>;
