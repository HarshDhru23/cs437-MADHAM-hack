import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../api/client';
import { AppRoot } from '../../app/App';
import { curriculum, record } from '../../test/fixtures';
import { fakeApi, renderApp, type FakeHandler } from '../../test/harness';
import { importDraftStore } from '../import/draftStore';
import { previewStore } from '../import/previewStore';
import { AccountPage } from '../account/AccountPage';
import { ImportPage } from '../import/ImportPage';
import { LoginPage, SignupPage } from './AuthPages';

/** CR-137 (CP-37): "Try with a sample student": a made-up record with no sign-in, clearly labelled, removed on leaving. */
const CLIENT = 'synthetic-client.apps.googleusercontent.com';
const GOOGLE_SITE = { google_client_id: CLIENT, google_domain: 'iitgn.ac.in', password: false };
const PASSWORD_SITE = { google_client_id: null, google_domain: 'iitgn.ac.in', password: true };
const SAMPLE_USER = { id: '77', username: 'sample-0123456789ab', reauth: 'google', demo: true };
const REAL_USER = { id: '1', username: 'student.one@iitgn.ac.in', reauth: 'google' };

beforeEach(() => {
  importDraftStore.clear();
  previewStore.clear();
});

afterEach(() => {
  delete window.google;
});

/** A server that starts a sample account on POST /auth/demo and deletes it on POST /auth/logout. */
function server(options: { site: typeof GOOGLE_SITE | typeof PASSWORD_SITE; sample?: boolean; demo?: () => { status?: number; data?: unknown } }) {
  let user: Record<string, unknown> | null = null;
  const sample = 'sample' in options ? options.sample : true;   // an explicit undefined means the server says nothing about the sample
  const routes: Record<string, FakeHandler> = {
    'GET /session': () => ({ data: { csrf_token: 'test-token', user, sign_in: options.site, ...(sample === undefined ? {} : { sample_student: sample }) } }),
    'POST /auth/demo': () => {
      const result = options.demo?.() ?? { status: 201, data: SAMPLE_USER };
      if ((result.status ?? 200) < 300) user = SAMPLE_USER;
      return result;
    },
    'POST /auth/logout': () => {
      user = null;
      return { data: null };
    },
    'GET /record': () => ({ data: record }),
    'GET /curricula/cse-2024': () => ({ data: curriculum }),
    'GET /catalogue': () => ({ data: { courses: [], coverage: 'unknown', review_status: 'draft' } }),
    'GET /plans': () => ({ data: [] }),
  };
  return fakeApi(routes, null);
}

function renderApplication(path: string, fetchImpl: typeof fetch) {
  return render(<AppRoot router="memory" initialPath={path} createClient={(onAuthExpired) => new ApiClient({ fetch: fetchImpl, onAuthExpired })} />);
}

describe('Try with a sample student: the button', () => {
  it.each([
    ['the sign-in page', LoginPage, '/login'],
    ['the create-account page', SignupPage, '/signup'],
  ])('is shown on %s of a Google-only site', async (_name, Page, route) => {
    const { fetchImpl } = server({ site: GOOGLE_SITE });
    renderApp(<Page />, { fetchImpl, route, path: route });
    expect(await screen.findByRole('button', { name: 'Try with a sample student' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Just looking?' })).toBeInTheDocument();
    expect(screen.getByText(/made-up student\. No sign-in needed; it is removed when you leave/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Username')).not.toBeInTheDocument();
  });

  it.each([
    ['the sign-in page', LoginPage, '/login'],
    ['the create-account page', SignupPage, '/signup'],
  ])('is shown on %s where the password forms are on, next to them', async (_name, Page, route) => {
    const { fetchImpl } = server({ site: PASSWORD_SITE });
    renderApp(<Page />, { fetchImpl, route, path: route });
    expect(await screen.findByRole('button', { name: 'Try with a sample student' })).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
  });

  it('is not shown when the server does not offer the sample, or says nothing about it', async () => {
    for (const sample of [false, undefined]) {
      const { fetchImpl } = server({ site: GOOGLE_SITE, sample });
      const view = renderApp(<LoginPage />, { fetchImpl, route: '/login', path: '/login' });
      expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Try with a sample student' })).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Just looking?' })).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it('starts the sample with one POST /auth/demo and lands on the record page, labelled as a sample', async () => {
    const { fetchImpl, calls } = server({ site: GOOGLE_SITE });
    renderApplication('/login', fetchImpl);
    await userEvent.click(await screen.findByRole('button', { name: 'Try with a sample student' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'My record' })).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST' && c.path === '/auth/demo')).toHaveLength(1);
    const banner = screen.getByRole('status', { name: 'Sample student' });
    expect(banner).toHaveTextContent('You are looking at a sample student. Every course and grade here is made up and nothing is saved to a real account.');
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    expect(screen.queryByText('sample-0123456789ab')).not.toBeInTheDocument();
  });

  it('says what went wrong in plain words and stays on the page', async () => {
    const cases: [number, RegExp][] = [
      [503, /The sample student is busy right now\. Try again in a few minutes\./],
      [429, /Too many tries from this network\. Wait 15 minutes/],
      [409, /Sign out first to try the sample student\./],
      [500, /The sample student is not available right now/],
    ];
    for (const [status, message] of cases) {
      const { fetchImpl } = server({ site: GOOGLE_SITE, demo: () => ({ status, data: null }) });
      const view = renderApplication('/login', fetchImpl);
      await userEvent.click(await screen.findByRole('button', { name: 'Try with a sample student' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(message);
      expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
      view.unmount();
    }
  });

  it('says CoursePath could not be reached when the network fails', async () => {
    const { fetchImpl } = server({ site: GOOGLE_SITE });
    const flaky = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/auth/demo')) throw new TypeError('Failed to fetch');
      return fetchImpl(input, init);
    }) as unknown as typeof fetch;
    renderApplication('/login', flaky);
    await userEvent.click(await screen.findByRole('button', { name: 'Try with a sample student' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('CoursePath could not be reached.');
  });
});

describe('A sample session in the app', () => {
  function signedIn(user: Record<string, unknown>) {
    return fakeApi(
      {
        'GET /session': () => ({ data: { csrf_token: 'test-token', user, sign_in: GOOGLE_SITE, sample_student: true } }),
        'GET /record': () => ({ data: record }),
        'GET /curricula/cse-2024': () => ({ data: curriculum }),
        'GET /catalogue': () => ({ data: { courses: [], coverage: 'unknown', review_status: 'draft' } }),
        'GET /plans': () => ({ data: [] }),
        'POST /auth/logout': () => ({ data: null }),
      },
      null,
    );
  }

  it('shows the banner on every page, with one Leave the sample button that signs out and returns to the sign-in page', async () => {
    const { fetchImpl, calls } = server({ site: GOOGLE_SITE });
    renderApplication('/login', fetchImpl);
    await userEvent.click(await screen.findByRole('button', { name: 'Try with a sample student' }));
    await screen.findByRole('heading', { level: 1, name: 'My record' });
    await userEvent.click(screen.getByRole('link', { name: 'Plan' }));
    expect(screen.getByRole('status', { name: 'Sample student' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Leave the sample' })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Leave the sample' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.path === '/auth/logout')).toBe(true);
    expect(screen.queryByRole('status', { name: 'Sample student' })).not.toBeInTheDocument();
  });

  it('shows no sample banner, and a normal Sign out, for a real student', async () => {
    const { fetchImpl } = signedIn(REAL_USER);
    renderApplication('/record', fetchImpl);
    expect(await screen.findByRole('heading', { level: 1, name: 'My record' })).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Sample student' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Leave the sample' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('replaces the import forms with a plain notice for the sample student', async () => {
    const { fetchImpl } = signedIn(SAMPLE_USER);
    renderApp(<ImportPage />, { fetchImpl, route: '/record/import', path: '/record/import' });
    expect(await screen.findByText('The sample student cannot import a record. Sign in with your IITGN Google account to use your own.')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Upload transcript PDF' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Parse grades' })).not.toBeInTheDocument();
  });

  it('keeps the import forms for a real student', async () => {
    const { fetchImpl } = signedIn(REAL_USER);
    renderApp(<ImportPage />, { fetchImpl, route: '/record/import', path: '/record/import' });
    expect(await screen.findByRole('tab', { name: 'Upload transcript PDF' })).toBeInTheDocument();
  });

  it('says on Your Data that the sample is not real and offers no deletion or restore', async () => {
    const { fetchImpl } = signedIn(SAMPLE_USER);
    renderApp(<AccountPage />, { fetchImpl, route: '/account', path: '/account' });
    expect(await screen.findByText('This is a sample student. Nothing here is real. Use Leave the sample to remove it.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Delete my data' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: /Delete my data/ })).not.toBeInTheDocument());
  });

  it('still offers the deletion form to a real student on Your Data', async () => {
    const { fetchImpl } = signedIn(REAL_USER);
    renderApp(<AccountPage />, { fetchImpl, route: '/account', path: '/account' });
    expect(await screen.findByRole('heading', { name: 'Delete my data' })).toBeInTheDocument();
    expect(screen.queryByText(/This is a sample student/)).not.toBeInTheDocument();
  });
});
