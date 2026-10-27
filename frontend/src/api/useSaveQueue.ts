import { useCallback, useEffect, useRef, useState } from 'react';
import { SaveQueue, type SaveResult, type SaveState } from './saveQueue';
import { saveRegistry } from './saveRegistry';

/**
 * React binding for SaveQueue. One queue per resource id, created when the
 * first acknowledged server value is available. When the view unmounts or the
 * id changes, an unsaved draft is sent immediately and kept in the per-tab
 * registry until acknowledged, so a remount for the same account picks it up
 * again (navigation, sign-in after expiry, failed save).
 */
export function useSaveQueue<T>(
  id: string | null,
  initial: { value: T; revision: number } | null,
  save: (draft: T, expectedRevision: number, signal: AbortSignal) => Promise<SaveResult<T>>,
  ownerId: string | null = null,
) {
  const saveRef = useRef(save);
  saveRef.current = save;
  const queueRef = useRef<{ id: string; queue: SaveQueue<T> } | null>(null);
  const [state, setState] = useState<SaveState<T> | null>(null);
  const boundSave = useCallback((draft: T, revision: number, signal: AbortSignal) => saveRef.current(draft, revision, signal), []);

  if (id && initial && queueRef.current?.id !== id) {
    if (queueRef.current) saveRegistry.release(queueRef.current.id, queueRef.current.queue);
    const queue = saveRegistry.claim<T>(id, ownerId) ?? new SaveQueue<T>({ revision: initial.revision, value: initial.value, save: boundSave });
    queue.rebind(boundSave, setState);
    saveRegistry.attach(id, ownerId, queue);
    queueRef.current = { id, queue };
  }
  if (!id && queueRef.current) {
    saveRegistry.release(queueRef.current.id, queueRef.current.queue);
    queueRef.current = null;
  }

  useEffect(() => {
    // Re-attach after a StrictMode remount, then hand the queue back on unmount.
    const current = queueRef.current;
    if (current) {
      saveRegistry.attach(current.id, ownerId, current.queue);
      current.queue.rebind(boundSave, setState);
    }
    return () => {
      if (queueRef.current) saveRegistry.release(queueRef.current.id, queueRef.current.queue);
    };
  }, []);

  const queue = queueRef.current?.queue ?? null;
  const current = state && queue && state === queue.state ? state : (queue?.state ?? null);
  const edit = useCallback((value: T) => queueRef.current?.queue.edit(value), []);
  return {
    state: current,
    value: queue ? queue.value : null,
    edit,
    flush: () => queue?.flush(),
    retry: () => queue?.retry(),
    reload: (value: T, revision: number) => queue?.reload(value, revision),
    keepMineOver: (revision: number) => queue?.keepMineOver(revision),
  };
}
