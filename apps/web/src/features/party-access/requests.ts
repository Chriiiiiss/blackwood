export interface PartyAccess {
  opensAt: string;
  serverNow: string;
  isOpen: boolean;
}
export async function readPartyAccess(
  signal: AbortSignal,
): Promise<PartyAccess> {
  const response = await fetch("/api/party-access", {
    credentials: "same-origin",
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  });
  if (!response.ok) throw new Error("Unable to verify party opening.");
  const body = await response.json();
  if (
    typeof body?.isOpen !== "boolean" ||
    typeof body.opensAt !== "string" ||
    !Number.isFinite(Date.parse(body.opensAt)) ||
    typeof body.serverNow !== "string" ||
    !Number.isFinite(Date.parse(body.serverNow))
  )
    throw new Error("Invalid party opening response.");
  return body;
}
