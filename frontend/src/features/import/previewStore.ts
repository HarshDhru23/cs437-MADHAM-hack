/**
 * Import previews created in this tab, keyed by preview ID. The server has no
 * GET route for a preview, so after a reload the review page offers a safe
 * restart instead of pretending the preview is still available. Cleared on
 * sign-out together with the import draft.
 */
import type { Issue, ImportPreview } from '../../api/types';

export interface StoredPreview {
  preview: ImportPreview;
  issues: Issue[];
  ownerId: string;
  kind: 'pdf' | 'ims';
}

const previews = new Map<string, StoredPreview>();

export const previewStore = {
  put(entry: StoredPreview) {
    previews.set(entry.preview.id, entry);
  },
  get(id: string, ownerId: string | undefined): StoredPreview | undefined {
    const entry = previews.get(id);
    return entry && entry.ownerId === ownerId ? entry : undefined;
  },
  remove(id: string) {
    previews.delete(id);
  },
  clear() {
    previews.clear();
  },
};
