import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { AcademicRecord, RecordPatch } from '../../api/types';
import { attempt, record } from '../../test/fixtures';
import { fakeApi, issue, renderApp } from '../../test/harness';
import { RecordPage } from './RecordPage';

function server(initial: AcademicRecord = record) {
  let current = structuredClone(initial);
  const patches: RecordPatch[] = [];
  let conflictNext = false;
  const api = fakeApi({
    'GET /record': () => ({ data: current }),
    'PATCH /record': (req) => {
      const body = req.body as RecordPatch;
      patches.push(body);
      if (conflictNext || body.expected_revision !== current.revision) {
        conflictNext = false;
        return { status: 409, data: { current_revision: current.revision + 1, action: 'reload_compare' }, issues: [issue('REVISION_CONFLICT', 'error')] };
      }
      current = { ...current, revision: current.revision + 1, ...(body.attempts ? { attempts: body.attempts } : {}), ...(body.current_enrolment ? { current_enrolment: body.current_enrolment } : {}) };
      return { data: current };
    },
  });
  return { ...api, patches, conflict: () => (conflictNext = true), get current() { return current; }, set current(v) { current = v; } };
}

describe('RecordPage (CP-02, A04)', () => {
  it('separates completed history (by term, chronological) from current enrolment', async () => {
    const s = server();
    renderApp(<RecordPage />, { fetchImpl: s.fetchImpl });
    const history = await screen.findByRole('region', { name: 'Academic history' });
    const captions = within(history).getAllByRole('table').map((t) => t.querySelector('caption')?.textContent);
    expect(captions).toEqual(['2024–25 Semester I', '2024–25 Semester II', '2025–26 Semester I', '2025–26 Semester II']);
    expect(screen.getByRole('region', { name: 'Current enrolment' })).toHaveTextContent(/No confirmed current courses/);
    expect(screen.getByText(/Latest completed term/).parentElement).toHaveTextContent('2025–26 Semester II');
    expect(screen.getByText(/Add only the courses you are registered for this term/)).toBeInTheDocument();
  });

  it('shows no revision numbers, source references or other developer detail', async () => {
    const s = server();
    const { container } = renderApp(<RecordPage />, { fetchImpl: s.fetchImpl });
    await screen.findByRole('region', { name: 'Academic history' });
    expect(container.textContent).not.toMatch(/revision|server|Designation unknown|\bD-\d\d\b|[A-Z]{3,}_[A-Z_]{3,}/i);
    expect(screen.queryByRole('button', { name: /^Source for/ })).not.toBeInTheDocument();
  });

  it('keeps both repeated registrations and no longer calls rule-matched rows unmatched', async () => {
    const s = server();
    renderApp(<RecordPage />, { fetchImpl: s.fetchImpl });
    await screen.findByRole('region', { name: 'Academic history' });
    expect(screen.getAllByText('ZZ 299')).toHaveLength(2);
    expect(screen.queryByText(/reviewed catalogue/)).not.toBeInTheDocument(); // D-29: rows are matched by the approved rules
  });

  it('requires a justification to correct an attempt and keeps the original evidence', async () => {
    const s = server();
    renderApp(<RecordPage />, { fetchImpl: s.fetchImpl });
    await screen.findByRole('region', { name: 'Academic history' });
    await userEvent.click(screen.getByRole('button', { name: 'Correct CS 203 (2025–26 Semester II)' }));
    const dialog = screen.getByRole('dialog', { name: /Correct CS 203/ });
    const title = within(dialog).getByLabelText('Title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Corrected synthetic title');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save correction' }));
    expect(within(dialog).getByText('Explain what you checked before correcting a record.')).toBeInTheDocument();
    expect(s.patches).toHaveLength(0);
    await userEvent.type(within(dialog).getByLabelText(/Justification/), 'Checked against my transcript');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save correction' }));
    await waitFor(() => expect(s.patches).toHaveLength(1));
    const body = s.patches[0]!;
    expect(body.expected_revision).toBe(3);
    expect(body.correction_justifications).toEqual({ 'a-tools': 'Checked against my transcript' });
    expect(body.attempts?.find((a) => a.id === 'a-tools')?.title).toBe('Corrected synthetic title');
    expect(body.attempts?.find((a) => a.id === 'a-tools')?.original?.title).toBe('Synthetic course');
    expect(body.attempts).toHaveLength(record.attempts.length);
  });

  it('adds a manual in-progress or failed attempt without removing prior attempts', async () => {
    const s = server();
    renderApp(<RecordPage />, { fetchImpl: s.fetchImpl });
    await screen.findByRole('region', { name: 'Academic history' });
    await userEvent.click(screen.getByRole('button', { name: 'Add an attempt' }));
    const dialog = screen.getByRole('dialog', { name: 'Add an attempt' });
    await userEvent.type(within(dialog).getByLabelText('Course code'), 'ZZ 401');
    await userEvent.type(within(dialog).getByLabelText('Title'), 'Synthetic retake');
    await userEvent.type(within(dialog).getByLabelText('Credits'), '4');
    await userEvent.selectOptions(within(dialog).getByLabelText('Status'), 'failed');
    await userEvent.type(within(dialog).getByLabelText('Grade'), 'F');
    // D-21 sets the default only for imported, current and planned rows; a hand-added row asks the student.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add attempt' }));
    expect(within(dialog).getByText(/Choose whether this course counts toward your degree/)).toBeInTheDocument();
    expect(s.patches).toHaveLength(0);
    await userEvent.selectOptions(within(dialog).getByLabelText('Counts toward'), 'degree');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add attempt' }));
    await waitFor(() => expect(s.patches).toHaveLength(1));
    const attempts = s.patches[0]!.attempts!;
    expect(attempts).toHaveLength(record.attempts.length + 1);
    expect(attempts.at(-1)).toMatchObject({
      normalized_code: 'ZZ 401', completion_status: 'failed', grade: 'F', learning_designation: 'degree', source_refs: [], approval_refs: [], course_version_id: null,
    });
  });

  it('saves confirmed current enrolment with debounce and shows acknowledged revision', async () => {
    const s = server();
    renderApp(<RecordPage />, { fetchImpl: s.fetchImpl });
    const section = await screen.findByRole('region', { name: 'Current enrolment' });
    await userEvent.type(within(section).getByLabelText('Course code'), 'ZZ 330');
    await userEvent.type(within(section).getByLabelText('Credits'), '4');
    await userEvent.click(within(section).getByRole('button', { name: 'Add to current enrolment' }));
    expect(within(section).getByText(/Confirm that you are enrolled/)).toBeInTheDocument();
    await userEvent.click(within(section).getByLabelText(/I confirm I am enrolled/));
    await userEvent.click(within(section).getByRole('button', { name: 'Add to current enrolment' }));
    expect(within(section).getByRole('status')).toHaveTextContent(/Unsaved changes|Saving/);
    await waitFor(() => expect(s.patches).toHaveLength(1), { timeout: 2000 });
    expect(s.patches[0]).toMatchObject({ expected_revision: 3, current_enrolment: [{ normalized_code: 'ZZ 330', credits: '4', confirmed: true, term_id: '2026-27-I' }] });
    await waitFor(() => expect(within(section).getByRole('status')).toHaveTextContent('Saved'));
    expect(within(section).getByRole('status')).toHaveTextContent('Saved');
    expect(within(section).getByRole('status')).not.toHaveTextContent(/revision/i);
  });

  it('on a stale save (409) keeps the draft and offers reload/compare, never auto-retrying', async () => {
    const s = server();
    renderApp(<RecordPage />, { fetchImpl: s.fetchImpl });
    const section = await screen.findByRole('region', { name: 'Current enrolment' });
    s.conflict();
    await userEvent.type(within(section).getByLabelText('Course code'), 'ZZ 330');
    await userEvent.type(within(section).getByLabelText('Credits'), '4');
    await userEvent.click(within(section).getByLabelText(/I confirm I am enrolled/));
    await userEvent.click(within(section).getByRole('button', { name: 'Add to current enrolment' }));
    await waitFor(() => expect(within(section).getByRole('status')).toHaveTextContent('Conflict'), { timeout: 2000 });
    expect(within(section).getAllByText('ZZ 330').length).toBeGreaterThan(0);
    await act(async () => new Promise((r) => setTimeout(r, 800)));
    expect(s.patches).toHaveLength(1);
    // Another device saved; reload shows the server version and drops the draft.
    s.current = { ...s.current, revision: 4, current_enrolment: [{ id: 'other', normalized_code: 'ZZ 331', term_id: '2026-27-I', credits: '4', confirmed: true }] };
    await userEvent.click(within(section).getByRole('button', { name: 'Reload saved version' }));
    await waitFor(() => expect(within(section).getByText('ZZ 331')).toBeInTheDocument());
    expect(within(section).queryByText('ZZ 330')).not.toBeInTheDocument();
  });

  it('can explicitly keep the local draft over the newer saved version', async () => {
    const s = server();
    renderApp(<RecordPage />, { fetchImpl: s.fetchImpl });
    const section = await screen.findByRole('region', { name: 'Current enrolment' });
    s.conflict();
    await userEvent.type(within(section).getByLabelText('Course code'), 'ZZ 330');
    await userEvent.type(within(section).getByLabelText('Credits'), '4');
    await userEvent.click(within(section).getByLabelText(/I confirm I am enrolled/));
    await userEvent.click(within(section).getByRole('button', { name: 'Add to current enrolment' }));
    await waitFor(() => expect(within(section).getByRole('status')).toHaveTextContent('Conflict'), { timeout: 2000 });
    s.current = { ...s.current, revision: 4 };
    await userEvent.click(within(section).getByRole('button', { name: 'Keep my version' }));
    await waitFor(() => expect(s.patches).toHaveLength(2), { timeout: 2000 });
    expect(s.patches[1]).toMatchObject({ expected_revision: 4 });
  });

  it('shows a re-import resolution as the fields that changed, never as [object Object]', async () => {
    // The server stores an accepted re-import as one correction whose raw/accepted values are field maps.
    const fields = { normalized_code: 'ZZ 104', title: 'Synthetic calculus', credits: '2', term_id: '2024-25-II', instance_id: null };
    const reimported = attempt({
      id: 'a-calc',
      normalized_code: 'ZZ 104',
      title: 'Synthetic calculus',
      credits: '2',
      grade: 'A-',
      term_id: '2024-25-II',
      user_corrections: [{ field: 'reimport', raw: { ...fields, grade: 'B' }, accepted: { ...fields, grade: 'A-' }, justification: 'Grade revised after re-evaluation' }],
    });
    const s = server({ ...record, attempts: [...record.attempts, reimported] });
    renderApp(<RecordPage />, { fetchImpl: s.fetchImpl });
    await screen.findByRole('region', { name: 'Academic history' });
    await userEvent.click(screen.getByRole('button', { name: 'Details for ZZ 104 (2024–25 Semester II)' }));
    const dialog = screen.getByRole('dialog', { name: 'Details for ZZ 104' });
    expect(dialog).toHaveTextContent('Re-import: grade “B” → “A-” — Grade revised after re-evaluation');
    expect(dialog).not.toHaveTextContent('[object Object]');
  });

  it('marks credits of failed and in-progress attempts as not earned', async () => {
    const s = server({ ...record, attempts: [...record.attempts, attempt({ id: 'a-now', normalized_code: 'ZZ 330', term_id: '2026-27-I', grade: '', completion_status: 'in_progress' })] });
    renderApp(<RecordPage />, { fetchImpl: s.fetchImpl });
    const history = await screen.findByRole('region', { name: 'Academic history' });
    const failed = within(history).getByRole('row', { name: /ZZ 103/ });
    expect(within(failed).getByText(/not earned/)).toBeInTheDocument();
    const now = within(history).getByRole('row', { name: /ZZ 330/ });
    expect(within(now).getByText(/not earned/)).toBeInTheDocument();
    const done = within(history).getByRole('row', { name: /CS 203/ });
    expect(within(done).queryByText(/not earned/)).not.toBeInTheDocument();
  });

  it('the correction dialog keeps an unknown status unknown and says a code change is not an equivalence', async () => {
    const s = server({ ...record, attempts: [attempt({ id: 'a-unk', normalized_code: 'ZZ 372', grade: '', completion_status: 'unknown' })] });
    renderApp(<RecordPage />, { fetchImpl: s.fetchImpl });
    await screen.findByRole('region', { name: 'Academic history' });
    await userEvent.click(screen.getByRole('button', { name: 'Correct ZZ 372 (2024–25 Semester I)' }));
    const dialog = screen.getByRole('dialog', { name: /Correct ZZ 372/ });
    expect(within(dialog).getByLabelText('Status')).toHaveValue('unknown');
    expect(within(dialog).getByText(/does not make one course count as another/)).toBeInTheDocument();
  });

  it('rejects a course code or credit value the server would reject, before saving', async () => {
    const s = server();
    renderApp(<RecordPage />, { fetchImpl: s.fetchImpl });
    await screen.findByRole('region', { name: 'Academic history' });
    await userEvent.click(screen.getByRole('button', { name: 'Add an attempt' }));
    const dialog = screen.getByRole('dialog', { name: 'Add an attempt' });
    await userEvent.type(within(dialog).getByLabelText('Course code'), 'ZZ 401A');
    await userEvent.type(within(dialog).getByLabelText('Title'), 'Synthetic');
    await userEvent.type(within(dialog).getByLabelText('Credits'), '4');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add attempt' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/course code/);
    await userEvent.clear(within(dialog).getByLabelText('Course code'));
    await userEvent.type(within(dialog).getByLabelText('Course code'), 'ZZ 401');
    await userEvent.clear(within(dialog).getByLabelText('Credits'));
    await userEvent.type(within(dialog).getByLabelText('Credits'), '04');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add attempt' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/credits/i);
    expect(s.patches).toHaveLength(0);
  });

  it('shows an import prompt when there is no record yet', async () => {
    const s = server({ ...record, attempts: [], revision: 0, reported_controls: [] });
    renderApp(<RecordPage />, { fetchImpl: s.fetchImpl });
    expect(await screen.findByRole('link', { name: 'Import transcript or IMS grades' })).toHaveAttribute('href', '/record/import');
  });
});
