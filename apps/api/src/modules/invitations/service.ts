import type { InvitationRepository } from "./repository.ts";
import type { InvitationInput } from "./schemas.ts";

export function trimInvitationFirstName(input: unknown) {
  if (
    input &&
    typeof input === "object" &&
    "firstName" in input &&
    typeof input.firstName === "string"
  ) {
    input.firstName = input.firstName.trim();
  }
}

export function createInvitationService(repository: InvitationRepository) {
  return {
    async save(id: string, input: InvitationInput) {
      return repository.upsert(id, normalizeInvitationInput(input));
    },

    async findById(id: string) {
      return repository.findById(id);
    },
  };
}

export function normalizeInvitationInput(input: InvitationInput) {
  return {
    firstName: input.firstName,
    attendance: input.attendance,
    plusOne: input.attendance === "no" ? false : (input.plusOne ?? false),
    ideas: input.ideas?.trim() ? input.ideas : null,
  };
}

export type InvitationService = ReturnType<typeof createInvitationService>;
