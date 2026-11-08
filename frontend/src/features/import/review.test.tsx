import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ImportCommitPayload, ImportPreview } from '../../api/types';
import { attempt, preview, record } from '../../test/fixtures';
import { fakeApi, issue, renderApp } from '../../test/harness';
import { previewStore } from './previewStore';
import { ReviewPage } from './ReviewPage';

const issues = [
  issue('UNMATCHED_COURSE', 'unknown', ['cand-2'], 'Catalogue classification has not been reviewed.'),
  issue('EQUIVALENCE_UNCONFIRMED', 'unknown', ['cand-3'], 'Keep the reported code; no equivalence is approved.'),
];

function setup(p: ImportPreview = preview, commit?: (body: ImportCommitPayload) => { status?: number; data?: unknown; issues?: unknown[] }) {
  previewStore.clear();
  previewStore.put({ preview: p, issues, ownerId: '1', kind: 'ims' });
  const commits: ImportCommitPayload[] = [];
  const api = fakeApi({
    'GET /record': () => ({ data: { ...record, revision: 0, attempts: [] } }),
    'POST /imports/:id/commit': (req) => {
      commits.push(req.body as ImportCommitPayload);
      return commit ? commit(req.body as ImportCommitPayload) : { data: { ...record, revision: 1 } };
    },
  });
  renderApp(<ReviewPage />, { fetchImpl: api.fetchImpl, route: `/record/review/${p.id}`, path: '/record/review/:preview_id' });
  return { ...api, commits };
}

describe('ReviewPage (A03, CP-08/11/12/13)', () => {
  beforeEach(() => previewStore.clear());

  it('shows steps and term groups, with no row counts, totals table or other developer detail', async () => {
    setup({ ...preview, reported_controls: { earned_credits: '10' } });
    expect(await screen.findByRole('heading', { level: 1, name: 'Review imported rows' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Steps' }).querySelector('[aria-current="step"]')).toHaveTextContent('Review');
    expect(screen.getByText(/Check the courses below/)).toBeInTheDocument();
    // The student is never told how many rows were read, shown a reconciliation table, or shown a preview expiry.
    expect(screen.queryByText(/rows found/)).not.toBeInTheDocument();
    expect(screen.queryByRole('table', { name: /Totals/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Server audit|Degree-allocated|arithmetic only|Preview expires|Extracted for this term/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Matched to CSE 2024 rules/)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\bD-\d\d\b|[A-Z]{3,}_[A-Z_]{3,}/);
    expect(screen.getAllByRole('table').map((t) => t.querySelector('caption')?.textContent)).toEqual(
      expect.arrayContaining(['2024–25 Semester I', '2024–25 Semester II', '2025–26 Semester II']),
    );
  });

  it('lists unparsed rows and blocks confirmation until they are explicitly omitted with a reason', async () => {
    const s = setup();
    await screen.findByRole('heading', { level: 1, name: 'Review imported rows' });
    const unparsed = screen.getByRole('region', { name: 'Lines that could not be read' });
    expect(within(unparsed).getByText(/garbage row here/)).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Confirm record' });
    expect(confirm).toBeDisabled();
    expect(screen.getByText(/Decide what to do with 1 unreadable line/)).toBeInTheDocument();
    await userEvent.click(within(unparsed).getByLabelText(/Omit these lines/));
    await userEvent.type(within(unparsed).getByLabelText(/Reason/), 'Footer text, not a course');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() => expect(s.commits).toHaveLength(1));
    expect(s.commits[0]).toEqual({
      expected_revision: 0,
      accepted_candidate_ids: ['cand-1', 'cand-2', 'cand-3'],
      resolutions: { _unparsed: { action: 'omit', justification: 'Footer text, not a course' } },
    });
    await screen.findByText('navigated-away');
  });

  it('filters to rows needing review but keeps a path back to all rows', async () => {
    setup({ ...preview, unparsed_rows: [] });
    await screen.findByRole('heading', { level: 1, name: 'Review imported rows' });
    await userEvent.click(screen.getByRole('radio', { name: /Rows needing review/ }));
    expect(screen.queryByText('ZZ 242(N)')).not.toBeInTheDocument();
    expect(screen.getByText('ZZ 372')).toBeInTheDocument();
    expect(screen.getByText('CS 203')).toBeInTheDocument();
    expect(screen.getByText(/1 row hidden by this filter/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: /All rows/ }));
    expect(screen.getByText('ZZ 242(N)')).toBeInTheDocument();
  });

  it('shows equivalence warnings that cannot be dismissed by editing', async () => {
    setup({ ...preview, unparsed_rows: [] });
    await screen.findByRole('heading', { level: 1, name: 'Review imported rows' });
    expect(screen.getAllByText('Keep the reported code; no equivalence is approved.').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /dismiss|approve/i })).not.toBeInTheDocument();
  });

  it('inline correction keeps raw evidence, highlights the change and needs a justification', async () => {
    const s = setup({ ...preview, unparsed_rows: [] });
    await screen.findByRole('heading', { level: 1, name: 'Review imported rows' });
    await userEvent.click(screen.getByRole('button', { name: 'Edit ZZ 372' }));
    const editor = screen.getByRole('group', { name: 'Edit ZZ 372' });
    const titleInput = within(editor).getByLabelText('Title');
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, 'Synthetic short course (fixed)');
    await userEvent.click(within(editor).getByRole('button', { name: 'Apply correction' }));
    expect(within(editor).getByText(/Explain what you checked/)).toBeInTheDocument();
    await userEvent.type(within(editor).getByLabelText(/Justification/), 'Checked source line 2');
    await userEvent.click(within(editor).getByRole('button', { name: 'Apply correction' }));
    const row = screen.getByText('ZZ 372').closest('tr') as HTMLElement;
    expect(row).toHaveAttribute('data-changed', 'true');
    expect(within(row).getByText(/Synthetic short course \(fixed\)/)).toBeInTheDocument();
    expect(within(row).getByText(/was: Synthetic short course\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm record' }));
    await waitFor(() => expect(s.commits).toHaveLength(1));
    expect(s.commits[0]?.resolutions['cand-2']).toEqual({ fields: { title: 'Synthetic short course (fixed)' }, justification: 'Checked source line 2' });
  });

  it('excluding a row keeps it listed with a way to include it again', async () => {
    const s = setup({ ...preview, unparsed_rows: [] });
    await screen.findByRole('heading', { level: 1, name: 'Review imported rows' });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Include ZZ 372' }));
    expect(screen.getByText(/1 row excluded/)).toBeInTheDocument();
    expect(screen.getByText('ZZ 372')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm record' }));
    await waitFor(() => expect(s.commits[0]?.accepted_candidate_ids).toEqual(['cand-1', 'cand-3']));
  });

  it('requires a decision for each conflicting re-import row and shows the existing correction', async () => {
    const conflicting: ImportPreview = {
      ...preview,
      unparsed_rows: [],
      diff: [
        { candidate_id: 'cand-1', attempt_id: 'cand-1', status: 'unchanged' },
        { candidate_id: 'cand-2', attempt_id: 'cand-2', status: 'conflicting', existing: attempt({ id: 'cand-2', normalized_code: 'ZZ 372', grade: 'A', title: 'Corrected earlier', user_corrections: [{ field: 'title', raw: 'x', accepted: 'Corrected earlier', justification: 'j' }] }) },
        { candidate_id: 'cand-3', attempt_id: 'cand-3', status: 'new' },
      ],
    };
    const s = setup(conflicting);
    await screen.findByRole('heading', { level: 1, name: 'Review imported rows' });
    expect(screen.getByText(/1 new, 1 already saved, 1 changed/)).toBeInTheDocument();
    expect(screen.getByText(/Corrected earlier/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm record' })).toBeDisabled();
    const group = screen.getByRole('radiogroup', { name: 'Resolve conflict for ZZ 372' });
    await userEvent.click(within(group).getByRole('radio', { name: /Keep my saved version/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm record' }));
    await waitFor(() => expect(s.commits[0]?.resolutions['cand-2']).toEqual({ action: 'keep_existing' }));
  });

  it('shows the saved version of a conflicting row from the record when the diff only names the attempt', async () => {
    // The real server's diff entry is {candidate_id, attempt_id, status}; the saved values come from GET /record.
    const fields = { normalized_code: 'ZZ 372', title: 'Synthetic short course', credits: '1', term_id: '2024-25-II', instance_id: null };
    const saved = attempt({
      id: 'saved-372',
      normalized_code: 'ZZ 372',
      title: 'Synthetic short course',
      credits: '1',
      grade: 'A',
      term_id: '2024-25-II',
      user_corrections: [{ field: 'reimport', raw: { ...fields, grade: 'C' }, accepted: { ...fields, grade: 'A' }, justification: 'Revised grade' }],
    });
    const conflicting: ImportPreview = {
      ...preview,
      base_record_revision: 4,
      unparsed_rows: [],
      diff: [
        { candidate_id: 'cand-1', attempt_id: 'cand-1', status: 'new' },
        { candidate_id: 'cand-2', attempt_id: 'saved-372', status: 'conflicting' },
        { candidate_id: 'cand-3', attempt_id: 'cand-3', status: 'new' },
      ],
    };
    previewStore.clear();
    previewStore.put({ preview: conflicting, issues, ownerId: '1', kind: 'ims' });
    const { fetchImpl } = fakeApi({ 'GET /record': () => ({ data: { ...record, revision: 4, attempts: [saved] } }) });
    renderApp(<ReviewPage />, { fetchImpl, route: `/record/review/${conflicting.id}`, path: '/record/review/:preview_id' });
    const group = await screen.findByRole('radiogroup', { name: 'Resolve conflict for ZZ 372' });
    const callout = group.closest('.callout') as HTMLElement;
    await waitFor(() => expect(callout).toHaveTextContent('Saved: Synthetic short course, 1 credits, grade A'));
    expect(callout).toHaveTextContent('Re-import: grade “C” → “A”');
    expect(callout).not.toHaveTextContent('[object Object]');
  });

  it('an excluded conflicting row keeps the saved version and needs no decision', async () => {
    const conflicting: ImportPreview = {
      ...preview,
      unparsed_rows: [],
      diff: [
        { candidate_id: 'cand-1', attempt_id: 'cand-1', status: 'new' },
        { candidate_id: 'cand-2', attempt_id: 'cand-2', status: 'conflicting' },
        { candidate_id: 'cand-3', attempt_id: 'cand-3', status: 'new' },
      ],
    };
    const s = setup(conflicting);
    await screen.findByRole('heading', { level: 1, name: 'Review imported rows' });
    const confirm = screen.getByRole('button', { name: 'Confirm record' });
    expect(confirm).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Include ZZ 372' }));
    const row = screen.getByText('ZZ 372').closest('tr') as HTMLElement;
    expect(row).toHaveTextContent('Excluded — your saved version stays unchanged');
    expect(within(row).queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() => expect(s.commits).toHaveLength(1));
    expect(s.commits[0]?.accepted_candidate_ids).toEqual(['cand-1', 'cand-3']);
    expect(s.commits[0]?.resolutions).not.toHaveProperty('cand-2');
  });

  it('shows server rejection issues on a 422 commit and keeps the review state', async () => {
    setup({ ...preview, unparsed_rows: [] }, () => ({ status: 422, data: { diff: [] }, issues: [issue('IMPORT_TOTAL_MISMATCH', 'error', [], 'Totals differ; acknowledge before committing.')] }));
    await screen.findByRole('heading', { level: 1, name: 'Review imported rows' });
    await userEvent.click(screen.getByRole('button', { name: 'Confirm record' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Totals differ; acknowledge before committing.');
    expect(screen.getByText('ZZ 372')).toBeInTheDocument();
    expect(screen.getByLabelText(/I have compared the totals/)).toBeInTheDocument();
  });

  it('on 409 explains the record changed and offers a fresh import', async () => {
    setup({ ...preview, unparsed_rows: [] }, () => ({ status: 409, data: { current_revision: 2, action: 'reload_compare' }, issues: [issue('REVISION_CONFLICT', 'error')] }));
    await screen.findByRole('heading', { level: 1, name: 'Review imported rows' });
    await userEvent.click(screen.getByRole('button', { name: 'Confirm record' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/changed since this preview/);
    expect(within(alert).getByRole('link', { name: 'Start a new import' })).toHaveAttribute('href', '/record/import');
  });

  it('a preview that is not available in this tab (reload, expiry or another account) offers a safe restart', async () => {
    previewStore.clear();
    const { fetchImpl } = fakeApi({ 'GET /record': () => ({ data: record }) });
    renderApp(<ReviewPage />, { fetchImpl, route: '/record/review/unknown-id', path: '/record/review/:preview_id' });
    expect(await screen.findByRole('heading', { level: 1, name: 'This review is no longer available' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start a new import' })).toHaveAttribute('href', '/record/import');
  });
});
