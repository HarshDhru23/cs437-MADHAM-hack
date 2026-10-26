import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from './client';

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function envelope(data: unknown, issues: unknown[] = []) {
  return { data, issues, schema_version: '1' };
}

function client(handler: Handler, onAuthExpired = vi.fn()) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(handler(String(input), init ?? {})));
  return { api: new ApiClient({ fetch: fetchMock as unknown as typeof fetch, onAuthExpired }), fetchMock, onAuthExpired };
}

const session = (token = 'tok-1', user: unknown = null) => json(envelope({ csrf_token: token, user }));

describe('ApiClient envelope handling', () => {
  it('returns data and issues from a v1 envelope', async () => {
    const issue = { code: 'CATALOGUE_MISSING', severity: 'unknown', message: 'm', entity_refs: [], source_refs: [], suggested_action: 'a' };
    const { api } = client(() => json(envelope({ courses: [] }, [issue])));
    const result = await api.get<{ courses: unknown[] }>('/catalogue');
    expect(result.data.courses).toEqual([]);
    expect(result.issues[0]?.code).toBe('CATALOGUE_MISSING');
  });

  it('rejects an incompatible schema version instead of rendering it', async () => {
    const { api } = client(() => json({ data: {}, issues: [], schema_version: '2' }));
    await expect(api.get('/record')).rejects.toMatchObject({ kind: 'schema' });
  });

  it('rejects a non-JSON response as a server error', async () => {
    const { api } = client(() => new Response('<html>proxy error</html>', { status: 502 }));
    await expect(api.get('/record')).rejects.toMatchObject({ kind: 'server', status: 502 });
  });

  it('reports a network failure as offline/network, not as empty data', async () => {
    const { api } = client(() => {
      throw new TypeError('Failed to fetch');
    });
    await expect(api.get('/record')).rejects.toMatchObject({ kind: 'network' });
  });

  it('reports an aborted request distinctly', async () => {
    const controller = new AbortController();
    const { api } = client((_url, init) => {
      if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      return json(envelope({}));
    });
    controller.abort();
    await expect(api.get('/record', { signal: controller.signal })).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('preserves server issues and status on errors', async () => {
    const issue = { code: 'IMPORT_ROW_UNPARSED', severity: 'error', message: 'Review rows', entity_refs: [], source_refs: [], suggested_action: '' };
    const { api } = client((url) => (url.endsWith('/session') ? session() : json({ data: { diff: [] }, issues: [issue], schema_version: '1' }, 422)));
    await api.bootstrap();
    const error = await api.send('POST', '/imports/x/commit', {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: 'uncommittable', status: 422 });
    expect((error as ApiError).issues[0]?.code).toBe('IMPORT_ROW_UNPARSED');
  });
});

describe('ApiClient session, CSRF and auth expiry', () => {
  it('bootstraps the session first and sends the CSRF token with same-origin credentials', async () => {
    const { api, fetchMock } = client((url) => (url.endsWith('/session') ? session('tok-abc') : json(envelope({ ok: true }))));
    await api.bootstrap();
    await api.send('PATCH', '/record', { expected_revision: 0 });
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(new Headers(init.headers).get('X-CSRFToken')).toBe('tok-abc');
    expect(init.credentials).toBe('same-origin');
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ expected_revision: 0 }));
  });

  it('bootstraps automatically before the first mutation', async () => {
    const { api, fetchMock } = client((url) => (url.endsWith('/session') ? session('tok-auto') : json(envelope({}))));
    await api.send('POST', '/auth/logout', {});
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/\/api\/v1\/session$/);
  });

  it('re-bootstraps once and retries when the CSRF token rotated', async () => {
    let tokenCalls = 0;
    let mutationCalls = 0;
    const { api } = client((url, init) => {
      if (url.endsWith('/session')) return session(`tok-${++tokenCalls}`);
      mutationCalls += 1;
      const token = new Headers(init.headers).get('X-CSRFToken');
      return token === 'tok-2' ? json(envelope({ ok: true })) : json({ data: null, issues: [{ code: 'CSRF_REQUIRED' }], schema_version: '1' }, 403);
    });
    await api.bootstrap();
    await expect(api.send('POST', '/plans', { semesters: [] })).resolves.toMatchObject({ data: { ok: true } });
    expect(mutationCalls).toBe(2);
  });

  it('does not attach a JSON content type to multipart uploads', async () => {
    const { api, fetchMock } = client((url) => (url.endsWith('/session') ? session() : json(envelope({ id: 'p' }), 201)));
    await api.bootstrap();
    const form = new FormData();
    form.append('expected_revision', '0');
    await api.send('POST', '/imports/preview', form);
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(new Headers(init.headers).get('Content-Type')).toBeNull();
    expect(init.body).toBe(form);
  });

  it('notifies auth expiry on 401 from a personal route', async () => {
    const onAuthExpired = vi.fn();
    const { api } = client(() => json({ data: null, issues: [{ code: 'AUTHENTICATION_REQUIRED' }], schema_version: '1' }, 401), onAuthExpired);
    await expect(api.get('/record')).rejects.toMatchObject({ kind: 'auth' });
    expect(onAuthExpired).toHaveBeenCalledTimes(1);
  });

  it('does not treat a failed sign-in as session expiry', async () => {
    const onAuthExpired = vi.fn();
    const { api } = client(
      (url) => (url.endsWith('/session') ? session() : json({ data: null, issues: [{ code: 'INVALID_CREDENTIALS' }], schema_version: '1' }, 401)),
      onAuthExpired,
    );
    await expect(api.send('POST', '/auth/login', { username: 'a', password: 'b' })).rejects.toMatchObject({ kind: 'auth' });
    expect(onAuthExpired).not.toHaveBeenCalled();
  });

  it('maps 409 to a revision conflict carrying the current revision', async () => {
    const { api } = client((url) =>
      url.endsWith('/session') ? session() : json({ data: { current_revision: 7, action: 'reload_compare' }, issues: [{ code: 'REVISION_CONFLICT' }], schema_version: '1' }, 409),
    );
    const error = (await api.send('PATCH', '/record', { expected_revision: 3 }).catch((e: unknown) => e)) as ApiError;
    expect(error.kind).toBe('conflict');
    expect(error.currentRevision).toBe(7);
  });

  it.each([
    [400, 'invalid'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [413, 'too_large'],
    [429, 'throttled'],
    [500, 'server'],
  ])('maps HTTP %s to %s', async (status, kind) => {
    const { api } = client(() => json({ data: null, issues: [{ code: 'X' }], schema_version: '1' }, status));
    await expect(api.get('/record')).rejects.toMatchObject({ kind, status });
  });
});
