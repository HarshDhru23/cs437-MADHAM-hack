import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './client';
import { SaveQueue } from './saveQueue';
import { saveRegistry } from './saveRegistry';

describe('saveRegistry', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function dirtyQueue(id = 'plan:1', owner = 'user-a') {
    const queue = new SaveQueue<string>({ revision: 1, value: 'saved', save: () => Promise.reject(new ApiError('network', 0, 'offline', [])) });
    saveRegistry.attach(id, owner, queue);
    queue.edit('unsaved');
    return queue;
  }

  it('keeps a released queue with an unsaved draft for the same account only', async () => {
    const queue = dirtyQueue();
    saveRegistry.release('plan:1', queue);
    await vi.runAllTimersAsync();
    expect(saveRegistry.hasUnsaved()).toBe(true);
    expect(saveRegistry.claim('plan:1', 'user-a')).toBe(queue);
  });

  it('another account claiming the same resource gets nothing and the draft is dropped', async () => {
    const queue = dirtyQueue();
    saveRegistry.release('plan:1', queue);
    await vi.runAllTimersAsync();
    expect(saveRegistry.claim('plan:1', 'user-b')).toBeNull();
    expect(saveRegistry.hasUnsaved()).toBe(false);
  });

  it('a different account signing in drops the previous account\'s drafts', async () => {
    const queue = dirtyQueue();
    saveRegistry.release('plan:1', queue);
    await vi.runAllTimersAsync();
    saveRegistry.adoptFor('user-b');
    expect(saveRegistry.hasUnsaved()).toBe(false);
    expect(saveRegistry.claim('plan:1', 'user-a')).toBeNull();
  });

  it('sign-out (clear) drops every kept draft', async () => {
    const queue = dirtyQueue();
    saveRegistry.release('plan:1', queue);
    await vi.runAllTimersAsync();
    saveRegistry.clear();
    expect(saveRegistry.hasUnsaved()).toBe(false);
  });

  it('a released queue whose background save succeeds is forgotten', async () => {
    const queue = new SaveQueue<string>({ revision: 1, value: 'saved', save: async (draft, revision) => ({ value: draft, revision: revision + 1 }) });
    saveRegistry.attach('plan:1', 'user-a', queue);
    queue.edit('unsaved');
    saveRegistry.release('plan:1', queue);
    await vi.runAllTimersAsync();
    expect(saveRegistry.hasUnsaved()).toBe(false);
    expect(saveRegistry.claim('plan:1', 'user-a')).toBeNull();
  });

  it('discarding a deleted resource drops its unsaved draft, so nothing is sent to it afterwards', async () => {
    const queue = dirtyQueue();
    saveRegistry.release('plan:1', queue);
    await vi.runAllTimersAsync();
    expect(saveRegistry.hasUnsaved()).toBe(true);
    saveRegistry.discard('plan:1');
    expect(saveRegistry.hasUnsaved()).toBe(false);
    expect(saveRegistry.claim('plan:1', 'user-a')).toBeNull();
    saveRegistry.discard('plan:never-existed'); // discarding an unknown id is harmless
  });

  it('warns before the tab closes while an unsaved draft exists', async () => {
    const queue = dirtyQueue();
    saveRegistry.release('plan:1', queue);
    await vi.runAllTimersAsync();
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
