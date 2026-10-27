import { type Dispatch, type SetStateAction, useMemo } from "react";
import { type ContributionDraft, newDraft } from "./requests";

export interface ComposerState {
  draft: ContributionDraft;
  attempt: ContributionDraft | null;
}
export type ComposerStore = [
  Record<number, ComposerState>,
  Dispatch<SetStateAction<Record<number, ComposerState>>>,
];
export const createComposerState = (coffreId = 1): ComposerState => ({
  draft: newDraft(coffreId),
  attempt: null,
});
export function useCoffreComposer(
  [states, update]: ComposerStore,
  coffreId: number,
): [ComposerState, Dispatch<SetStateAction<ComposerState>>] {
  const empty = useMemo(() => createComposerState(coffreId), [coffreId]);
  return [
    states[coffreId] ?? empty,
    (action) =>
      update((previous) => ({
        ...previous,
        [coffreId]:
          typeof action === "function"
            ? action(previous[coffreId] ?? empty)
            : action,
      })),
  ];
}
