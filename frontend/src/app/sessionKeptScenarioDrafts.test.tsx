import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiClient } from '../api/client';
import { ResourceCacheProvider, useResource } from '../api/resources';
import { endpoints } from '../api/endpoints';
import { keptDrafts } from '../features/scenarios/keptDrafts';
import { SessionProvider, useSession } from './session';

/** CR-74 (CP-32): a scenario's unsaved edits are kept while the student moves between pages, but never across sign-out. */
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
const env = (data: unknown, status = 200, issues: unknown[] = []) => json({ data, issues, schema_version: '1' }, status);

function fakeServer() {
  let user: { id: string; username: string } | null = null;
  let expireNext = false;
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url.endsWith('/session')) return env({ csrf_token: 't', user });
    if (url.endsWith('/auth/login')) {
      user = { id: body.username === 'alice' ? '1' : '2', username: body.username };
      return env(user);
    }
    if (url.endsWith('/auth/logout')) {
      user = null;
      return env(null);
    }
    if (url.endsWith('/record')) {
      if (!user || expireNext) {
        expireNext = false;
        user = null;
        return env(null, 401, [{ code: 'AUTHENTICATION_REQUIRED' }]);
      }
      return env({ revision: 0, attempts: [] });
    }
    return env(null, 404);
  };
  return { fetchImpl: fetchImpl as typeof fetch, expire: () => (expireNext = true) };
}

let controls: ReturnType<typeof useSession> | null = null;
function Probe() {
  const session = useSession();
  controls = session;
  useResource(session.user ? `record:${session.user.id}` : null, (signal) => endpoints.record(session.api, { signal }));
  return (
    <div>
      <p>user:{session.user?.username ?? 'none'}</p>
      <p>expired:{String(session.expired)}</p>
    </div>
  );
}

function renderWith(fetchImpl: typeof fetch) {
  return render(
    <ResourceCacheProvider>
      <SessionProvider createClient={(onAuthExpired) => new ApiClient({ fetch: fetchImpl, onAuthExpired })}>
        <Probe />
      </SessionProvider>
    </ResourceCacheProvider>,
  );
}

const keep = (key: string) => keptDrafts.set(key, { draft: { label: 'What if', changes: [], internship: null }, revision: 2 });

describe('kept scenario drafts and the session', () => {
  beforeEach(() => keptDrafts.clear());

  it('signing out forgets every kept scenario draft, so the next sign-in never sees them', async () => {
    renderWith(fakeServer().fetchImpl);
    await act(() => controls!.login({ username: 'alice', password: 'x' }));
    keep('1:scenario-a');
    keep('2:scenario-b');
    await act(() => controls!.logout());
    expect(keptDrafts.size).toBe(0);
    await act(() => controls!.login({ username: 'alice', password: 'x' }));
    expect(keptDrafts.get('1:scenario-a')).toBeUndefined();
  });

  it('a session that merely expires keeps the drafts for the same account', async () => {
    // Negative: only sign-out forgets them; an expiry promises "sign in again to keep your changes".
    const server = fakeServer();
    renderWith(server.fetchImpl);
    await act(() => controls!.login({ username: 'alice', password: 'x' }));
    keep('1:scenario-a');
    server.expire();
    await act(async () => controls!.refreshPersonal());
    await waitFor(() => expect(screen.getByText('expired:true')).toBeInTheDocument());
    expect(keptDrafts.get('1:scenario-a')).toBeDefined();
  });
});
