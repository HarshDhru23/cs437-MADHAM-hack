/**
 * In-memory pending import input. It survives in-app navigation and a sign-in
 * transition, but is never written to URLs, storage, logs or analytics. A full
 * page reload discards it; the UI says so instead of pretending a file remains.
 */
import { useSyncExternalStore } from 'react';

export type ImportKind = 'pdf' | 'ims';

export interface ImportDraft {
  kind: ImportKind;
  text: string;
  file: File | null;
  /** User who created the draft; null when drafted before sign-in. */
  ownerId: string | null;
}

const EMPTY: ImportDraft = { kind: 'pdf', text: '', file: null, ownerId: null };
let draft: ImportDraft = EMPTY;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export const importDraftStore = {
  get: () => draft,
  update(patch: Partial<ImportDraft>) {
    draft = { ...draft, ...patch };
    emit();
  },
  clear() {
    draft = EMPTY;
    emit();
  },
  /** Called when a user signs in: keep anonymous/own drafts, drop another user's. */
  adoptFor(userId: string) {
    if (draft.ownerId !== null && draft.ownerId !== userId) draft = EMPTY;
    else draft = { ...draft, ownerId: draft.text || draft.file ? userId : null };
    emit();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useImportDraft(): ImportDraft {
  return useSyncExternalStore(importDraftStore.subscribe, importDraftStore.get, importDraftStore.get);
}
