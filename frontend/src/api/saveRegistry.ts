/**
 * Per-tab registry of save queues, so an unsaved draft survives the view that
 * edited it: in-app navigation, a sign-in after session expiry, or a failed
 * save. Drafts stay in memory only (never storage/URLs) and belong to one
 * account: sign-out or a different account signing in drops them. Closing the
 * tab while a draft is unsaved triggers the browser's leave-page warning.
 */
import type { SaveQueue } from './saveQueue';

interface Entry {
  queue: SaveQueue<unknown>;
  ownerId: string | null;
  mounted: boolean;
}

const entries = new Map<string, Entry>();

function forget(id: string, entry: Entry) {
  if (entries.get(id) === entry) entries.delete(id);
  entry.queue.dispose();
}

export const saveRegistry = {
  /** A mounted view owns this queue. */
  attach<T>(id: string, ownerId: string | null, queue: SaveQueue<T>): void {
    entries.set(id, { queue: queue as unknown as SaveQueue<unknown>, ownerId, mounted: true });
  },

  /** Take over a kept queue for the same account, if one exists. */
  claim<T>(id: string, ownerId: string | null): SaveQueue<T> | null {
    const entry = entries.get(id);
    if (!entry || entry.mounted) return null;
    if (entry.ownerId !== ownerId) {
      forget(id, entry);
      return null;
    }
    entry.mounted = true;
    return entry.queue as unknown as SaveQueue<T>;
  },

  /**
   * The view went away. A queue with an unsaved draft sends it now and is kept
   * until the server acknowledges it; otherwise it is disposed.
   */
  release<T>(id: string, queue: SaveQueue<T>): void {
    const entry = entries.get(id);
    const tracked = entry?.queue === (queue as unknown as SaveQueue<unknown>);
    if (!entry || !tracked || queue.state.draft === null) {
      if (entry && tracked) entries.delete(id);
      queue.dispose();
      return;
    }
    entry.mounted = false;
    queue.listen((state) => {
      if (state.draft === null && !entry.mounted) forget(id, entry);
    });
    queue.sendNow();
  },

  /** The resource itself was deleted: drop its queue (and any unsaved draft) so nothing is sent to it afterwards. */
  discard(id: string): void {
    const entry = entries.get(id);
    if (entry) forget(id, entry);
  },

  hasUnsaved(): boolean {
    for (const entry of entries.values()) if (entry.queue.state.draft !== null) return true;
    return false;
  },

  /** A user signed in: keep only that account's drafts, and send the ones an expired session stopped (CR-73). */
  adoptFor(userId: string): void {
    for (const [id, entry] of [...entries]) {
      if (entry.ownerId !== userId && !entry.mounted) forget(id, entry);
      else if (entry.ownerId === userId) entry.queue.resumeAfterSignIn();
    }
  },

  /** Sign-out: drop every kept draft. */
  clear(): void {
    for (const [id, entry] of [...entries]) forget(id, entry);
  },
};

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (event) => {
    if (!saveRegistry.hasUnsaved()) return;
    event.preventDefault();
    // Older browsers show the leave-page prompt only when returnValue is set.
    event.returnValue = '';
  });
}
