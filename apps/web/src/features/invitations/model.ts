export type Attendance = "yes" | "no" | "to_confirm";

export interface InvitationFields {
  firstName: string;
  attendance: Attendance | "";
  plusOne: "yes" | "no" | "";
  ideas: string;
}

export interface InvitationInput {
  firstName: string;
  attendance: Attendance;
  plusOne: boolean;
  ideas: string;
}

export interface InvitationRecord {
  firstName: string;
  attendance: Attendance;
  plusOne: boolean;
  ideas: string | null;
}

export interface InvitationResponse extends InvitationRecord {
  id: string;
}

export type FieldErrors = Partial<Record<keyof InvitationFields, string>>;

export const emptyFields: InvitationFields = {
  firstName: "",
  attendance: "",
  plusOne: "",
  ideas: "",
};

export function characterCount(value: string): number {
  return Array.from(value).length;
}

export function validateFields(fields: InvitationFields): FieldErrors {
  const errors: FieldErrors = {};
  const firstName = fields.firstName.trim();
  if (!firstName) errors.firstName = "Indique ton prénom.";
  else if (characterCount(firstName) > 50)
    errors.firstName = "50 caractères maximum.";
  if (!fields.attendance) errors.attendance = "Choisis ta réponse.";
  if (fields.attendance && fields.attendance !== "no" && !fields.plusOne)
    errors.plusOne = "Indique si tu viens avec un +1.";
  if (characterCount(fields.ideas) > 1000)
    errors.ideas = "1 000 caractères maximum.";
  return errors;
}

export function toInput(fields: InvitationFields): InvitationInput {
  if (!fields.attendance) throw new Error("Attendance is required.");
  return {
    firstName: fields.firstName.trim(),
    attendance: fields.attendance,
    plusOne: fields.attendance !== "no" && fields.plusOne === "yes",
    ideas: fields.ideas.trim() ? fields.ideas : "",
  };
}

export function toFields(response: InvitationRecord): InvitationFields {
  return {
    firstName: response.firstName,
    attendance: response.attendance,
    plusOne:
      response.attendance === "no" ? "" : response.plusOne ? "yes" : "no",
    ideas: response.ideas ?? "",
  };
}
