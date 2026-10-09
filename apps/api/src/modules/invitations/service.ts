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
      return repository.upsert(id, {
        firstName: input.firstName,
        attendance: input.attendance,
        plusOne: input.attendance === "no" ? false : (input.plusOne ?? false),
        ideas: input.ideas?.trim() ? input.ideas : null,
      });
    },

    async findById(id: string) {
      return repository.findById(id);
    },
  };
}

export type InvitationService = ReturnType<typeof createInvitationService>;
