/**
 * The single HTTP client for CoursePath API v1. It owns envelope parsing,
 * same-origin credentials, CSRF bootstrap/rotation, cancellation and mapping
 * HTTP failures to stable error kinds. It never fabricates a successful
 * response: an unreachable or missing endpoint is always an error.
 */
import { SCHEMA_VERSION, type Envelope, type Issue, type SessionData } from './types';

export type ApiErrorKind =
  | 'network'
  | 'aborted'
  | 'auth'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'invalid'
  | 'too_large'
  | 'uncommittable'
  | 'throttled'
  | 'schema'
  | 'server';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;
  readonly issues: Issue[];
  readonly data: unknown;
  readonly currentRevision: number | null;

  constructor(kind: ApiErrorKind, status: number, message: string, issues: Issue[], extra: { data?: unknown; currentRevision?: number | null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.issues = issues;
    this.data = extra.data ?? null;
    this.currentRevision = extra.currentRevision ?? null;
  }

  get code(): string | null {
    return this.issues[0]?.code ?? null;
  }
}

export interface RequestOptions {
  signal?: AbortSignal;
}

export interface ApiClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Called when a personal route reports the session is no longer authenticated. */
  onAuthExpired?: () => void;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

const STATUS_KIND: Record<number, ApiErrorKind> = {
  400: 'invalid',
  401: 'auth',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'too_large',
  422: 'uncommittable',
  429: 'throttled',
};

const AUTH_ACTIONS = /^\/auth\/(login|signup)$/;

function isAbort(error: unknown): boolean {
  return error instanceof DOMException ? error.name === 'AbortError' : (error as { name?: string })?.name === 'AbortError';
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly onAuthExpired: () => void;
  private csrfToken: string | null = null;
  private bootstrapping: Promise<SessionData> | null = null;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? '/api/v1';
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.onAuthExpired = options.onAuthExpired ?? (() => undefined);
  }

  /** GET /session: establishes the CSRF cookie/token and returns the signed-in user, if any. */
  async bootstrap(options: RequestOptions = {}): Promise<SessionData> {
    if (!this.bootstrapping) {
      this.bootstrapping = this.request<SessionData>('GET', '/session', undefined, options)
        .then((envelope) => {
          this.csrfToken = envelope.data.csrf_token;
          return envelope.data;
        })
        .finally(() => {
          this.bootstrapping = null;
        });
    }
    return this.bootstrapping;
  }

  get<T>(path: string, options: RequestOptions = {}): Promise<Envelope<T>> {
    return this.request<T>('GET', path, undefined, options);
  }

  async send<T>(method: Exclude<Method, 'GET'>, path: string, body: unknown, options: RequestOptions = {}): Promise<Envelope<T>> {
    if (!this.csrfToken) await this.bootstrap(options);
    try {
      return await this.request<T>(method, path, body, options);
    } catch (error) {
      // Django rotates the CSRF token at login/signup. A CSRF rejection happens
      // before the view runs, so one refresh-and-retry cannot double-apply a write.
      if (error instanceof ApiError && error.status === 403 && error.code === 'CSRF_REQUIRED') {
        this.csrfToken = null;
        await this.bootstrap(options);
        return this.request<T>(method, path, body, options);
      }
      throw error;
    }
  }

  private async request<T>(method: Method, path: string, body: unknown, options: RequestOptions): Promise<Envelope<T>> {
    const headers = new Headers({ Accept: 'application/json' });
    let payload: BodyInit | undefined;
    if (body instanceof FormData) {
      payload = body;
    } else if (body !== undefined) {
      headers.set('Content-Type', 'application/json');
      payload = JSON.stringify(body);
    }
    if (method !== 'GET' && this.csrfToken) headers.set('X-CSRFToken', this.csrfToken);

    let response: Response;
    try {
      response = await this.fetchImpl(this.baseUrl + path, {
        method,
        headers,
        body: payload,
        credentials: 'same-origin',
        signal: options.signal,
      });
    } catch (error) {
      if (isAbort(error) || options.signal?.aborted) throw new ApiError('aborted', 0, 'Request cancelled.', []);
      throw new ApiError('network', 0, 'CoursePath could not be reached. Check your connection.', []);
    }

    let parsed: Envelope<T> | null = null;
    try {
      parsed = (await response.json()) as Envelope<T>;
    } catch (error) {
      if (isAbort(error) || options.signal?.aborted) throw new ApiError('aborted', 0, 'Request cancelled.', []);
      parsed = null;
    }
    if (!parsed || typeof parsed !== 'object' || !('schema_version' in parsed)) {
      // Some failures never reach an API view (Django's HTML 404 for a malformed
      // id, a proxy's 413): keep their status meaning, never treat them as data.
      const known = response.ok ? undefined : STATUS_KIND[response.status];
      if (known && known !== 'auth') throw new ApiError(known, response.status, `Request failed (HTTP ${response.status}).`, []);
      throw new ApiError('server', response.status, `Unexpected response from the server (HTTP ${response.status}).`, []);
    }
    if (parsed.schema_version !== SCHEMA_VERSION) {
      throw new ApiError('schema', response.status, `This page expects API schema ${SCHEMA_VERSION} but received ${String(parsed.schema_version)}. Reload the page.`, []);
    }
    const issues = Array.isArray(parsed.issues) ? parsed.issues : [];
    if (response.ok) return { data: parsed.data, issues, schema_version: parsed.schema_version };

    const kind = STATUS_KIND[response.status] ?? 'server';
    if (kind === 'auth' && !AUTH_ACTIONS.test(path)) this.onAuthExpired();
    const data = parsed.data as { current_revision?: unknown } | null;
    const currentRevision = kind === 'conflict' && data && typeof data.current_revision === 'number' ? data.current_revision : null;
    const message = issues[0]?.message ?? `Request failed (HTTP ${response.status}).`;
    throw new ApiError(kind, response.status, message, issues, { data: parsed.data, currentRevision });
  }
}
