import { useCallback, useEffect, useRef, useState } from 'react';
import { SaveQueue, type SaveResult, type SaveState } from './saveQueue';

/**
 * React binding for SaveQueue. One queue per resource id; it is created when
 * the first acknowledged server value is available and disposed on id change.
 */
export function useSaveQueue<T>(
  id: string | null,
  initial: { value: T; revision: number } | null,
  save: (draft: T, expectedRevision: number, signal: AbortSignal) => Promise<SaveResult<T>>,
) {
  const saveRef = useRef(save);
  saveRef.current = save;
  const queueRef = useRef<{ id: string; queue: SaveQueue<T> } | null>(null);
  const [state, setState] = useState<SaveState<T> | null>(null);

  if (id && initial && queueRef.current?.id !== id) {
    queueRef.current?.queue.dispose();
    const queue = new SaveQueue<T>({
      revision: initial.revision,
      value: initial.value,
      save: (draft, revision, signal) => saveRef.current(draft, revision, signal),
      onChange: setState,
    });
    queueRef.current = { id, queue };
  }
  if (!id && queueRef.current) {
    queueRef.current.queue.dispose();
    queueRef.current = null;
  }

  useEffect(() => () => queueRef.current?.queue.dispose(), []);

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
