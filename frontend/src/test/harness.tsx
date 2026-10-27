/** Test harness: real providers + client, with a programmable fake fetch. */
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import { ApiClient } from '../api/client';
import { ResourceCacheProvider } from '../api/resources';
import { SessionProvider } from '../app/session';
import { ViewContextProvider } from '../app/viewContext';
import type { Issue, Severity } from '../api/types';

export interface FakeRequest {
  method: string;
  path: string;
  body: unknown;
}

export type FakeHandler = (req: FakeRequest) => { status?: number; data?: unknown; issues?: unknown[] } | Promise<{ status?: number; data?: unknown; issues?: unknown[] }>;

export function fakeApi(routes: Record<string, FakeHandler>, user: { id: string; username: string } | null = { id: '1', username: 'synthetic-student' }) {
  const calls: FakeRequest[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace(/^\/api\/v1/, '');
    const method = init?.method ?? 'GET';
    let body: unknown = undefined;
    if (init?.body instanceof FormData) body = init.body;
    else if (typeof init?.body === 'string') body = JSON.parse(init.body);
    const req = { method, path, body };
    calls.push(req);
    if (path === '/session' && !routes['GET /session']) {
      return new Response(JSON.stringify({ data: { csrf_token: 'test-token', user }, issues: [], schema_version: '1' }), { status: 200 });
    }
    const handler = routes[`${method} ${path}`] ?? Object.entries(routes).find(([k]) => matches(k, method, path))?.[1];
    if (!handler) return new Response(JSON.stringify({ data: null, issues: [{ code: 'NOT_FOUND', severity: 'error', message: `No fake for ${method} ${path}`, entity_refs: [], source_refs: [], suggested_action: '' }], schema_version: '1' }), { status: 404 });
    const result = await handler(req);
    return new Response(JSON.stringify({ data: result.data ?? null, issues: result.issues ?? [], schema_version: '1' }), { status: result.status ?? 200 });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

function matches(key: string, method: string, path: string): boolean {
  const [m, pattern] = key.split(' ');
  if (m !== method || !pattern) return false;
  const re = new RegExp('^' + pattern.replace(/:[a-z_]+/g, '[^/]+') + '$');
  return re.test(path);
}

export function renderApp(ui: ReactElement, { fetchImpl, route = '/', path = '*' }: { fetchImpl: typeof fetch; route?: string; path?: string }) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <ResourceCacheProvider>
        <SessionProvider createClient={(onAuthExpired) => new ApiClient({ fetch: fetchImpl, onAuthExpired })}>
          <ViewContextProvider>
            <Routes>
              <Route path={path} element={ui} />
              <Route path="*" element={<p>navigated-away</p>} />
            </Routes>
          </ViewContextProvider>
        </SessionProvider>
      </ResourceCacheProvider>
    </MemoryRouter>,
  );
}

export const issue = (code: string, severity: Severity = 'unknown', entity_refs: string[] = [], message = `${code} message`): Issue => ({
  code,
  severity,
  message,
  entity_refs,
  source_refs: [],
  suggested_action: 'Review the source evidence.',
});
