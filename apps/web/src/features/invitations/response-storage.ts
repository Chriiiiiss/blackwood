const responseStorageKey = "blackwood.invitation-response-id";
const uuidV4 =
  /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

export class StorageUnavailableError extends Error {}

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
    const id = readResponseId() ?? crypto.randomUUID();
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
