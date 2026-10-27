import { type ContributionDraft, newDraft } from "./requests";

export interface ComposerState {
  draft: ContributionDraft;
  attempt: ContributionDraft | null;
}
export const createComposerState = (): ComposerState => ({
  draft: newDraft(),
  attempt: null,
});
