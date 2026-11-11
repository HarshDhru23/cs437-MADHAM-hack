import type { InternshipInput, ScenarioChange } from '../../api/types';

/** The unsaved edits of one scenario (its name, hypothetical changes and internship). */
export interface KeptDraft {
  label: string;
  changes: ScenarioChange[];
  internship: InternshipInput | null;
}

/**
 * Unsaved edits kept while the student visits another page and comes back (in this tab only, and only for the revision they were made on),
 * keyed `${userId}:${scenarioId}`. Signing out clears them (session.tsx), so the next sign-in never sees an earlier session's edits.
 */
export const keptDrafts = new Map<string, { draft: KeptDraft; revision: number }>();

/** Forget every kept draft (used on sign-out, and between tests). */
export function resetKeptScenarioDrafts(): void {
  keptDrafts.clear();
}
