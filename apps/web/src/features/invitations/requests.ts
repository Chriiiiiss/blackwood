import type {
  FieldErrors,
  InvitationFields,
  InvitationInput,
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

function isResponse(value: unknown, id: string): value is InvitationResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Partial<InvitationResponse>;
  return (
    response.id === id &&
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
): Promise<InvitationResponse | null> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = window.setTimeout(abort, requestTimeout);
  try {
    const response = await fetch(`/api/invitation-responses/${id}`, {
      method: input ? "PUT" : "GET",
      ...(input && {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
      signal: controller.signal,
    });
    if (!input && response.status === 404) return null;
    const body: unknown = await response.json();
    if (input && response.status === 400)
      throw new ResponseValidationError(serverFieldErrors(body));
    if (!response.ok || !isResponse(body, id))
      throw new Error("The response could not be accessed.");
    return body;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

export function loadResponse(id: string, signal: AbortSignal) {
  return request(id, undefined, signal);
}

export async function saveResponse(
  id: string,
  input: InvitationInput,
  signal: AbortSignal,
): Promise<InvitationResponse> {
  const response = await request(id, input, signal);
  if (!response) throw new Error("The response could not be saved.");
  return response;
}
