import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import conflictExample from '../../../../examples/revision-conflict.json';
import { ApiClient } from '../../api/client';
import { AppRoot } from '../../app/App';
import { attempt, curriculum, record } from '../../test/fixtures';
import { fakeApi, issue, renderApp, type FakeHandler } from '../../test/harness';
import { AccountPage } from './AccountPage';

/*
 * No examples/ file covers export, backup preview or deletion yet, so these
 * bodies follow server/api/views.py (export, backup_preview, account_data)
 * around the shared synthetic record fixture. The 409 body is examples/revision-conflict.json.
 */
const backupEnvelope = {
  data: {
    kind: 'coursepath-backup',
    backup_version: '1',
    exported_at: '2026-11-02T20:00:00+00:00', // 3 November in Asia/Kolkata
    account: { username: 'synthetic-student' },
    rule_version: 'cse-2024-draft-v1',
    rule_review_status: 'draft',
    sources: curriculum.sources,
    missing_sources: curriculum.missing_sources,
    grading_policy: { id: 'synthetic-policy', review_status: 'draft' },
    record: { ...record, attempts: [...record.attempts, attempt({ id: 'a-new', normalized_code: 'ZZ 401', title: 'Synthetic restored course', term_id: '2025-26-I' })] },
    plans: [{ id: 'plan-1', revision: 2, label: 'Main plan', semesters: [] }],
    scenarios: [{ id: 's1' }],
  },
  issues: [],
  schema_version: '1',
};

const preview = {
  id: '0b8f4a8e-1c1d-4a5e-9f43-5b7c3b2d9e10',
  kind: 'backup',
  base_record_revision: 3,
  expires_at: '2026-11-02T21:00:00+00:00',
  diff: {
    attempts_added: ['a-new'],
    attempts_removed: ['a-fail'],
    attempts_changed: ['a-dsa'],
    attempts_unchanged: 3,
    current_enrolment_changed: false,
    plans_to_create: 1,
    scenarios_not_restored: 1,
    // Hypothetical key that today's server does not send: extra diff keys must still be shown as reported.
    plans_skipped: 2,
  },
};

const restored = { ...backupEnvelope.data.record, revision: 4 };

function backupFile(text = JSON.stringify(backupEnvelope), name = 'coursepath-backup-2026-11-03.json') {
  return new File([text], name, { type: 'application/json' });
}

async function choose(file: File) {
  await userEvent.upload(await screen.findByLabelText('Backup file (.json)'), file);
}

describe('AccountPage backup and restore (A11, CP-30)', () => {
  const saved: { name: string; blob: Blob }[] = [];
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    saved.length = 0;
    let lastBlob: Blob | null = null;
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn((blob: Blob) => ((lastBlob = blob), 'blob:coursepath-test')) });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      if (lastBlob) saved.push({ name: this.download, blob: lastBlob });
    });
  });

  afterEach(() => {
    clickSpy.mockRestore();
  });

  it('downloads the backup as a dated JSON file holding the server envelope, with no password', async () => {
    const { fetchImpl, calls } = fakeApi({ 'GET /record': () => ({ data: record }), 'GET /export?kind=json': () => backupEnvelope });
    renderApp(<AccountPage />, { fetchImpl });
    expect(await screen.findByText(/not an official transcript or institute record/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Download backup (JSON)' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved coursepath-backup-2026-11-03.json (record revision 3)');
    expect(calls.some((c) => c.method === 'GET' && c.path === '/export?kind=json')).toBe(true);
    expect(saved.map((s) => s.name)).toEqual(['coursepath-backup-2026-11-03.json']);
    const text = await saved[0]!.blob.text();
    const file = JSON.parse(text);
    expect(file.data.account.username).toBe('synthetic-student');
    expect(file.data.record.attempts).toHaveLength(6);
    expect(text).not.toMatch(/password|csrf|sessionid/i);
  });

  it('rejects a file that is not valid JSON without sending anything', async () => {
    const { fetchImpl, calls } = fakeApi({ 'GET /record': () => ({ data: record }) });
    renderApp(<AccountPage />, { fetchImpl });
    await choose(backupFile('{"kind": "coursepath-backup", oops', 'broken.json'));
    expect(await screen.findByRole('alert')).toHaveTextContent('“broken.json” is not valid JSON');
    expect(screen.queryByRole('button', { name: 'Preview restore' })).not.toBeInTheDocument();
    expect(calls.some((c) => c.path.startsWith('/imports'))).toBe(false);
  });

  it('shows the server diff, then restores only after the explicit confirmation and reloads the record', async () => {
    let restoredYet = false;
    const { fetchImpl, calls } = fakeApi({
      'GET /record': () => ({ data: restoredYet ? restored : record }),
      'POST /imports/backup-preview': () => ({ status: 201, data: preview, issues: [issue('BACKUP_SCENARIOS_NOT_RESTORED', 'warning', [], 'Scenarios depend on an exact baseline; recreate them after restoring.')] }),
      'POST /imports/:id/commit': () => {
        restoredYet = true;
        return { data: restored };
      },
    });
    renderApp(<AccountPage />, { fetchImpl });
    await choose(backupFile());
    await userEvent.click(await screen.findByRole('button', { name: 'Preview restore' }));
    const region = await screen.findByRole('region', { name: 'Restore preview' });
    expect(calls.find((c) => c.path === '/imports/backup-preview')?.body).toEqual({ expected_revision: 3, backup: backupEnvelope });
    const row = (label: string) => within(region).getByText(label, { selector: 'dt' }).parentElement!;
    expect(row('Attempts added')).toHaveTextContent('ZZ 401 Synthetic restored course');
    expect(row('Attempts removed')).toHaveTextContent('ZZ 103 Synthetic failed maths');
    expect(row('Attempts changed')).toHaveTextContent('ES 242(N)');
    expect(row('Attempts unchanged')).toHaveTextContent('3');
    expect(row('Current enrolment replaced')).toHaveTextContent('No');
    expect(row('Plans to create')).toHaveTextContent('1');
    expect(row('Scenarios not restored')).toHaveTextContent('1');
    expect(row('Plans skipped')).toHaveTextContent('2');
    expect(region).toHaveTextContent('BACKUP_SCENARIOS_NOT_RESTORED');

    await userEvent.click(within(region).getByRole('button', { name: 'Restore this backup…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Replace your saved record?' });
    expect(calls.some((c) => c.path.endsWith('/commit'))).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Replace record and restore' }));

    expect(await screen.findByText(/Backup restored\. Your record is now at revision 4 with 6 attempts; 1 plan was added\./)).toBeInTheDocument();
    expect(calls.find((c) => c.path.endsWith('/commit'))).toEqual({ method: 'POST', path: `/imports/${preview.id}/commit`, body: { expected_revision: 3, confirm: true } });
    await waitFor(() => expect(calls.filter((c) => c.method === 'GET' && c.path === '/record').length).toBeGreaterThanOrEqual(2));
  });

  it('a 409 on commit shows the conflict panel and is never retried automatically', async () => {
    const { fetchImpl, calls } = fakeApi({
      'GET /record': () => ({ data: record }),
      'POST /imports/backup-preview': () => ({ status: 201, data: preview }),
      'POST /imports/:id/commit': () => ({ status: 409, data: conflictExample.data, issues: conflictExample.issues }),
    });
    renderApp(<AccountPage />, { fetchImpl });
    await choose(backupFile());
    await userEvent.click(await screen.findByRole('button', { name: 'Preview restore' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Restore this backup…' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Replace record and restore' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('This was saved elsewhere');
    expect(alert).toHaveTextContent(`server revision ${conflictExample.data.current_revision}`);
    expect(alert).toHaveTextContent('It was not applied');
    expect(screen.queryByText(/Backup restored/)).not.toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.filter((c) => c.path.endsWith('/commit'))).toHaveLength(1);
  });

  it('a 422 shows the server issue and says the record was not changed', async () => {
    const { fetchImpl } = fakeApi({
      'GET /record': () => ({ data: record }),
      'POST /imports/backup-preview': () => ({ status: 422, issues: [issue('BACKUP_INVALID', 'error', [], 'The backup attempts are not valid.')] }),
    });
    renderApp(<AccountPage />, { fetchImpl });
    await choose(backupFile());
    await userEvent.click(await screen.findByRole('button', { name: 'Preview restore' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('This backup cannot be restored. Your saved record was not changed.');
    expect(alert).toHaveTextContent('BACKUP_INVALID');
    expect(alert).toHaveTextContent('The backup attempts are not valid.');
    expect(screen.queryByRole('region', { name: 'Restore preview' })).not.toBeInTheDocument();
  });
});

const PASSWORD = 'Synthetic-pass-9183!';
const deleted = { attempts: 5, plans: 1, scenarios: 0, import_previews: 2, approval_evidence: 0 };
const RETENTION = 'Deleted from the CoursePath database immediately. (synthetic retention statement)';

async function requestDeletion(password: string, { account = false, phrase = 'delete my data' } = {}) {
  const submit = await screen.findByRole('button', { name: 'Delete my data…' });
  await waitFor(() => expect(submit).toBeEnabled());
  await userEvent.type(screen.getByLabelText('Current password for deletion'), password);
  await userEvent.type(screen.getByLabelText(/to confirm$/), phrase);
  if (account) await userEvent.click(screen.getByLabelText('Delete my account too'));
  await userEvent.click(screen.getByRole('button', { name: account ? 'Delete my data and account…' : 'Delete my data…' }));
}

async function confirmDeletion(account = false) {
  const dialog = await screen.findByRole('dialog', { name: account ? 'Delete your data and account now?' : 'Delete your data now?' });
  await userEvent.click(within(dialog).getByRole('button', { name: account ? 'Delete data and account' : 'Delete my data' }));
}

describe('AccountPage data deletion (A11, CP-32)', () => {
  it('explains what is removed and quotes the documented retention', async () => {
    const { fetchImpl } = fakeApi({ 'GET /record': () => ({ data: record }) });
    renderApp(<AccountPage />, { fetchImpl });
    const section = (await screen.findByRole('heading', { name: 'Delete my data' })).parentElement!;
    for (const text of ['every course attempt', 'confirmed current enrolment', 'source-reported totals', 'plans and scenarios', 'import previews', 'approval evidence'])
      expect(section).toHaveTextContent(text);
    expect(section).toHaveTextContent('this repository configures no database backups, so any copy the host keeps is outside its control');
  });

  it('needs the typed phrase, then a wrong password is refused and nothing is claimed deleted', async () => {
    const { fetchImpl, calls } = fakeApi({
      'GET /record': () => ({ data: record }),
      'DELETE /account/data': () => ({ status: 403, issues: [issue('REAUTH_FAILED', 'error', [], 'Enter your current password to delete data.')] }),
    });
    renderApp(<AccountPage />, { fetchImpl });
    await requestDeletion('wrong-synthetic-pass', { phrase: 'delete my stuff' });
    expect(await screen.findByText('Type “delete my data” exactly to confirm.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    const phrase = screen.getByLabelText(/to confirm$/);
    await userEvent.clear(phrase);
    await userEvent.type(phrase, 'delete my data');
    await userEvent.click(screen.getByRole('button', { name: 'Delete my data…' }));
    await confirmDeletion();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Your current password was not accepted. Nothing was deleted.');
    expect(alert).toHaveTextContent('REAUTH_FAILED');
    expect(alert).not.toHaveTextContent('wrong-synthetic-pass');
    expect(calls.filter((c) => c.method === 'DELETE')).toEqual([
      { method: 'DELETE', path: '/account/data', body: { expected_revision: 3, password: 'wrong-synthetic-pass', confirm: 'delete my data', delete_account: false } },
    ]);
    expect(screen.queryByText(/Your data was deleted/)).not.toBeInTheDocument();
  });

  it.each([
    [429, 'AUTH_THROTTLED', 'Too many attempts. Wait and try again later. Nothing was deleted.'],
    [409, 'ACCOUNT_HAS_VERIFICATIONS', 'The server did not delete your data. Nothing was deleted.'],
  ])('a %i %s refusal shows the server issue and claims nothing', async (status, code, title) => {
    const { fetchImpl } = fakeApi({
      'GET /record': () => ({ data: record }),
      'DELETE /account/data': () => ({ status, issues: [issue(code, 'error', [], `${code} from the server.`)] }),
    });
    renderApp(<AccountPage />, { fetchImpl });
    await requestDeletion(PASSWORD);
    await confirmDeletion();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(title);
    expect(alert).toHaveTextContent(`${code} from the server.`);
    expect(alert).not.toHaveTextContent('This was saved elsewhere');
    expect(screen.queryByText(/Your data was deleted/)).not.toBeInTheDocument();
  });

  it('deleting data shows the server counts and retention, and reloads the empty record', async () => {
    let cleared = false;
    const { fetchImpl, calls } = fakeApi({
      'GET /record': () => ({ data: cleared ? { ...record, revision: 4, attempts: [], reported_controls: [] } : record }),
      'DELETE /account/data': () => {
        cleared = true;
        return { data: { deleted, account_deleted: false, record_revision: 4, retention: RETENTION } };
      },
    });
    renderApp(<AccountPage />, { fetchImpl });
    await requestDeletion(PASSWORD);
    await confirmDeletion();
    const status = await screen.findByText(/Your data was deleted\./);
    const box = status.closest('[role="status"]')!;
    expect(box).toHaveTextContent('Your record is now empty at revision 4');
    const counts = within(box as HTMLElement).getByRole('list', { name: 'Deleted items' });
    expect(counts).toHaveTextContent('Attempts: 5');
    expect(counts).toHaveTextContent('Plans: 1');
    expect(counts).toHaveTextContent('Import previews: 2');
    expect(counts).toHaveTextContent('Approval evidence: 0');
    expect(box).toHaveTextContent(RETENTION);
    expect(calls.find((c) => c.method === 'DELETE')?.body).toEqual({ expected_revision: 3, password: PASSWORD, confirm: 'delete my data', delete_account: false });
    await waitFor(() => expect(calls.filter((c) => c.path === '/record').length).toBeGreaterThanOrEqual(2));
    expect(screen.getByLabelText('Current password for deletion')).toHaveValue('');
  });

  it('deleting the account clears personal state and goes to the public home page', async () => {
    let accountGone = false;
    const routes: Record<string, FakeHandler> = {
      'GET /session': () => ({ data: { csrf_token: 'test-token', user: accountGone ? null : { id: '1', username: 'synthetic-student' } } }),
      'GET /record': () => ({ data: record }),
      'GET /curricula/cse-2024': () => ({ data: curriculum }),
      'GET /catalogue': () => ({ data: { courses: [], coverage: 'unknown', review_status: 'draft' } }),
      'DELETE /account/data': () => {
        accountGone = true;
        return { data: { deleted, account_deleted: true, record_revision: null, retention: RETENTION } };
      },
    };
    const { fetchImpl, calls } = fakeApi(routes);
    render(<AppRoot router="memory" initialPath="/account" createClient={(onAuthExpired) => new ApiClient({ fetch: fetchImpl, onAuthExpired })} />);
    await screen.findByRole('heading', { level: 1, name: 'Account' });
    await requestDeletion(PASSWORD, { account: true });
    await confirmDeletion(true);

    expect(await screen.findByRole('heading', { level: 1, name: 'CSE 2024 graduation requirements' })).toBeInTheDocument();
    const notice = screen.getByText(/Your CoursePath account and its data were deleted, and you are signed out\./).closest('[role="status"]') as HTMLElement;
    expect(within(notice).getByRole('list', { name: 'Deleted items' })).toHaveTextContent('Attempts: 5');
    expect(notice).toHaveTextContent(RETENTION);
    expect(calls.find((c) => c.method === 'DELETE')?.body).toMatchObject({ delete_account: true });
    // Signed out in this tab: no account link or username, no personal requests after the deletion.
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    expect(screen.queryByText('synthetic-student')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Data context' })).toHaveTextContent('Public requirements (no personal data)');
    const after = calls.slice(calls.findIndex((c) => c.method === 'DELETE') + 1);
    expect(after.some((c) => /^\/(record|plans|analysis|logout)/.test(c.path))).toBe(false);
  });
});
