/**
 * Session/auth state. Owns the single ApiClient instance. Personal cached state
 * is cleared on sign-out, expiry and user switch; unsaved import, plan and
 * enrolment drafts survive expiry for the same user (or an anonymous draft) only.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiClient, ApiError } from '../api/client';
import { endpoints, type Credentials } from '../api/endpoints';
import { useResourceCache } from '../api/resources';
import { saveRegistry } from '../api/saveRegistry';
import type { SessionUser, SignInOptions } from '../api/types';
import { importDraftStore } from '../features/import/draftStore';
import { resetKeptScenarioDrafts } from '../features/scenarios/keptDrafts';
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
  /** Sign in with the ID token Google's button returned. The server accepts only IITGN accounts. */
  loginWithGoogle: (credential: string) => Promise<void>;
  /** What the sign-in page offers; the password forms alone until the server says Google is configured. */
  signIn: SignInOptions;
  /** Whether the sign-in pages offer "Try with a sample student". */
  sampleStudent: boolean;
  /** Start a made-up sample student: a throw-away account with no sign-in. */
  startSample: () => Promise<void>;
  logout: () => Promise<void>;
  /**
   * The server already ended the session (account deletion): clear every piece
   * of personal state in this tab without calling logout, then show `notice`
   * once on the next page.
   */
  forgetSession: (notice?: ReactNode) => Promise<void>;
  /** One-time message left by forgetSession, shown by the shell. */
  notice: ReactNode;
  dismissNotice: () => void;
  /** Reload every cached personal resource from the server. */
  refreshPersonal: () => void;
  retryBootstrap: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

const PASSWORD_ONLY: SignInOptions = { google_client_id: null, google_domain: 'iitgn.ac.in', password: true };

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
  const [signIn, setSignIn] = useState<SignInOptions>(PASSWORD_ONLY);
  const [sampleStudent, setSampleStudent] = useState(false);
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
        setSignIn(session.sign_in ?? PASSWORD_ONLY);
        setSampleStudent(session.sample_student === true);
        if (session.user) {
          importDraftStore.adoptFor(session.user.id);
          saveRegistry.adoptFor(session.user.id);
        }
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
    async (start: () => Promise<unknown>) => {
      const previous = userRef.current;
      await start();
      // Django rotates CSRF on login; refresh the token and confirm the user.
      const session = await api.bootstrap();
      if (!session.user) throw new ApiError('auth', 401, 'Sign-in did not create a session.', []);
      if (!previous || previous.id !== session.user.id) cacheRef.current.clear();
      importDraftStore.adoptFor(session.user.id);
      saveRegistry.adoptFor(session.user.id);
      userRef.current = session.user;
      setUser(session.user);
      setExpired(false);
      setNotice(null);
      setStatus('ready');
    },
    [api],
  );

  const [notice, setNotice] = useState<ReactNode>(null);

  const forget = useCallback(async () => {
    userRef.current = null;
    setUser(null);
    setExpired(false);
    cacheRef.current.clear();
    importDraftStore.clear();
    previewStore.clear();
    saveRegistry.clear();
    resetKeptScenarioDrafts();
    await api.bootstrap().catch(() => undefined);
  }, [api]);

  const logout = useCallback(async () => {
    try {
      await endpoints.logout(api);
    } finally {
      await forget();
    }
  }, [api, forget]);

  const forgetSession = useCallback(
    async (message?: ReactNode) => {
      setNotice(message ?? null);
      await forget();
    },
    [forget],
  );

  const value = useMemo<SessionValue>(
    () => ({
      api,
      status,
      user,
      expired,
      error,
      mock,
      login: (c) => establish(() => endpoints.login(api, c)),
      signup: (c) => establish(() => endpoints.signup(api, c)),
      loginWithGoogle: (credential) => establish(() => endpoints.googleSignIn(api, credential)),
      signIn,
      sampleStudent,
      startSample: () => establish(() => endpoints.startSample(api)),
      logout,
      forgetSession,
      notice,
      dismissNotice: () => setNotice(null),
      refreshPersonal: () => cacheRef.current.clear(),
      retryBootstrap: () => setAttempt((a) => a + 1),
    }),
    [api, status, user, expired, error, mock, signIn, sampleStudent, establish, logout, forgetSession, notice],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession requires SessionProvider');
  return value;
}
