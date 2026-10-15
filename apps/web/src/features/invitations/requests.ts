import type {
  FieldErrors,
  InvitationFields,
  InvitationInput,
  InvitationRecord,
  InvitationResponse,
} from "./model";

const requestTimeout = 15_000;

export class ResponseValidationError extends Error {
  readonly fields: FieldErrors;

  constructor(fields: FieldErrors) {
    super("The invitation response is invalid.");
    this.fields = fields;
  }
}

function isResponse(value: unknown, id?: string): value is InvitationRecord {
  if (!value || typeof value !== "object") return false;
  const response = value as Partial<InvitationResponse>;
  return (
    (!id || response.id === id) &&
    typeof response.firstName === "string" &&
    ["yes", "no", "to_confirm"].includes(response.attendance ?? "") &&
    typeof response.plusOne === "boolean" &&
    (typeof response.ideas === "string" || response.ideas === null)
  );
}

function serverFieldErrors(body: unknown): FieldErrors {
  if (!body || typeof body !== "object" || !("errors" in body)) return {};
  if (!Array.isArray(body.errors)) return {};
  const messages: Record<keyof InvitationFields, string> = {
    firstName: "Indique un prénom de 1 à 50, fais pas le timide.",
    attendance: "Dans la vie, il faut choisir.",
    plusOne: "Hep hep hep, t'es solo bolo ?",
    ideas: "Abuse pas sur les idées, j'ai pas demandé un roman.",
  };
  const fields: FieldErrors = {};
  for (const issue of body.errors) {
    if (
      issue &&
      typeof issue === "object" &&
      typeof issue.field === "string" &&
      Object.hasOwn(messages, issue.field)
    ) {
      const field = issue.field as keyof InvitationFields;
      fields[field] = messages[field];
    }
  }
  return fields;
}

async function request(
  id: string,
  input?: InvitationInput,
  signal?: AbortSignal,
  authenticated = false,
): Promise<InvitationRecord | null> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = window.setTimeout(abort, requestTimeout);
  try {
    const response = await fetch(
      authenticated
        ? "/api/profiles/me/invitation-response"
        : `/api/invitation-responses/${id}`,
      {
        method: input ? "PUT" : "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "X-Guest-Request": "1",
          ...(input ? { "Content-Type": "application/json" } : {}),
        },
        ...(input && {
          body: JSON.stringify(input),
        }),
        signal: controller.signal,
      },
    );
    if (!input && !authenticated && response.status === 404) return null;
    const body: unknown = await response.json();
    if (input && response.status === 400)
      throw new ResponseValidationError(serverFieldErrors(body));
    if (!response.ok || !isResponse(body, authenticated ? undefined : id))
      throw new Error("The response could not be accessed.");
    return body;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

export function loadResponse(
  id: string,
  signal: AbortSignal,
  authenticated = false,
) {
  return request(id, undefined, signal, authenticated);
}

export async function saveResponse(
  id: string,
  input: InvitationInput,
  signal: AbortSignal,
  authenticated = false,
): Promise<InvitationRecord> {
  const response = await request(id, input, signal, authenticated);
  if (!response) throw new Error("The response could not be saved.");
  return response;
}
