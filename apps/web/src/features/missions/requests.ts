export interface Mission {
  id: string;
  text: string;
  pending: { id: string; recipient: string } | null;
}
export interface OwnMissions {
  score: number;
  exhausted: boolean;
  current: Mission | null;
  history: { id: string; text: string; completedAt: string }[];
}
export interface Confirmation {
  id: string;
  assignmentId: string;
  text: string;
  firstName: string;
}
export interface Player {
  id: string;
  firstName: string;
}
export interface TvMissionSettings {
  showScoresWithMemories: boolean;
}
export interface Leaderboard extends TvMissionSettings {
  players: { rank: number; firstName: string; points: number }[];
  refreshedAt: string;
}
export class MissionRequestError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code = "") {
    super("The mission request failed.");
    this.status = status;
    this.code = code;
  }
}
async function request<T>(
  path: string,
  method = "GET",
  body?: object,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      [path.startsWith("organizer/")
        ? "X-Organizer-Request"
        : "X-Guest-Request"]: "1",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.any([
      AbortSignal.timeout(15_000),
      ...(signal ? [signal] : []),
    ]),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new MissionRequestError(
      response.status,
      typeof error?.code === "string" ? error.code : "",
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
export const readOwnMissions = (signal: AbortSignal) =>
  request<OwnMissions>("missions/me", "GET", undefined, signal);
export const drawMission = (id: string, after: string | null) =>
  request<OwnMissions>("missions/me/assignments", "POST", { id, after });
export const readPlayers = (signal: AbortSignal) =>
  request<Player[]>("missions/players", "GET", undefined, signal);
export const readConfirmations = (signal: AbortSignal) =>
  request<Confirmation[]>(
    "missions/me/confirmations",
    "GET",
    undefined,
    signal,
  );
export const claimMission = (input: {
  assignmentId: string;
  id: string;
  recipientProfileId: string;
}) =>
  request<void>(
    `missions/me/assignments/${encodeURIComponent(input.assignmentId)}/claims`,
    "POST",
    { id: input.id, recipientProfileId: input.recipientProfileId },
  );
export const decideMission = (input: {
  id: string;
  decision: "confirmed" | "rejected";
}) =>
  request<void>(
    `missions/me/confirmations/${encodeURIComponent(input.id)}/decision`,
    "POST",
    { decision: input.decision },
  );
export const cancelClaim = (id: string) =>
  request<void>(`missions/me/claims/${encodeURIComponent(id)}`, "DELETE");
export const readTvMissionSettings = (signal: AbortSignal) =>
  request<TvMissionSettings>(
    "organizer/missions/tv-settings",
    "GET",
    undefined,
    signal,
  );
export const saveTvMissionSettings = (showScoresWithMemories: boolean) =>
  request<TvMissionSettings>("organizer/missions/tv-settings", "PUT", {
    showScoresWithMemories,
  });
export async function readLeaderboard(signal: AbortSignal) {
  const body = await request<Leaderboard>(
    "tv/missions/leaderboard",
    "GET",
    undefined,
    signal,
  );
  if (
    !Array.isArray(body.players) ||
    typeof body.showScoresWithMemories !== "boolean" ||
    !body.players.every(
      (row) =>
        typeof row.firstName === "string" &&
        Number.isInteger(row.points) &&
        row.points >= 0 &&
        Number.isInteger(row.rank) &&
        row.rank > 0,
    )
  )
    throw new MissionRequestError(502);
  return body;
}
export function missionError(error: unknown) {
  if (error instanceof MissionRequestError) {
    if (error.code === "CLAIM_DECIDED")
      return "Cette demande a déjà été traitée. Actualise tes missions.";
    if (error.code === "CLAIM_PENDING")
      return "Une confirmation est déjà en attente pour cette mission.";
    if (error.code === "PLAYER_UNAVAILABLE")
      return "Cette personne n’est plus disponible. Choisis un autre participant.";
    if (error.code === "MISSIONS_EXHAUSTED")
      return "Tu as terminé toutes les missions de la soirée !";
  }
  return "L’action n’a pas pu être confirmée. Réessaie : aucun point ne sera compté deux fois.";
}
