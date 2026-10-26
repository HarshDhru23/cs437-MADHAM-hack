/**
 * Session/auth state. Owns the single ApiClient instance. Personal cached state
 * is cleared on sign-out, expiry and user switch; an unsaved import draft
 * survives expiry for the same user (or an anonymous draft) only.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiClient, ApiError } from '../api/client';
import { endpoints, type Credentials } from '../api/endpoints';
import { useResourceCache } from '../api/resources';
import type { SessionUser } from '../api/types';
import { importDraftStore } from '../features/import/draftStore';
import { previewStore } from '../features/import/previewStore';

export interface SessionValue {
  api: ApiClient;
  status: 'loading' | 'ready' | 'error';
  user: SessionUser | null;
  /** True when a signed-in session was found to have expired. */
  expired: boolean;
  error: ApiError | null;
  mock: boolean;
  login: (credentials: Credentials) => Promise<void>;
  signup: (credentials: Credentials) => Promise<void>;
  logout: () => Promise<void>;
  /** Reload every cached personal resource from the server. */
  refreshPersonal: () => void;
  retryBootstrap: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

interface SessionProviderProps {
  children: ReactNode;
  createClient: (onAuthExpired: () => void) => ApiClient;
  mock?: boolean;
}

export function SessionProvider({ children, createClient, mock = false }: SessionProviderProps) {
  const cache = useResourceCache();
  const cacheRef = useRef(cache);
  cacheRef.current = cache;
  const [user, setUser] = useState<SessionUser | null>(null);
  const [status, setStatus] = useState<SessionValue['status']>('loading');
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const userRef = useRef<SessionUser | null>(null);

  const onAuthExpired = useCallback(() => {
    if (userRef.current) setExpired(true);
    userRef.current = null;
    setUser(null);
    cacheRef.current.clear();
  }, []);

  const apiRef = useRef<ApiClient | null>(null);
  if (!apiRef.current) apiRef.current = createClient(onAuthExpired);
  const api = apiRef.current;

  useEffect(() => {
    let active = true;
    setStatus('loading');
    api
      .bootstrap()
      .then((session) => {
        if (!active) return;
        userRef.current = session.user;
        setUser(session.user);
        if (session.user) importDraftStore.adoptFor(session.user.id);
        setStatus('ready');
      })
      .catch((e: unknown) => {
        if (!active) return;
        setError(e instanceof ApiError ? e : new ApiError('server', 0, String(e), []));
        setStatus('error');
      });
    return () => {
      active = false;
    };
  }, [api, attempt]);

  const establish = useCallback(
    async (action: 'login' | 'signup', credentials: Credentials) => {
      const previous = userRef.current;
      await endpoints[action](api, credentials);
      // Django rotates CSRF on login; refresh the token and confirm the user.
      const session = await api.bootstrap();
      if (!session.user) throw new ApiError('auth', 401, 'Sign-in did not create a session.', []);
      if (!previous || previous.id !== session.user.id) cacheRef.current.clear();
      importDraftStore.adoptFor(session.user.id);
      userRef.current = session.user;
      setUser(session.user);
      setExpired(false);
      setStatus('ready');
    },
    [api],
  );

  const logout = useCallback(async () => {
    try {
      await endpoints.logout(api);
    } finally {
      userRef.current = null;
      setUser(null);
      setExpired(false);
      cacheRef.current.clear();
      importDraftStore.clear();
      previewStore.clear();
      await api.bootstrap().catch(() => undefined);
    }
  }, [api]);

  const value = useMemo<SessionValue>(
    () => ({
      api,
      status,
      user,
      expired,
      error,
      mock,
      login: (c) => establish('login', c),
      signup: (c) => establish('signup', c),
      logout,
      refreshPersonal: () => cacheRef.current.clear(),
      retryBootstrap: () => setAttempt((a) => a + 1),
    }),
    [api, status, user, expired, error, mock, establish, logout],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession requires SessionProvider');
  return value;
}
