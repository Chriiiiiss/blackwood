const responseStorageKey = "blackwood.invitation-response-id";
const uuidV4 =
  /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

export class StorageUnavailableError extends Error {}

function randomResponseId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // getRandomValues remains available on HTTP LAN development origins.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function readResponseId(): string | null {
  try {
    const id = localStorage.getItem(responseStorageKey);
    if (id && uuidV4.test(id)) return id;
    if (id !== null) localStorage.removeItem(responseStorageKey);
    return null;
  } catch {
    throw new StorageUnavailableError("Local storage is unavailable.");
  }
}

export function ensureResponseId(): string {
  try {
    const id = readResponseId() ?? randomResponseId();
    localStorage.setItem(responseStorageKey, id);
    if (localStorage.getItem(responseStorageKey) !== id)
      throw new StorageUnavailableError(
        "The response identifier was not saved.",
      );
    return id;
  } catch {
    throw new StorageUnavailableError("Local storage is unavailable.");
  }
}
