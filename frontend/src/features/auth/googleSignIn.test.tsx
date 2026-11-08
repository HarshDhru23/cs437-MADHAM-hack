import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, issue, renderApp } from '../../test/harness';
import { LoginPage, SignupPage } from './AuthPages';

/** D-46 (CP-37): with a Google client ID the page offers only Google sign-in for IITGN accounts; the server decides who is accepted. */
const CLIENT = 'synthetic-client.apps.googleusercontent.com';
const GOOGLE_ON = { csrf_token: 'test-token', user: null, sign_in: { google_client_id: CLIENT, google_domain: 'iitgn.ac.in', password: false } };
const GOOGLE_OFF = { csrf_token: 'test-token', user: null, sign_in: { google_client_id: null, google_domain: 'iitgn.ac.in', password: true } };

let handler: ((response: { credential?: string }) => void) | null = null;

beforeEach(() => {
  handler = null;
  window.google = {
    accounts: {
      id: {
        initialize: vi.fn((config) => {
          handler = config.callback;
        }),
        renderButton: vi.fn((parent: HTMLElement) => {
          const button = document.createElement('button');
          button.textContent = 'Sign in with Google';
          parent.appendChild(button);
        }),
      },
    },
  };
});

afterEach(() => {
  delete window.google;
});

function server(options: { session: typeof GOOGLE_ON | typeof GOOGLE_OFF; google?: () => { status?: number; data?: unknown; issues?: ReturnType<typeof issue>[] } }) {
  let signedIn = false;
  return fakeApi(
    {
      'GET /session': () => ({ data: signedIn ? { ...options.session, user: { id: '9', username: 'student.one@iitgn.ac.in' } } : options.session }),
      'POST /auth/google': () => {
        const result = options.google?.() ?? { status: 200, data: { id: '9', username: 'student.one@iitgn.ac.in' } };
        if ((result.status ?? 200) < 300) signedIn = true;
        return result;
      },
    },
    null,
  );
}

describe('Google sign-in', () => {
  it('shows only the Google button, and says it is for IITGN accounts, when Google is configured', async () => {
    const { fetchImpl } = server({ session: GOOGLE_ON });
    renderApp(<LoginPage />, { fetchImpl, route: '/login', path: '/login' });
    expect(await screen.findByRole('button', { name: 'Sign in with Google' })).toBeInTheDocument();
    expect(screen.getByText(/IITGN Google account \(name@iitgn\.ac\.in\)/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Username')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Create an account' })).not.toBeInTheDocument();
    expect(window.google?.accounts.id.initialize).toHaveBeenCalledWith(expect.objectContaining({ client_id: CLIENT }));
  });

  it('keeps the username and password form, and no Google button, when Google is not configured', async () => {
    const { fetchImpl } = server({ session: GOOGLE_OFF });
    renderApp(<LoginPage />, { fetchImpl, route: '/login', path: '/login' });
    expect(await screen.findByLabelText('Username')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in with Google' })).not.toBeInTheDocument();
    expect(window.google?.accounts.id.renderButton).not.toHaveBeenCalled();
  });

  it('sends the Google credential to the server, then leaves the sign-in page', async () => {
    const { fetchImpl, calls } = server({ session: GOOGLE_ON });
    renderApp(<LoginPage />, { fetchImpl, route: '/login', path: '/login' });
    await screen.findByRole('button', { name: 'Sign in with Google' });
    await act(async () => handler?.({ credential: 'synthetic-google-credential-0123456789' }));
    await screen.findByText('navigated-away');
    expect(calls.filter((c) => c.path === '/auth/google')).toEqual([{ method: 'POST', path: '/auth/google', body: { credential: 'synthetic-google-credential-0123456789' } }]);
  });

  it('says only IITGN accounts can sign in when the server refuses the account, and stays on the page', async () => {
    const { fetchImpl } = server({ session: GOOGLE_ON, google: () => ({ status: 403, issues: [issue('NOT_IITGN_ACCOUNT', 'error')] }) });
    renderApp(<LoginPage />, { fetchImpl, route: '/login', path: '/login' });
    await screen.findByRole('button', { name: 'Sign in with Google' });
    await act(async () => handler?.({ credential: 'synthetic-google-credential-0123456789' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Only IITGN Google accounts can sign in. Choose your name@iitgn.ac.in account in the Google window.');
    expect(screen.queryByText('navigated-away')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeInTheDocument(); // the student can try another account
  });

  it('says a rejected token was not accepted, without technical detail', async () => {
    const { fetchImpl } = server({ session: GOOGLE_ON, google: () => ({ status: 401, issues: [issue('INVALID_CREDENTIALS', 'error')] }) });
    renderApp(<LoginPage />, { fetchImpl, route: '/login', path: '/login' });
    await screen.findByRole('button', { name: 'Sign in with Google' });
    await act(async () => handler?.({ credential: 'synthetic-google-credential-0123456789' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Google sign-in was not accepted. Try again.');
    expect(alert.textContent).not.toMatch(/INVALID_CREDENTIALS|token|401/);
  });

  it('ignores a Google response that carries no credential', async () => {
    const { fetchImpl, calls } = server({ session: GOOGLE_ON });
    renderApp(<LoginPage />, { fetchImpl, route: '/login', path: '/login' });
    await screen.findByRole('button', { name: 'Sign in with Google' });
    await act(async () => handler?.({}));
    expect(calls.some((c) => c.path === '/auth/google')).toBe(false);
  });

  it('the create-account page explains that the account is made at first Google sign-in, and offers no password form', async () => {
    const { fetchImpl } = server({ session: GOOGLE_ON });
    renderApp(<SignupPage />, { fetchImpl, route: '/signup', path: '/signup' });
    expect(await screen.findByRole('button', { name: 'Sign in with Google' })).toBeInTheDocument();
    expect(screen.getByText(/created the first time you sign in with your IITGN Google account/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Confirm password')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login'));
  });

  it('offers a retry when Google\'s script cannot be loaded', async () => {
    delete window.google;
    const { fetchImpl } = server({ session: GOOGLE_ON });
    vi.spyOn(document.head, 'appendChild').mockImplementation(((node: Node) => {
      queueMicrotask(() => (node as HTMLScriptElement).onerror?.(new Event('error')));
      return node;
    }) as typeof document.head.appendChild);
    renderApp(<LoginPage />, { fetchImpl, route: '/login', path: '/login' });
    const alert = await screen.findByRole('alert', undefined, { timeout: 4000 });
    expect(alert).toHaveTextContent('Google sign-in could not be loaded.');
    expect(screen.getByRole('button', { name: 'try again' })).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});
