/**
 * Minimal keyed resource state. Keys must encode the owner and every revision
 * the response depends on (user, record revision, plan revision, rule version),
 * so a response for an older key is never shown for a newer one.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError } from './client';
import type { Envelope, Issue } from './types';

interface CacheEntry {
  data: unknown;
  issues: Issue[];
}

interface ResourceCache {
  get(key: string): CacheEntry | undefined;
  set(key: string, entry: CacheEntry): void;
  invalidate(prefix: string): void;
  /** Remove all personal cached state (sign-out / user switch). */
  clear(): void;
  generation: number;
}

const CacheContext = createContext<ResourceCache | null>(null);

export function ResourceCacheProvider({ children }: { children: ReactNode }) {
  const store = useRef(new Map<string, CacheEntry>());
  const [generation, setGeneration] = useState(0);
  const value = useMemo<ResourceCache>(
    () => ({
      get: (key) => store.current.get(key),
      set: (key, entry) => {
        store.current.set(key, entry);
      },
      invalidate: (prefix) => {
        for (const key of [...store.current.keys()]) if (key.startsWith(prefix)) store.current.delete(key);
        setGeneration((g) => g + 1);
      },
      clear: () => {
        store.current.clear();
        setGeneration((g) => g + 1);
      },
      generation,
    }),
    [generation],
  );
  return <CacheContext.Provider value={value}>{children}</CacheContext.Provider>;
}

export function useResourceCache(): ResourceCache {
  const cache = useContext(CacheContext);
  if (!cache) throw new Error('useResourceCache requires ResourceCacheProvider');
  return cache;
}

export interface ResourceState<T> {
  data: T | null;
  issues: Issue[];
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
}

export function useResource<T>(key: string | null, loader: (signal: AbortSignal) => Promise<Envelope<T>>): ResourceState<T> {
  const cache = useResourceCache();
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const [nonce, setNonce] = useState(0);
  const cached = key ? cache.get(key) : undefined;
  const [state, setState] = useState<{ key: string | null; data: T | null; issues: Issue[]; error: ApiError | null; loading: boolean }>(() => ({
    key,
    data: (cached?.data as T) ?? null,
    issues: cached?.issues ?? [],
    error: null,
    loading: Boolean(key && !cached),
  }));

  useEffect(() => {
    if (!key) {
      setState({ key, data: null, issues: [], error: null, loading: false });
      return;
    }
    const hit = cache.get(key);
    if (hit && nonce === 0) {
      setState({ key, data: hit.data as T, issues: hit.issues, error: null, loading: false });
      return;
    }
    const controller = new AbortController();
    let active = true;
    setState((s) => ({ key, data: s.key === key ? s.data : null, issues: s.key === key ? s.issues : [], error: null, loading: true }));
    loaderRef
      .current(controller.signal)
      .then((envelope) => {
        if (!active) return; // stale: key changed or component unmounted
        cache.set(key, { data: envelope.data, issues: envelope.issues });
        setState({ key, data: envelope.data, issues: envelope.issues, error: null, loading: false });
      })
      .catch((error: unknown) => {
        if (!active) return;
        const apiError = error instanceof ApiError ? error : new ApiError('server', 0, String(error), []);
        if (apiError.kind === 'aborted') return;
        setState({ key, data: null, issues: apiError.issues, error: apiError, loading: false });
      });
    return () => {
      active = false;
      controller.abort();
    };
    // cache.generation forces a reload after invalidation/clear.
  }, [key, nonce, cache.generation]);

  const reload = useCallback(() => {
    if (key) cache.invalidate(key);
    setNonce((n) => n + 1);
  }, [cache, key]);

  const visible = state.key === key ? state : { data: null, issues: [], error: null, loading: Boolean(key) };
  return { ...visible, reload };
}
