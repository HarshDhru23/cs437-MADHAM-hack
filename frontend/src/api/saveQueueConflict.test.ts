import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './client';
import { SaveQueue, type SaveState } from './saveQueue';

/** CR-68 (CP-29): after a 409 nothing is sent until the student chooses, even if they edited while that save was in flight. */
interface Doc {
  value: string;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('SaveQueue after a 409', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(save: (draft: Doc, revision: number) => Promise<{ revision: number; value: Doc }>) {
    const states: SaveState<Doc>[] = [];
    const queue = new SaveQueue<Doc>({ revision: 3, value: { value: 'server' }, save, onChange: (s) => states.push(s) });
    return { queue, states };
  }

  it('an edit made while a save is in flight is not sent when that save is refused with 409', async () => {
    const first = deferred<{ revision: number; value: Doc }>();
    const save = vi.fn((_draft: Doc, _revision: number) => first.promise);
    const { queue, states } = setup(save);
    queue.edit({ value: 'A' });
    await vi.advanceTimersByTimeAsync(500);   // A is in flight
    queue.edit({ value: 'B' });                // edited while it is in flight
    first.reject(new ApiError('conflict', 409, 'stale', [], { currentRevision: 5 }));
    await vi.advanceTimersByTimeAsync(5000);   // far longer than the debounce
    expect(save.mock.calls.map((c) => [c[0].value, c[1]])).toEqual([['A', 3]]);
    expect(queue.state).toMatchObject({ status: 'conflict', draft: { value: 'B' }, conflictRevision: 5, revision: 3 });
    const afterConflict = states.slice(states.findIndex((s) => s.status === 'conflict'));
    expect(afterConflict.length).toBeGreaterThan(0);
    expect(afterConflict.every((s) => s.status === 'conflict')).toBe(true);   // never flips back to pending or saving after the 409
  });

  it('keeps editing locally in the conflict state without sending, and keep-mine still sends once, against the newer revision', async () => {
    const first = deferred<{ revision: number; value: Doc }>();
    const save = vi.fn((draft: Doc, revision: number) => (revision === 3 ? first.promise : Promise.resolve({ revision: revision + 1, value: draft })));
    const { queue } = setup(save);
    queue.edit({ value: 'A' });
    await vi.advanceTimersByTimeAsync(500);
    queue.edit({ value: 'B' });
    first.reject(new ApiError('conflict', 409, 'stale', [], { currentRevision: 5 }));
    await vi.advanceTimersByTimeAsync(1000);
    queue.edit({ value: 'C' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).toHaveBeenCalledTimes(1);
    queue.keepMineOver(5);   // the student's explicit choice
    await vi.runAllTimersAsync();
    expect(save.mock.calls.map((c) => [c[0].value, c[1]])).toEqual([['A', 3], ['C', 5]]);
    expect(queue.state).toMatchObject({ status: 'saved', revision: 6, draft: null });
  });

  it('a draft waiting behind the in-flight save is still sent after that save succeeds (negative: no conflict, normal path)', async () => {
    const first = deferred<{ revision: number; value: Doc }>();
    const save = vi.fn((draft: Doc, revision: number) => (revision === 3 ? first.promise : Promise.resolve({ revision: revision + 1, value: draft })));
    const { queue } = setup(save);
    queue.edit({ value: 'A' });
    await vi.advanceTimersByTimeAsync(500);
    queue.edit({ value: 'B' });
    first.resolve({ revision: 4, value: { value: 'A' } });
    await vi.runAllTimersAsync();
    expect(save.mock.calls.map((c) => [c[0].value, c[1]])).toEqual([['A', 3], ['B', 4]]);
    expect(queue.state).toMatchObject({ status: 'saved', revision: 5 });
  });
});
