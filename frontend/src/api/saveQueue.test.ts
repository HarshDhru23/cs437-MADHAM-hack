import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './client';
import { SaveQueue, type SaveState } from './saveQueue';

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

describe('SaveQueue', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(save: (draft: Doc, revision: number) => Promise<{ revision: number; value: Doc }>) {
    const states: SaveState<Doc>[] = [];
    const queue = new SaveQueue<Doc>({ revision: 1, value: { value: 'a' }, save, onChange: (s) => states.push(s) });
    return { queue, states };
  }

  it('debounces edits about 500ms and sends only the latest draft', async () => {
    const save = vi.fn(async (draft: Doc, revision: number) => ({ revision: revision + 1, value: draft }));
    const { queue } = setup(save);
    queue.edit({ value: 'b' });
    queue.edit({ value: 'c' });
    expect(queue.state.status).toBe('pending');
    await vi.advanceTimersByTimeAsync(499);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ value: 'c' }, 1, expect.anything());
    await vi.runAllTimersAsync();
    expect(queue.state).toMatchObject({ status: 'saved', revision: 2, draft: null, acknowledged: { value: 'c' } });
  });

  it('serializes saves: an edit during an in-flight save waits for acknowledgement', async () => {
    const first = deferred<{ revision: number; value: Doc }>();
    const save = vi.fn((draft: Doc, revision: number) => (revision === 1 ? first.promise : Promise.resolve({ revision: revision + 1, value: draft })));
    const { queue } = setup(save);
    queue.edit({ value: 'b' });
    await vi.advanceTimersByTimeAsync(500);
    expect(queue.state.status).toBe('saving');
    queue.edit({ value: 'c' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
    first.resolve({ revision: 2, value: { value: 'b' } });
    await vi.runAllTimersAsync();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]?.slice(0, 2)).toEqual([{ value: 'c' }, 2]);
    expect(queue.state).toMatchObject({ status: 'saved', revision: 3 });
  });

  it('keeps the dirty draft after a failed save and can retry it', async () => {
    let fail = true;
    const save = vi.fn(async (draft: Doc, revision: number) => {
      if (fail) throw new ApiError('server', 500, 'boom', []);
      return { revision: revision + 1, value: draft };
    });
    const { queue } = setup(save);
    queue.edit({ value: 'unsaved' });
    await vi.runAllTimersAsync();
    expect(queue.state).toMatchObject({ status: 'error', draft: { value: 'unsaved' }, revision: 1 });
    fail = false;
    queue.retry();
    await vi.runAllTimersAsync();
    expect(queue.state).toMatchObject({ status: 'saved', draft: null, revision: 2 });
  });

  it('distinguishes offline from server errors and keeps the draft', async () => {
    const save = vi.fn(async () => {
      throw new ApiError('network', 0, 'offline', []);
    });
    const { queue } = setup(save);
    queue.edit({ value: 'x' });
    await vi.runAllTimersAsync();
    expect(queue.state).toMatchObject({ status: 'offline', draft: { value: 'x' } });
  });

  it('stops on 409 conflict without retrying automatically and preserves the draft', async () => {
    const save = vi.fn(async () => {
      throw new ApiError('conflict', 409, 'stale', [], { currentRevision: 5 });
    });
    const { queue } = setup(save);
    queue.edit({ value: 'mine' });
    await vi.runAllTimersAsync();
    expect(queue.state).toMatchObject({ status: 'conflict', draft: { value: 'mine' }, conflictRevision: 5, revision: 1 });
    queue.edit({ value: 'mine-2' });
    await vi.runAllTimersAsync();
    expect(save).toHaveBeenCalledTimes(1);
    expect(queue.state).toMatchObject({ status: 'conflict', draft: { value: 'mine-2' } });
  });

  it('reload after conflict discards the draft and adopts the server revision', async () => {
    const save = vi.fn(async () => {
      throw new ApiError('conflict', 409, 'stale', [], { currentRevision: 5 });
    });
    const { queue } = setup(save);
    queue.edit({ value: 'mine' });
    await vi.runAllTimersAsync();
    queue.reload({ value: 'server' }, 5);
    expect(queue.state).toMatchObject({ status: 'saved', draft: null, revision: 5, acknowledged: { value: 'server' } });
  });

  it('only resubmits the draft on an explicit user choice after comparing', async () => {
    const save = vi.fn(async (draft: Doc, revision: number) => {
      if (revision === 1) throw new ApiError('conflict', 409, 'stale', [], { currentRevision: 5 });
      return { revision: revision + 1, value: draft };
    });
    const { queue } = setup(save);
    queue.edit({ value: 'mine' });
    await vi.runAllTimersAsync();
    queue.keepMineOver(5);
    await vi.runAllTimersAsync();
    expect(save).toHaveBeenLastCalledWith({ value: 'mine' }, 5, expect.anything());
    expect(queue.state).toMatchObject({ status: 'saved', revision: 6 });
  });

  it('flush sends a pending draft immediately', async () => {
    const save = vi.fn(async (draft: Doc, revision: number) => ({ revision: revision + 1, value: draft }));
    const { queue } = setup(save);
    queue.edit({ value: 'now' });
    await queue.flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(queue.state.status).toBe('saved');
  });
});
