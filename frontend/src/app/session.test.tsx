import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';
import { ApiClient, ApiError } from '../api/client';
import { ResourceCacheProvider, useResource } from '../api/resources';
import { SaveQueue } from '../api/saveQueue';
import { saveRegistry } from '../api/saveRegistry';
import { endpoints } from '../api/endpoints';
import { importDraftStore } from '../features/import/draftStore';
import { SessionProvider, useSession } from './session';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
const env = (data: unknown, status = 200, issues: unknown[] = []) => json({ data, issues, schema_version: '1' }, status);

/** A tiny fake server with two users and owner-scoped records. */
function fakeServer() {
  let user: { id: string; username: string } | null = null;
  let expireNext = false;
  const records: Record<string, string> = { '1': 'alice-record', '2': 'bob-record' };
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url.endsWith('/session')) return env({ csrf_token: 't', user });
    if (url.endsWith('/auth/login')) {
      user = body.username === 'alice' ? { id: '1', username: 'alice' } : { id: '2', username: 'bob' };
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
      return env({ revision: 0, attempts: [], marker: records[user.id] });
    }
    return env(null, 404);
  };
  return { fetchImpl: fetchImpl as typeof fetch, expire: () => (expireNext = true) };
}

let controls: ReturnType<typeof useSession> | null = null;
function Probe() {
  const session = useSession();
  controls = session;
  const record = useResource(session.user ? `record:${session.user.id}` : null, (signal) => endpoints.record(session.api, { signal }));
  return (
    <div>
      <p>user:{session.user?.username ?? 'none'}</p>
      <p>expired:{String(session.expired)}</p>
      <p>record:{(record.data as unknown as { marker?: string } | null)?.marker ?? 'none'}</p>
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

describe('SessionProvider', () => {
  beforeEach(() => importDraftStore.clear());

  it('bootstraps the session, signs in and loads the owner record', async () => {
    renderWith(fakeServer().fetchImpl);
    await screen.findByText('user:none');
    await act(() => controls!.login({ username: 'alice', password: 'x' }));
    await screen.findByText('record:alice-record');
  });

  it('sign-out removes cached personal data and the import draft; the next user never sees it', async () => {
    renderWith(fakeServer().fetchImpl);
    await act(() => controls!.login({ username: 'alice', password: 'x' }));
    await screen.findByText('record:alice-record');
    importDraftStore.update({ kind: 'ims', text: 'alice grades', ownerId: '1' });
    await act(() => controls!.logout());
    expect(screen.getByText('record:none')).toBeInTheDocument();
    expect(importDraftStore.get().text).toBe('');
    await act(() => controls!.login({ username: 'bob', password: 'x' }));
    await screen.findByText('record:bob-record');
    expect(screen.queryByText(/alice-record/)).not.toBeInTheDocument();
  });

  it('session expiry keeps the unsaved import draft and marks the session expired', async () => {
    const server = fakeServer();
    renderWith(server.fetchImpl);
    await act(() => controls!.login({ username: 'alice', password: 'x' }));
    await screen.findByText('record:alice-record');
    importDraftStore.update({ kind: 'ims', text: 'pending paste', ownerId: '1' });
    server.expire();
    await act(async () => {
      controls!.refreshPersonal();
    });
    await waitFor(() => expect(screen.getByText('expired:true')).toBeInTheDocument());
    expect(screen.getByText('user:none')).toBeInTheDocument();
    expect(importDraftStore.get().text).toBe('pending paste');
    await act(() => controls!.login({ username: 'alice', password: 'x' }));
    expect(importDraftStore.get().text).toBe('pending paste');
  });

  it('kept plan/enrolment drafts survive expiry for the same user, but not sign-out or another user', async () => {
    const server = fakeServer();
    renderWith(server.fetchImpl);
    await act(() => controls!.login({ username: 'alice', password: 'x' }));
    const keepDraft = (id: string) => {
      const queue = new SaveQueue<string>({ revision: 0, value: 'saved', save: () => Promise.reject(new ApiError('auth', 401, 'expired', [])) });
      saveRegistry.attach(id, '1', queue);
      queue.edit('alice unsaved');
      saveRegistry.release(id, queue);
    };
    keepDraft('plan:p1');
    await waitFor(() => expect(saveRegistry.hasUnsaved()).toBe(true));
    server.expire();
    await act(async () => controls!.refreshPersonal());
    await waitFor(() => expect(screen.getByText('expired:true')).toBeInTheDocument());
    await act(() => controls!.login({ username: 'alice', password: 'x' }));
    expect(saveRegistry.hasUnsaved()).toBe(true);

    await act(() => controls!.logout());
    expect(saveRegistry.hasUnsaved()).toBe(false);

    await act(() => controls!.login({ username: 'alice', password: 'x' }));
    keepDraft('plan:p2');
    await waitFor(() => expect(saveRegistry.hasUnsaved()).toBe(true));
    server.expire();
    await act(async () => controls!.refreshPersonal());
    await waitFor(() => expect(screen.getByText('expired:true')).toBeInTheDocument());
    await act(() => controls!.login({ username: 'bob', password: 'x' }));
    expect(saveRegistry.hasUnsaved()).toBe(false);
  });

  it('a different user signing in after expiry does not inherit the previous draft', async () => {
    const server = fakeServer();
    renderWith(server.fetchImpl);
    await act(() => controls!.login({ username: 'alice', password: 'x' }));
    importDraftStore.update({ kind: 'ims', text: 'alice pending', ownerId: '1' });
    server.expire();
    await act(async () => controls!.refreshPersonal());
    await waitFor(() => expect(screen.getByText('expired:true')).toBeInTheDocument());
    await act(() => controls!.login({ username: 'bob', password: 'x' }));
    expect(importDraftStore.get().text).toBe('');
  });
});
