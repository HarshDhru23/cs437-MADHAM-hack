import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Envelope } from './types';
import { ResourceCacheProvider, useResource, useResourceCache } from './resources';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const env = <T,>(data: T): Envelope<T> => ({ data, issues: [], schema_version: '1' });

function Probe({ resourceKey, loader }: { resourceKey: string | null; loader: (signal: AbortSignal) => Promise<Envelope<string>> }) {
  const state = useResource(resourceKey, loader);
  return <p>{state.loading ? 'loading' : state.error ? `error:${state.error.kind}` : `data:${state.data ?? 'none'}`}</p>;
}

describe('useResource', () => {
  it('discards a stale in-flight response when the revision key changes', async () => {
    const first = deferred<Envelope<string>>();
    const second = deferred<Envelope<string>>();
    const loaders = { 'analysis:u1:r1': () => first.promise, 'analysis:u1:r2': () => second.promise };
    const { rerender } = render(
      <ResourceCacheProvider>
        <Probe resourceKey="analysis:u1:r1" loader={loaders['analysis:u1:r1']} />
      </ResourceCacheProvider>,
    );
    rerender(
      <ResourceCacheProvider>
        <Probe resourceKey="analysis:u1:r2" loader={loaders['analysis:u1:r2']} />
      </ResourceCacheProvider>,
    );
    await act(async () => {
      second.resolve(env('revision-2'));
    });
    await act(async () => {
      first.resolve(env('revision-1-stale'));
    });
    expect(screen.getByText('data:revision-2')).toBeInTheDocument();
    expect(screen.queryByText(/revision-1-stale/)).not.toBeInTheDocument();
  });

  it('aborts the previous request when the key changes', async () => {
    const signals: AbortSignal[] = [];
    const loader = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<Envelope<string>>(() => undefined);
    });
    const { rerender } = render(
      <ResourceCacheProvider>
        <Probe resourceKey="a" loader={loader} />
      </ResourceCacheProvider>,
    );
    rerender(
      <ResourceCacheProvider>
        <Probe resourceKey="b" loader={loader} />
      </ResourceCacheProvider>,
    );
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });

  it('does not load anything for a null key', () => {
    const loader = vi.fn();
    render(
      <ResourceCacheProvider>
        <Probe resourceKey={null} loader={loader} />
      </ResourceCacheProvider>,
    );
    expect(loader).not.toHaveBeenCalled();
    expect(screen.getByText('data:none')).toBeInTheDocument();
  });

  it('clearing the cache on sign-out drops personal data for the next user', async () => {
    let clear: () => void = () => undefined;
    function Clearer() {
      clear = useResourceCache().clear;
      return null;
    }
    const loader = vi.fn(async () => env('first-user-record'));
    const { rerender } = render(
      <ResourceCacheProvider>
        <Clearer />
        <Probe resourceKey="record:u1:0" loader={loader} />
      </ResourceCacheProvider>,
    );
    await screen.findByText('data:first-user-record');
    act(() => clear());
    const secondLoader = vi.fn(async () => env('second-user-record'));
    rerender(
      <ResourceCacheProvider>
        <Clearer />
        <Probe resourceKey="record:u2:0" loader={secondLoader} />
      </ResourceCacheProvider>,
    );
    await waitFor(() => expect(screen.getByText('data:second-user-record')).toBeInTheDocument());
    expect(screen.queryByText(/first-user-record/)).not.toBeInTheDocument();
  });
});
