import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { AcademicPlan, PlanPayload, PlanValidation } from '../../api/types';
import { attempt, curriculum, plan, record } from '../../test/fixtures';
import { fakeApi, issue, renderApp } from '../../test/harness';
import { PlanIndexPage, PlanPage } from './PlanPage';

type Patch = PlanPayload & { expected_revision: number };

function validationFor(p: AcademicPlan, extraIssues: PlanValidation['issues'] = [], eligibility: PlanValidation['per_course'][number]['eligibility'] = 'unknown'): PlanValidation {
  const workload: PlanValidation['workload'] = {};
  for (const s of p.semesters) {
    // The fake server's totals deliberately differ from a naive sum of the listed credits (+0.5 each), so a
    // planner that adds credits itself instead of showing the server's numbers fails these tests.
    const sel = s.courses.reduce((a, c) => a + Number(c.credits), 0) + 0.5;
    const ph = s.placeholders.reduce((a, c) => a + Number(c.desired_credits), 0) + 0.5;
    workload[s.term_id] = { selected_credits: String(sel), placeholder_credits: String(ph), target_credits: String(sel + ph) };
  }
  return {
    workload,
    per_course: p.semesters.flatMap((s) =>
      s.courses.map((c) => ({ id: c.id, term_id: s.term_id, eligibility, prerequisite_proof: { status: 'unknown', missing: [], proof: [], source_refs: [] }, offering_status: 'unknown', meeting_check_status: 'not_checked' as const })),
    ),
    issues: [
      ...p.semesters.flatMap((s) => s.placeholders.map((ph) => issue('PLACEHOLDER_UNRESOLVED', 'unknown', [ph.id], 'Select actual courses before eligibility or completion can be established.') as PlanValidation['issues'][number])),
      ...extraIssues,
    ],
    meeting_check_status: 'not_checked',
    completion_term: null,
  };
}

function server(
  opts: {
    conflictOnce?: boolean;
    offlineOnce?: boolean;
    extraIssues?: (p: AcademicPlan) => PlanValidation['issues'];
    eligibility?: PlanValidation['per_course'][number]['eligibility'];
    record?: typeof record;
  } = {},
) {
  let current: AcademicPlan = structuredClone(plan);
  const validate = (p: AcademicPlan) => validationFor(p, opts.extraIssues?.(p), opts.eligibility);
  const patches: Patch[] = [];
  let conflict = opts.conflictOnce ?? false;
  let offline = opts.offlineOnce ?? false;
  const api = fakeApi({
    'GET /record': () => ({ data: opts.record ?? record }),
    'GET /curricula/cse-2024': () => ({ data: curriculum }),
    'GET /catalogue': () => ({ data: { courses: [], coverage: 'unknown', review_status: 'draft' }, issues: [issue('CATALOGUE_MISSING')] }),
    'GET /plans/:id': () => ({ data: current }),
    'POST /plans/:id/validate': () => ({ data: validate(current) }),
    'PATCH /plans/:id': (req) => {
      const body = req.body as Patch;
      patches.push(body);
      if (offline) {
        offline = false;
        throw new TypeError('Failed to fetch');
      }
      if (conflict || body.expected_revision !== current.revision) {
        conflict = false;
        return { status: 409, data: { current_revision: current.revision + 5, action: 'reload_compare' }, issues: [issue('REVISION_CONFLICT', 'error')] };
      }
      current = { id: current.id, revision: current.revision + 1, label: body.label, semesters: body.semesters };
      return { data: { ...current, validation: validate(current) } };
    },
  });
  // A thrown TypeError inside a handler should behave like a network failure.
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      return await api.fetchImpl(input, init);
    } catch (e) {
      if (e instanceof TypeError) throw e;
      throw e;
    }
  }) as typeof fetch;
  return { fetchImpl, patches, get current() { return current; } };
}

const render = (s: ReturnType<typeof server>) => renderApp(<PlanPage />, { fetchImpl: s.fetchImpl, route: '/plan/plan-1', path: '/plan/:plan_id' });

const semester = (term: string) => screen.getByRole('region', { name: term });

describe('PlanPage (A06, CP-04/05/20..22)', () => {
  it('shows every remaining semester through semester 8, current term distinct, with server totals', async () => {
    const s = server();
    render(s);
    const current = await screen.findByRole('region', { name: '2026–27 Semester I' });
    expect(within(current).getByText('Current term')).toBeInTheDocument();
    expect(within(semester('2027–28 Semester II')).getByText(/Future term/)).toBeInTheDocument();
    // Server values (fake: 4.5 / 4.5 / 9), not the 4 + 4 a browser-side sum would give.
    await waitFor(() => expect(within(semester('2026–27 Semester II')).getByText(/Selected courses: 4\.5 credits/)).toBeInTheDocument());
    expect(within(semester('2026–27 Semester II')).getByText(/Placeholder target: 4\.5 credits/)).toBeInTheDocument();
    expect(within(semester('2026–27 Semester II')).getByText(/Target workload: 9 credits/)).toBeInTheDocument();
  });

  it('extends the plan by one term on request, without a hardcoded maximum', async () => {
    const s = server();
    render(s);
    await screen.findByRole('region', { name: '2026–27 Semester I' });
    await userEvent.click(screen.getByRole('button', { name: 'Extend plan by one term' }));
    expect(await screen.findByRole('region', { name: '2028–29 Semester I' })).toBeInTheDocument();
    await waitFor(() => expect(s.patches.at(-1)?.semesters.map((x) => x.term_id)).toContain('2028-29-I'), { timeout: 2000 });
  });

  it('adds a course (unverified when no catalogue), saves after debounce and shows acknowledged revision', async () => {
    const s = server();
    render(s);
    const sem = await screen.findByRole('region', { name: '2027–28 Semester I' });
    await userEvent.click(within(sem).getByRole('button', { name: 'Add course to 2027–28 Semester I' }));
    const dialog = screen.getByRole('dialog', { name: /Add course to 2027–28 Semester I/ });
    expect(within(dialog).getByText(/No reviewed catalogue/)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Course code'), 'ZZ 421');
    await userEvent.type(within(dialog).getByLabelText(/Credits/), '4');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add course' }));
    expect(within(semester('2027–28 Semester I')).getByText('ZZ 421')).toBeInTheDocument();
    await waitFor(() => expect(s.patches).toHaveLength(1), { timeout: 2000 });
    const sent = s.patches[0]!;
    expect(sent.expected_revision).toBe(2);
    expect(sent.semesters.find((x) => x.term_id === '2027-28-I')?.courses).toEqual([expect.objectContaining({ normalized_code: 'ZZ 421', credits: '4' })]);
    await waitFor(() => expect(screen.getByRole('status', { name: 'Plan save status' })).toHaveTextContent('Saved'));
    expect(screen.getByRole('status', { name: 'Plan save status' })).toHaveTextContent('Server revision 3');
  });

  it('moves a course with a keyboard-accessible select and button, and can undo', async () => {
    const s = server();
    render(s);
    await screen.findByRole('region', { name: '2026–27 Semester I' });
    const sem1 = semester('2026–27 Semester I');
    await userEvent.selectOptions(within(sem1).getByLabelText('Move ZZ 330 to'), '2027-28-I');
    await userEvent.click(within(sem1).getByRole('button', { name: 'Move ZZ 330' }));
    expect(within(semester('2027–28 Semester I')).getByText('ZZ 330')).toBeInTheDocument();
    expect(within(semester('2026–27 Semester I')).queryByText('ZZ 330')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Undo last change' }));
    expect(within(semester('2026–27 Semester I')).getByText('ZZ 330')).toBeInTheDocument();
    await waitFor(() => expect(s.patches.length).toBeGreaterThan(0), { timeout: 2000 });
    expect(s.patches.at(-1)?.semesters.find((x) => x.term_id === '2026-27-I')?.courses.map((c) => c.normalized_code)).toEqual(['ZZ 330']);
  });

  it('removes a course', async () => {
    const s = server();
    render(s);
    await screen.findByRole('region', { name: '2026–27 Semester II' });
    await userEvent.click(within(semester('2026–27 Semester II')).getByRole('button', { name: 'Remove ZZ 331' }));
    expect(within(semester('2026–27 Semester II')).queryByText('ZZ 331')).not.toBeInTheDocument();
    await waitFor(() => expect(s.patches.at(-1)?.semesters.find((x) => x.term_id === '2026-27-II')?.courses).toEqual([]), { timeout: 2000 });
  });

  it('keeps placeholders unresolved and lets the student choose a course for one', async () => {
    const s = server();
    render(s);
    const sem = await screen.findByRole('region', { name: '2026–27 Semester II' });
    const row = within(sem).getByText('HSS elective').closest('tr') as HTMLElement;
    expect(within(row).getByText('Unresolved placeholder')).toBeInTheDocument();
    expect(within(row).queryByText(/Eligible|In supplied snapshot/)).not.toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: 'Choose a course for HSS elective' }));
    const dialog = screen.getByRole('dialog', { name: /Choose a course for HSS elective/ });
    await userEvent.type(within(dialog).getByLabelText('Course code'), 'YY 151');
    await userEvent.type(within(dialog).getByLabelText(/Credits/), '4');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Use this course' }));
    await waitFor(() => expect(s.patches.length).toBeGreaterThan(0), { timeout: 2000 });
    const sent = s.patches.at(-1)!.semesters.find((x) => x.term_id === '2026-27-II')!;
    expect(sent.placeholders).toEqual([]);
    expect(sent.courses.map((c) => c.normalized_code)).toEqual(['ZZ 331', 'YY 151']);
    expect(sent.courses[1]).toMatchObject({ intended_allocation: 'hss' });
  });

  it('adds a labelled requirement placeholder counted as target workload', async () => {
    const s = server();
    render(s);
    const sem = await screen.findByRole('region', { name: '2027–28 Semester II' });
    await userEvent.click(within(sem).getByRole('button', { name: 'Add placeholder to 2027–28 Semester II' }));
    const dialog = screen.getByRole('dialog', { name: /Add placeholder/ });
    await userEvent.selectOptions(within(dialog).getByLabelText('Requirement'), 'theory');
    await userEvent.type(within(dialog).getByLabelText('Target credits'), '4');
    await userEvent.type(within(dialog).getByLabelText('Label'), 'Theory elective');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add placeholder' }));
    await waitFor(() => expect(s.patches.length).toBeGreaterThan(0), { timeout: 2000 });
    expect(s.patches.at(-1)!.semesters.find((x) => x.term_id === '2027-28-II')!.placeholders).toEqual([expect.objectContaining({ requirement_id: 'theory', desired_credits: '4', label: 'Theory elective' })]);
  });

  it('shows unknown prerequisite/offering/meeting evidence instead of eligible/clear', async () => {
    const s = server();
    render(s);
    const sem = await screen.findByRole('region', { name: '2026–27 Semester I' });
    const row = (await within(sem).findByText('ZZ 330')).closest('tr') as HTMLElement;
    await waitFor(() => expect(within(row).getAllByText('Unknown').length).toBeGreaterThan(0));
    expect(within(row).getByText('Not checked')).toBeInTheDocument();
    expect(within(row).queryByText('No clash found')).not.toBeInTheDocument();
  });

  it('groups validation issues; selecting one highlights the affected item and shows the remedy', async () => {
    const s = server({ extraIssues: () => [issue('PREREQUISITE_MISSING', 'error', ['c-net'], 'ZZ 331 needs ZZ 330 completed or planned earlier.')] });
    render(s);
    const panel = await screen.findByRole('region', { name: 'Plan validation' });
    await within(panel).findByText('ZZ 331 needs ZZ 330 completed or planned earlier.');
    expect(within(panel).getByRole('heading', { name: 'Errors (1)' })).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Show affected items for PREREQUISITE_MISSING' }));
    const row = within(semester('2026–27 Semester II')).getByText('ZZ 331').closest('tr') as HTMLElement;
    expect(row).toHaveAttribute('data-highlight', 'true');
    expect(within(row).getByText(/needs ZZ 330/)).toBeInTheDocument();
  });

  it('shows the server explanation of a nested unmet prerequisite and a duplicate on every affected item', async () => {
    const s = server({
      extraIssues: () => [
        issue('PREREQUISITE_MISSING', 'error', ['c-net'], 'Missing: ZZ 201 and (ZZ 202 or ZZ 203)'),
        issue('DUPLICATE_COURSE', 'error', ['c-net', 'c-os'], 'Already completed/selected or missing repeat instance evidence.'),
      ],
    });
    render(s);
    const panel = await screen.findByRole('region', { name: 'Plan validation' });
    await within(panel).findByText('Missing: ZZ 201 and (ZZ 202 or ZZ 203)');
    expect(within(panel).getByRole('heading', { name: 'Errors (2)' })).toBeInTheDocument();
    const net = within(semester('2026–27 Semester II')).getByText('ZZ 331').closest('tr') as HTMLElement;
    expect(within(net).getByText('Missing: ZZ 201 and (ZZ 202 or ZZ 203)')).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Show affected items for DUPLICATE_COURSE' }));
    const os = within(semester('2026–27 Semester I')).getByText('ZZ 330').closest('tr') as HTMLElement;
    expect(os).toHaveAttribute('data-highlight', 'true');
    expect(net).toHaveAttribute('data-highlight', 'true');
    expect(within(os).getByText(/missing repeat instance evidence/)).toBeInTheDocument();
    // Explanations come from the server; the planner does not reschedule anything itself.
    expect(s.patches).toHaveLength(0);
  });

  it('on 409 keeps the draft, shows reload/compare and does not retry automatically', async () => {
    const s = server({ conflictOnce: true });
    render(s);
    await screen.findByRole('region', { name: '2026–27 Semester II' });
    await userEvent.click(within(semester('2026–27 Semester II')).getByRole('button', { name: 'Remove ZZ 331' }));
    await waitFor(() => expect(screen.getByRole('status', { name: 'Plan save status' })).toHaveTextContent('Conflict'), { timeout: 2000 });
    expect(screen.getByRole('button', { name: 'Reload saved version' })).toBeInTheDocument();
    await act(async () => new Promise((r) => setTimeout(r, 800)));
    expect(s.patches).toHaveLength(1);
    expect(within(semester('2026–27 Semester II')).queryByText('ZZ 331')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reload saved version' }));
    await waitFor(() => expect(within(semester('2026–27 Semester II')).getByText('ZZ 331')).toBeInTheDocument());
  });

  it('an in-progress attempt does not move the current term past the semester being taken', async () => {
    const inProgress = { ...record, attempts: [...record.attempts, attempt({ id: 'a-now', normalized_code: 'ZZ 330', term_id: '2026-27-I', grade: '', completion_status: 'in_progress' })] };
    render(server({ record: inProgress }));
    const sem1 = await screen.findByRole('region', { name: '2026–27 Semester I' });
    expect(within(sem1).getByText('Current term')).toBeInTheDocument();
    expect(within(semester('2026–27 Semester II')).queryByText('Current term')).not.toBeInTheDocument();
  });

  it('after an unsaved edit, rows show "Not checked" instead of the previous revision\'s eligibility and issues', async () => {
    const s = server({ offlineOnce: true, eligibility: 'eligible', extraIssues: () => [issue('DUPLICATE_COURSE', 'error', ['c-os'], 'Synthetic duplicate on ZZ 330.')] });
    render(s);
    const sem1 = await screen.findByRole('region', { name: '2026–27 Semester I' });
    const before = within(sem1).getByText('ZZ 330').closest('tr') as HTMLElement;
    await waitFor(() => expect(within(before).getByText('Eligible')).toBeInTheDocument());
    expect(within(before).getByText('Synthetic duplicate on ZZ 330.')).toBeInTheDocument();
    await userEvent.selectOptions(within(sem1).getByLabelText('Move ZZ 330 to'), '2027-28-I');
    await userEvent.click(within(sem1).getByRole('button', { name: 'Move ZZ 330' }));
    // The save fails (offline), so no newer validation arrives: old results must not stay on the row.
    await waitFor(() => expect(screen.getByRole('status', { name: 'Plan save status' })).toHaveTextContent('Offline'), { timeout: 2000 });
    const moved = within(semester('2027–28 Semester I')).getByText('ZZ 330').closest('tr') as HTMLElement;
    expect(within(moved).queryByText('Eligible')).not.toBeInTheDocument();
    expect(within(moved).queryByText('Synthetic duplicate on ZZ 330.')).not.toBeInTheDocument();
    expect(within(moved).getAllByText('Not checked').length).toBeGreaterThan(0);
    expect(screen.getByRole('region', { name: 'Plan validation' })).toHaveTextContent(/not validated yet/);
  });

  it('leaving the page within the save delay still sends the edit', async () => {
    const s = server();
    const view = render(s);
    await screen.findByRole('region', { name: '2026–27 Semester II' });
    await userEvent.click(within(semester('2026–27 Semester II')).getByRole('button', { name: 'Remove ZZ 331' }));
    view.unmount();
    await waitFor(() => expect(s.patches).toHaveLength(1), { timeout: 2000 });
    expect(s.current.semesters.find((x) => x.term_id === '2026-27-II')?.courses).toEqual([]);
  });

  it('an unsaved draft whose save failed is still there when the student comes back to the plan', async () => {
    const s = server({ offlineOnce: true });
    const first = render(s);
    await screen.findByRole('region', { name: '2026–27 Semester II' });
    await userEvent.click(within(semester('2026–27 Semester II')).getByRole('button', { name: 'Remove ZZ 331' }));
    await waitFor(() => expect(screen.getByRole('status', { name: 'Plan save status' })).toHaveTextContent('Offline'), { timeout: 2000 });
    first.unmount();
    render(s);
    await screen.findByRole('region', { name: '2026–27 Semester II' });
    expect(within(semester('2026–27 Semester II')).queryByText('ZZ 331')).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Plan save status' })).toHaveTextContent('Offline');
    await userEvent.click(screen.getByRole('button', { name: 'Retry save' }));
    await waitFor(() => expect(screen.getByRole('status', { name: 'Plan save status' })).toHaveTextContent('Saved'), { timeout: 2000 });
    expect(s.current.semesters.find((x) => x.term_id === '2026-27-II')?.courses).toEqual([]);
  });

  it('shows offline state, keeps the draft and retries on request', async () => {
    const s = server({ offlineOnce: true });
    render(s);
    await screen.findByRole('region', { name: '2026–27 Semester II' });
    await userEvent.click(within(semester('2026–27 Semester II')).getByRole('button', { name: 'Remove ZZ 331' }));
    await waitFor(() => expect(screen.getByRole('status', { name: 'Plan save status' })).toHaveTextContent('Offline'), { timeout: 2000 });
    await userEvent.click(screen.getByRole('button', { name: 'Retry save' }));
    await waitFor(() => expect(screen.getByRole('status', { name: 'Plan save status' })).toHaveTextContent('Saved'), { timeout: 2000 });
    expect(s.current.semesters.find((x) => x.term_id === '2026-27-II')?.courses).toEqual([]);
  });
});

describe('PlanIndexPage', () => {
  it('creates a plan from the next term through semester 8 when none exists', async () => {
    const created: PlanPayload[] = [];
    const { fetchImpl } = fakeApi({
      'GET /record': () => ({ data: record }),
      'GET /plans': () => ({ data: [] }),
      'POST /plans': (req) => {
        created.push(req.body as PlanPayload);
        return { status: 201, data: { ...(req.body as PlanPayload), id: 'new-plan', revision: 0, validation: { workload: {}, per_course: [], issues: [], meeting_check_status: 'not_checked', completion_term: null } } };
      },
    });
    renderApp(<PlanIndexPage />, { fetchImpl, route: '/plan', path: '/plan' });
    await userEvent.click(await screen.findByRole('button', { name: 'Create a plan' }));
    await screen.findByText('navigated-away');
    expect(created[0]?.semesters.map((x) => x.term_id)).toEqual(['2026-27-I', '2026-27-II', '2027-28-I', '2027-28-II']);
  });

  it('starts a new plan at the semester currently in progress, not after it', async () => {
    const created: PlanPayload[] = [];
    const inProgress = { ...record, attempts: [...record.attempts, attempt({ id: 'a-now', normalized_code: 'ZZ 330', term_id: '2026-27-I', grade: '', completion_status: 'in_progress' })] };
    const { fetchImpl } = fakeApi({
      'GET /record': () => ({ data: inProgress }),
      'GET /plans': () => ({ data: [] }),
      'POST /plans': (req) => {
        created.push(req.body as PlanPayload);
        return { status: 201, data: { ...(req.body as PlanPayload), id: 'new-plan', revision: 0, validation: { workload: {}, per_course: [], issues: [], meeting_check_status: 'not_checked', completion_term: null } } };
      },
    });
    renderApp(<PlanIndexPage />, { fetchImpl, route: '/plan', path: '/plan' });
    await userEvent.click(await screen.findByRole('button', { name: 'Create a plan' }));
    await screen.findByText('navigated-away');
    expect(created[0]?.semesters[0]?.term_id).toBe('2026-27-I');
  });
});
