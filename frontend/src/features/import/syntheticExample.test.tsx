/**
 * CP-45: a reviewer who signs in with no data of their own is told at once, on every page, that a synthetic example is there to load, and one click loads it
 * (import preview, then commit of every row) so the requirements, performance, planner and scenarios can be explored. The table is the made-up student of the
 * sample button: real course codes, invented grades, 36 rows. Nothing is offered to a student who already has data, to the sample student or to a visitor.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiClient } from '../../api/client';
import type { AcademicRecord, ImportPreview } from '../../api/types';
import { AppRoot } from '../../app/App';
import { curriculum, record } from '../../test/fixtures';
import { fakeApi, issue, type FakeHandler } from '../../test/harness';
import { importDraftStore } from './draftStore';
import { previewStore } from './previewStore';
import { SYNTHETIC_SAMPLE } from './ImportPage';

const SITE = { google_client_id: 'synthetic-client.apps.googleusercontent.com', google_domain: 'iitgn.ac.in', password: false };
const REAL_USER = { id: '1', username: 'student.one@iitgn.ac.in', reauth: 'google' };
const SAMPLE_USER = { id: '77', username: 'sample-0123456789ab', reauth: 'google', demo: true };
const EMPTY: AcademicRecord = { ...record, revision: 4, attempts: [], current_enrolment: [], reported_controls: [] };
const ROWS = SYNTHETIC_SAMPLE.split('\n').slice(1);

beforeEach(() => {
  importDraftStore.clear();
  previewStore.clear();
});

function server(options: { user?: Record<string, unknown> | null; record?: AcademicRecord; preview?: () => { status?: number; data?: unknown; issues?: unknown[] } } = {}) {
  let current = options.record ?? EMPTY;
  const user = 'user' in options ? options.user : REAL_USER;
  const candidates = ROWS.map((row, i) => ({ id: `cand-${i + 1}`, normalized_code: row.split('\t')[1] }));
  const routes: Record<string, FakeHandler> = {
    'GET /session': () => ({ data: { csrf_token: 'test-token', user, sign_in: SITE, sample_student: true } }),
    'GET /record': () => ({ data: current }),
    'GET /curricula/cse-2024': () => ({ data: curriculum }),
    'GET /catalogue': () => ({ data: { courses: [], coverage: 'unknown', review_status: 'draft' } }),
    'GET /plans': () => ({ data: [] }),
    'POST /imports/preview': () => options.preview?.() ?? { status: 201, data: { id: 'prev-1', kind: 'ims', candidate_attempts: candidates } as unknown as ImportPreview },
    'POST /imports/prev-1/commit': (req) => {
      const body = req.body as { accepted_candidate_ids: string[] };
      current = { ...current, revision: current.revision + 1, attempts: body.accepted_candidate_ids.map((id) => ({ ...record.attempts[0]!, id })) };
      return { data: current };
    },
    'POST /analysis': () => ({ status: 500, data: null, issues: [issue('SERVER_ERROR', 'error')] }),
  };
  return fakeApi(routes, null);
}

function open(path: string, fetchImpl: typeof fetch) {
  return render(<AppRoot router="memory" initialPath={path} createClient={(onAuthExpired) => new ApiClient({ fetch: fetchImpl, onAuthExpired })} />);
}

describe('The synthetic example table (CP-45)', () => {
  it('is an IMS table of the made-up student: real course codes, one row per attempt, no real person', () => {
    expect(SYNTHETIC_SAMPLE.split('\n')[0]).toBe('Academic Period\tCourse No\tCourse Name\tCredit\tGrade');
    expect(ROWS).toHaveLength(36);
    expect(ROWS.every((row) => row.split('\t').length === 5)).toBe(true);
    expect(SYNTHETIC_SAMPLE).not.toMatch(/ZZ \d|@|\b2\d{7}\b/);
    expect(SYNTHETIC_SAMPLE).toMatch(/\tCS 202\t/);
    expect(SYNTHETIC_SAMPLE).toMatch(/\tES 242\t/);
  });
});

describe('The synthetic example, offered as soon as a student with no data signs in (CP-45)', () => {
  it('is shown on the first page, in plain words, with a button to load it and a way to import real data', async () => {
    open('/record', server().fetchImpl);
    const region = await screen.findByRole('region', { name: 'Synthetic example' });
    expect(within(region).getByRole('heading', { name: /No data yet\? Try the synthetic example/ })).toBeInTheDocument();
    expect(region).toHaveTextContent(/made-up student/);
    expect(region).toHaveTextContent(/real course codes/);
    expect(region).toHaveTextContent(/replaces it/);
    expect(within(region).getByRole('button', { name: 'Load the synthetic example' })).toBeEnabled();
    expect(within(region).getByRole('link', { name: 'Import my own data' })).toHaveAttribute('href', '/record/import');
  });

  it('is shown on every main page, not only the first', async () => {
    for (const path of ['/', '/plan', '/performance']) {
      const { unmount } = open(path, server().fetchImpl);
      expect(await screen.findByRole('region', { name: 'Synthetic example' }), path).toBeInTheDocument();
      unmount();
    }
  });

  it('is not shown to a student who already has courses on their record', async () => {
    open('/record', server({ record }).fetchImpl);
    await screen.findByRole('heading', { name: 'My record' });
    expect(screen.queryByRole('region', { name: 'Synthetic example' })).not.toBeInTheDocument();
  });

  it('is not shown to the sample student, a visitor who has not signed in, or in the middle of a review', async () => {
    const sample = open('/record', server({ user: SAMPLE_USER }).fetchImpl);
    await screen.findByRole('status', { name: 'Sample student' });
    expect(screen.queryByRole('region', { name: 'Synthetic example' })).not.toBeInTheDocument();
    sample.unmount();
    const visitor = open('/', server({ user: null }).fetchImpl);
    await screen.findByRole('link', { name: 'Create account' });
    expect(screen.queryByRole('region', { name: 'Synthetic example' })).not.toBeInTheDocument();
    visitor.unmount();
  });

  it('stays out of the way while an import is being reviewed', async () => {
    open('/record/review/prev-9', server().fetchImpl);
    await screen.findByRole('heading', { name: 'This review is no longer available' });
    expect(screen.queryByRole('region', { name: 'Synthetic example' })).not.toBeInTheDocument();
  });
});

describe('Loading the synthetic example (CP-45)', () => {
  it('previews the table with the record revision, commits every row, and the offer goes away', async () => {
    const api = server();
    open('/record', api.fetchImpl);
    await userEvent.click(await screen.findByRole('button', { name: 'Load the synthetic example' }));
    await waitFor(() => expect(api.calls.some((c) => c.path === '/imports/prev-1/commit')).toBe(true));
    const preview = api.calls.find((c) => c.path === '/imports/preview');
    expect(preview?.body).toEqual({ kind: 'ims', text: SYNTHETIC_SAMPLE, expected_revision: 4 });
    const commit = api.calls.find((c) => c.path === '/imports/prev-1/commit');
    expect((commit?.body as { accepted_candidate_ids: string[] }).accepted_candidate_ids).toHaveLength(36);
    expect(commit?.body).toMatchObject({ expected_revision: 4, resolutions: {} });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Synthetic example' })).not.toBeInTheDocument());
  });

  it('says so plainly when the example could not be loaded, and offers the button again', async () => {
    const api = server({ preview: () => ({ status: 500, data: null, issues: [issue('SERVER_ERROR', 'error')] }) });
    open('/record', api.fetchImpl);
    await userEvent.click(await screen.findByRole('button', { name: 'Load the synthetic example' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not be loaded/);
    expect(alert.textContent).not.toMatch(/SERVER_ERROR|500|revision/i);
    expect(screen.getByRole('button', { name: 'Load the synthetic example' })).toBeEnabled();
    expect(api.calls.some((c) => c.path === '/imports/prev-1/commit')).toBe(false);
  });

  it('keeps the button from being pressed twice while it loads', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const api = server();
    const slow: typeof fetch = async (input, init) => {
      if (String(input).includes('/imports/preview')) await gate;
      return api.fetchImpl(input, init);
    };
    open('/record', slow);
    await userEvent.click(await screen.findByRole('button', { name: 'Load the synthetic example' }));
    expect(await screen.findByRole('button', { name: /Loading/ })).toBeDisabled();
    release();
    await waitFor(() => expect(api.calls.filter((c) => c.path === '/imports/preview')).toHaveLength(1));
  });
});
