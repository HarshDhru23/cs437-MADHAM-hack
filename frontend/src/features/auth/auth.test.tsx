import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeApi, issue, renderApp } from '../../test/harness';
import { LoginPage, SignupPage, safeNext } from './AuthPages';

describe('safeNext', () => {
  it.each([
    ['/plan/abc', '/plan/abc'],
    ['https://evil.example/', '/record'],
    ['//evil.example', '/record'],
    [null, '/record'],
  ])('%s -> %s (no open redirect)', (input, expected) => expect(safeNext(input)).toBe(expected));
});

describe('LoginPage', () => {
  it('uses labelled fields with autocomplete and a password visibility toggle', async () => {
    const { fetchImpl } = fakeApi({}, null);
    renderApp(<LoginPage />, { fetchImpl, route: '/login', path: '/login' });
    const username = await screen.findByLabelText('Username');
    expect(username).toHaveAttribute('autocomplete', 'username');
    const password = screen.getByLabelText('Password');
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveAttribute('autocomplete', 'current-password');
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password).toHaveAttribute('type', 'text');
    expect(screen.queryByText(/SSO|institute login|IMS password/i)).not.toBeInTheDocument();
  });

  it('is one centred panel with a decorative wordmark and a single heading', async () => {
    const { fetchImpl } = fakeApi({}, null);
    const { container } = renderApp(<LoginPage />, { fetchImpl, route: '/login', path: '/login' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(container.querySelector('.auth-wrap .auth-panel')).not.toBeNull();
    expect(container.querySelector('.auth-mark')).toHaveAttribute('aria-hidden', 'true'); // the page's real name is in the shell, not announced twice
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('shows a generic failure for rejected credentials and does not leak which field was wrong', async () => {
    const { fetchImpl } = fakeApi({ 'POST /auth/login': () => ({ status: 401, issues: [issue('INVALID_CREDENTIALS', 'error')] }) }, null);
    renderApp(<LoginPage />, { fetchImpl, route: '/login', path: '/login' });
    await userEvent.type(await screen.findByLabelText('Username'), 'someone');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in details were not accepted.');
  });

  it('validates required fields before calling the server', async () => {
    const { fetchImpl, calls } = fakeApi({}, null);
    renderApp(<LoginPage />, { fetchImpl, route: '/login', path: '/login' });
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter your username.')).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/auth/login')).toBe(false);
  });

  it('explains throttling', async () => {
    const { fetchImpl } = fakeApi({ 'POST /auth/login': () => ({ status: 429, issues: [issue('AUTH_THROTTLED', 'error')] }) }, null);
    renderApp(<LoginPage />, { fetchImpl, route: '/login', path: '/login' });
    await userEvent.type(await screen.findByLabelText('Username'), 'someone');
    await userEvent.type(screen.getByLabelText('Password'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Too many attempts/);
  });

  it('returns to the requested page after sign-in', async () => {
    let signedIn = false;
    const { fetchImpl } = fakeApi(
      {
        'GET /session': () => ({ data: { csrf_token: 't', user: signedIn ? { id: '1', username: 'student' } : null } }),
        'POST /auth/login': () => {
          signedIn = true;
          return { data: { id: '1', username: 'student' } };
        },
      },
      null,
    );
    renderApp(<LoginPage />, { fetchImpl, route: '/login?next=%2Fplan%2Fabc', path: '/login' });
    await userEvent.type(await screen.findByLabelText('Username'), 'student');
    await userEvent.type(screen.getByLabelText('Password'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByText('navigated-away');
  });
});

describe('SignupPage', () => {
  it('uses new-password autocomplete, requires confirmation and states account scope', async () => {
    const { fetchImpl, calls } = fakeApi({}, null);
    renderApp(<SignupPage />, { fetchImpl, route: '/signup', path: '/signup' });
    expect(await screen.findByLabelText('Password')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByText(/does not verify your IITGN identity/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Username'), 'newstudent');
    await userEvent.type(screen.getByLabelText('Password'), 'Synthetic-pass-9183');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'different');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/auth/signup')).toBe(false);
  });

  it('shows the server rejection when the password or username is not accepted', async () => {
    const { fetchImpl } = fakeApi({ 'POST /auth/signup': () => ({ status: 400, issues: [issue('INVALID_INPUT', 'error', [], 'Invalid request fields; review the documented schema.')] }) }, null);
    renderApp(<SignupPage />, { fetchImpl, route: '/signup', path: '/signup' });
    await userEvent.type(await screen.findByLabelText('Username'), 'newstudent');
    await userEvent.type(screen.getByLabelText('Password'), 'password');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'password');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/not accepted/));
  });
});
