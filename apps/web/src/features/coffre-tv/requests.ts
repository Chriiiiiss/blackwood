import {
  CoffreRequestError,
  type CoffreState,
  type PublicContribution,
  parseCoffreState,
} from "../coffre/requests";

async function request(path: string, signal: AbortSignal) {
  const response = await fetch(`/api/tv/coffre${path}`, {
    credentials: "same-origin",
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new CoffreRequestError(
      response.status,
      typeof body?.code === "string" ? body.code : "",
    );
  }
  return response.json();
}
export async function readTvState(signal: AbortSignal): Promise<CoffreState> {
  return parseCoffreState(await request("", signal));
}
export async function readTvPage(
  coffreId: number,
  after: string | null,
  signal: AbortSignal,
): Promise<{ contributions: PublicContribution[]; nextCursor: string | null }> {
  const query = new URLSearchParams({ coffreId: String(coffreId) });
  if (after) query.set("after", after);
  const body = await request(`/contributions?${query}`, signal);
  if (
    !Array.isArray(body?.contributions) ||
    !(body.nextCursor === null || typeof body.nextCursor === "string")
  )
    throw new CoffreRequestError(502);
  const contributions: PublicContribution[] = body.contributions.map(
    (row: Record<string, unknown>) => {
      if (
        typeof row.id !== "string" ||
        !(row.text === null || typeof row.text === "string") ||
        !(row.photoMediaId === null || typeof row.photoMediaId === "string") ||
        !["plain", "one-wish-willow"].includes(String(row.frameId)) ||
        typeof row.createdAt !== "string"
      )
        throw new CoffreRequestError(502);
      return {
        id: row.id,
        text: row.text,
        photoMediaId: row.photoMediaId,
        frameId: row.frameId as PublicContribution["frameId"],
        createdAt: row.createdAt,
      };
    },
  );
  return { contributions, nextCursor: body.nextCursor };
}
