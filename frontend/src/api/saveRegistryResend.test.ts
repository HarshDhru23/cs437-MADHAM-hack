import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './client';
import { SaveQueue } from './saveQueue';
import { saveRegistry } from './saveRegistry';

/** CR-73 (CP-29): a draft whose save hit an expired session is sent again, once, when the same account signs back in. */
describe('saving again after the session expired', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    saveRegistry.clear();
    vi.useRealTimers();
  });

  /** The first save finds the session expired (401); later saves follow `next`. */
  function expiredQueue(next: (draft: string, revision: number) => Promise<{ revision: number; value: string }>, id = 'plan:1', owner = 'user-a') {
    let calls = 0;
    const save = vi.fn((draft: string, revision: number) => (calls++ === 0 ? Promise.reject(new ApiError('auth', 401, 'expired', [])) : next(draft, revision)));
    const queue = new SaveQueue<string>({ revision: 4, value: 'saved', save });
    saveRegistry.attach(id, owner, queue);
    queue.edit('unsaved');
    return { queue, save };
  }
  const ok = (draft: string, revision: number) => Promise.resolve({ revision: revision + 1, value: draft });

  it('sends the kept draft when the same account signs in again, with the revision it was based on', async () => {
    const { queue, save } = expiredQueue(ok);
    await vi.runAllTimersAsync();
    expect(queue.state).toMatchObject({ status: 'error', draft: 'unsaved' });
    expect(save).toHaveBeenCalledTimes(1);
    saveRegistry.adoptFor('user-a');
    await vi.runAllTimersAsync();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]?.slice(0, 2)).toEqual(['unsaved', 4]);
    expect(queue.state).toMatchObject({ status: 'saved', draft: null, revision: 5, error: null });
  });

  it('does the same for a queue whose page was left while the session was expired', async () => {
    const { queue, save } = expiredQueue(ok);
    saveRegistry.release('plan:1', queue);
    await vi.runAllTimersAsync();
    saveRegistry.adoptFor('user-a');
    await vi.runAllTimersAsync();
    expect(save).toHaveBeenCalledTimes(2);
    expect(saveRegistry.hasUnsaved()).toBe(false);
  });

  it('a draft that is now stale still gets a 409 and then waits for the student (revision checks still apply)', async () => {
    const stale = vi.fn((_draft: string, _revision: number) => Promise.reject(new ApiError('conflict', 409, 'stale', [], { currentRevision: 9 })));
    const { queue } = expiredQueue(stale);
    await vi.runAllTimersAsync();
    saveRegistry.adoptFor('user-a');
    await vi.runAllTimersAsync();
    expect(stale).toHaveBeenCalledTimes(1);
    expect(queue.state).toMatchObject({ status: 'conflict', conflictRevision: 9, draft: 'unsaved' });
  });

  it('a different account signing in drops the draft and sends nothing', async () => {
    const { queue, save } = expiredQueue(ok);
    saveRegistry.release('plan:1', queue);
    await vi.runAllTimersAsync();
    saveRegistry.adoptFor('user-b');
    await vi.runAllTimersAsync();
    expect(save).toHaveBeenCalledTimes(1);
    expect(saveRegistry.hasUnsaved()).toBe(false);
  });

  it('a save that failed for another reason is not resent by a sign-in', async () => {
    // Negative: only an expired session is "waiting for sign-in"; a server error keeps its Retry button.
    const save = vi.fn(() => Promise.reject(new ApiError('server', 500, 'broken', [])));
    const queue = new SaveQueue<string>({ revision: 1, value: 'saved', save });
    saveRegistry.attach('plan:2', 'user-a', queue);
    queue.edit('unsaved');
    await vi.runAllTimersAsync();
    saveRegistry.adoptFor('user-a');
    await vi.runAllTimersAsync();
    expect(save).toHaveBeenCalledTimes(1);
    expect(queue.state.status).toBe('error');
  });

  it('a sign-in with nothing waiting sends nothing', async () => {
    const save = vi.fn(ok);
    const queue = new SaveQueue<string>({ revision: 1, value: 'saved', save });
    saveRegistry.attach('plan:3', 'user-a', queue);
    saveRegistry.adoptFor('user-a');
    await vi.runAllTimersAsync();
    expect(save).not.toHaveBeenCalled();
  });
});
