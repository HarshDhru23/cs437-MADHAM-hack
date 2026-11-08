import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { AcademicPlan, CatalogueCourse, PlanPayload, PlanValidation } from '../../api/types';
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
    /** Catalogue courses and the codes the 2027-28 Semester I timetable offers (for the course picker). */
    catalogue?: CatalogueCourse[];
    offered?: string[];
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
    'GET /catalogue': () => (opts.catalogue ? { data: { courses: opts.catalogue, coverage: 'partial', review_status: 'reviewed' } } : { data: { courses: [], coverage: 'unknown', review_status: 'draft' }, issues: [issue('CATALOGUE_MISSING')] }),
    'GET /offerings?term_id=2027-28-I': () => ({
      data: { id: 'snap', term_id: '2027-28-I', coverage: 'complete', review_status: 'reviewed', offerings: (opts.offered ?? []).map((code) => ({ id: `2027-28-I:${code}`, code, meeting_groups: [] })) },
    }),
    'GET /plans/:id': () => ({ data: current }),
    'POST /plans/:id/validate': () => ({ data: validate(current) }),
    // The same check the draft plan uses: numbers are the server's (the fake's differ from anything a browser-side sum would give).
    'POST /plans/check': (req) => {
      const body = req.body as { semesters: AcademicPlan['semesters'] };
      const load = Object.fromEntries(body.semesters.map((s) => [s.term_id, { planned_credits: '20', limit_credits: s.term_id.endsWith('SUMMER') ? '10' : '28', available_credits: s.term_id.endsWith('SUMMER') ? '0' : '8' }]));
      return {
        data: {
          validation: validate(current),
          degree: { total_credits: '170', counted_credits: '150', remaining_credits: '20' },
          placeholder_credits: '4',
          uncovered_credits: '16',
          requirements: [{ id: 'open-electives', label: 'Open electives', group: 'Open electives', required_credits: '16', counted_credits: '0', remaining_credits: '16', held_credits: '4', uncovered_credits: '12' }],
          online: { planned_credits: '6', counted_credits: '4' },
          load,
        },
      };
    },
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
    expect(screen.queryByText(/Future term/)).not.toBeInTheDocument(); // no "timetable not yet known" notice on later terms
    // The server's total (fake: 9), not the 4 + 4 a browser-side sum would give; shown against the 28-credit limit.
    await waitFor(() => expect(within(semester('2026–27 Semester II')).getByText('Semester total: 9 / 28 credits')).toBeInTheDocument());
    expect(screen.queryByText(/Placeholder target|Selected courses|Target workload/)).not.toBeInTheDocument();
  });

  it('shows how many more credits fit in each semester and what is left for graduation, from the server check', async () => {
    const s = server();
    render(s);
    await screen.findByRole('region', { name: '2026–27 Semester I' });
    await waitFor(() => expect(within(semester('2026–27 Semester I')).getByText(/8 more credits can be added/)).toBeInTheDocument());
    const progress = screen.getByRole('region', { name: 'Your plan so far' });
    await waitFor(() => expect(within(progress).getByText('16 credits left for graduation')).toBeInTheDocument());
    expect(within(progress).getByText('Open electives: 12 more credits needed')).toBeInTheDocument();
    expect(within(progress).getByText('150 of 170 degree credits covered by your plan')).toBeInTheDocument();
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
    await userEvent.type(within(dialog).getByLabelText('Course code'), 'ZZ 421');
    await userEvent.type(within(dialog).getByLabelText(/Credits/), '4');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add course' }));
    expect(within(semester('2027–28 Semester I')).getByText('ZZ 421')).toBeInTheDocument();
    await waitFor(() => expect(s.patches).toHaveLength(1), { timeout: 2000 });
    const sent = s.patches[0]!;
    expect(sent.expected_revision).toBe(2);
    expect(sent.semesters.find((x) => x.term_id === '2027-28-I')?.courses).toEqual([expect.objectContaining({ normalized_code: 'ZZ 421', credits: '4' })]);
    await waitFor(() => expect(screen.getByRole('status', { name: 'Plan save status' })).toHaveTextContent('Saved'));
    expect(screen.getByRole('status', { name: 'Plan save status' })).not.toHaveTextContent(/revision/i); // no backend revision numbers for the student
  });

  it('the add-course picker lists the basket courses offered in that semester and adds the one chosen', async () => {
    const basket = (code: string, title: string): CatalogueCourse => ({ id: `v1:${code}`, normalized_code: code, title, credits: '4', department: 'ZZ', baskets: ['systems'], could_satisfy: ['Systems basket'] });
    const s = server({ catalogue: [basket('ZZ 327', 'Synthetic Distributed Systems'), basket('ZZ 332', 'Synthetic Compilers')], offered: ['ZZ 327'] }); // ZZ 332 is not offered that semester
    render(s);
    const sem = await screen.findByRole('region', { name: '2027–28 Semester I' });
    await userEvent.click(within(sem).getByRole('button', { name: 'Add course to 2027–28 Semester I' }));
    const dialog = screen.getByRole('dialog', { name: /Add course to 2027–28 Semester I/ });
    await userEvent.selectOptions(await within(dialog).findByLabelText('Requirement'), 'Systems basket');
    const results = within(dialog).getByRole('list', { name: 'Matching courses' });
    expect(within(results).getByText('ZZ 327')).toBeInTheDocument();
    expect(within(results).queryByText('ZZ 332')).not.toBeInTheDocument();
    await userEvent.click(within(results).getByRole('button', { name: 'Add ZZ 327' }));
    expect(within(semester('2027–28 Semester I')).getByText('ZZ 327')).toBeInTheDocument();
    await waitFor(() => expect(s.patches).toHaveLength(1), { timeout: 2000 });
    expect(s.patches[0]!.semesters.find((x) => x.term_id === '2027-28-I')?.courses).toEqual([expect.objectContaining({ normalized_code: 'ZZ 327', credits: '4' })]);
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
    // The save is debounced; on a busy machine the move can be sent before the undo. What counts is that the last thing saved is the undone plan.
    await waitFor(() => expect(s.patches.at(-1)?.semesters.find((x) => x.term_id === '2026-27-I')?.courses.map((c) => c.normalized_code)).toEqual(['ZZ 330']), { timeout: 4000 });
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
    expect(within(row).getByText('Course not chosen yet')).toBeInTheDocument();
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

  it('adds an online course by hand, named or not, through the same save as any other edit', async () => {
    const s = server();
    render(s);
    const sem = await screen.findByRole('region', { name: '2027–28 Semester II' });
    await userEvent.click(within(sem).getByRole('button', { name: 'Add online course to 2027–28 Semester II' }));
    const dialog = screen.getByRole('dialog', { name: 'Add online course to 2027–28 Semester II' });
    await userEvent.selectOptions(within(dialog).getByLabelText('Counts toward'), 'open-electives');
    await userEvent.clear(within(dialog).getByLabelText('Credits'));
    await userEvent.type(within(dialog).getByLabelText('Credits'), '3');
    await userEvent.type(within(dialog).getByLabelText('Course name (optional)'), 'Machine Learning on NPTEL');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add online course' }));
    await waitFor(() => expect(s.patches.length).toBeGreaterThan(0), { timeout: 2000 });
    expect(s.patches.at(-1)!.semesters.find((x) => x.term_id === '2027-28-II')!.placeholders).toEqual([
      { id: 'user-online-2027-28-II-1', requirement_id: 'open-electives', desired_credits: '3', label: 'Machine Learning on NPTEL', online: true },
    ]);
    const row = (await within(await screen.findByRole('region', { name: '2027–28 Semester II' })).findByText('Machine Learning on NPTEL')).closest('tr') as HTMLElement;
    expect(row).toHaveTextContent('Online course'); // a named online course is chosen already: no "Choose a course" button
    expect(within(row).queryByRole('button', { name: /Choose a course/ })).not.toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Remove placeholder Machine Learning on NPTEL' })).toBeInTheDocument();
  });

  it('an online course without a name is called "Online course" and can still be replaced by a real one', async () => {
    const s = server();
    render(s);
    const sem = await screen.findByRole('region', { name: '2027–28 Semester II' });
    await userEvent.click(within(sem).getByRole('button', { name: 'Add online course to 2027–28 Semester II' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: /Add online course/ })).getByRole('button', { name: 'Add online course' }));
    await waitFor(() => expect(s.patches.length).toBeGreaterThan(0), { timeout: 2000 });
    expect(s.patches.at(-1)!.semesters.find((x) => x.term_id === '2027-28-II')!.placeholders).toEqual([expect.objectContaining({ label: 'Online course', online: true })]);
    expect(await within(sem).findByRole('button', { name: 'Choose a course for Online course' })).toBeInTheDocument();
  });

  it('refuses online credits outside 1 to 8 with a plain message and adds nothing', async () => {
    const s = server();
    render(s);
    const sem = await screen.findByRole('region', { name: '2027–28 Semester II' });
    await userEvent.click(within(sem).getByRole('button', { name: 'Add online course to 2027–28 Semester II' }));
    const dialog = screen.getByRole('dialog', { name: /Add online course/ });
    await userEvent.clear(within(dialog).getByLabelText('Credits'));
    await userEvent.type(within(dialog).getByLabelText('Credits'), '12');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add online course' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Enter the credits as a number from 1 to 8.');
    expect(s.patches).toHaveLength(0);
  });

  it('adds a summer break for each academic year whose second semester is in the plan, and only once', async () => {
    const s = server();
    render(s);
    await screen.findByRole('region', { name: '2027–28 Semester II' });
    const choice = screen.getByLabelText('Add a summer break') as HTMLSelectElement;
    expect([...choice.options].map((o) => o.textContent)).toEqual(['Choose a summer break', '2026–27 Summer', '2027–28 Summer']);
    await userEvent.selectOptions(choice, '2026-27-SUMMER');
    await waitFor(() => expect(s.patches.length).toBeGreaterThan(0), { timeout: 2000 });
    expect(s.patches.at(-1)!.semesters.map((x) => x.term_id)).toEqual(['2026-27-I', '2026-27-II', '2027-28-I', '2027-28-II', '2026-27-SUMMER']);
    const summer = await screen.findByRole('region', { name: '2026–27 Summer' });
    expect(await within(summer).findByText(/Summer total: .* \/ 10 credits/)).toBeInTheDocument(); // a summer break holds at most 10 credits
    expect([...(screen.getByLabelText('Add a summer break') as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(['Choose a summer break', '2027–28 Summer']);
  });

  it('shows how many online credits are planned and how many count toward the degree', async () => {
    const s = server();
    render(s);
    const progress = await screen.findByRole('region', { name: 'Your plan so far' });
    expect(await within(progress).findByText('Online credits: 6 planned, 4 count toward your degree')).toBeInTheDocument();
  });

  it('a planned course row shows no evidence chips: nothing "not checked", "not confirmed" or "no recommendation", and never eligible/clear', async () => {
    const s = server();
    render(s);
    const sem = await screen.findByRole('region', { name: '2026–27 Semester I' });
    const row = (await within(sem).findByText('ZZ 330')).closest('tr') as HTMLElement;
    await waitFor(() => expect(screen.getByRole('region', { name: 'Plan validation' })).toHaveTextContent('No problems found with your plan.'));
    expect(row).not.toHaveTextContent(/Not checked|Not confirmed|No recommendation|Not published|Unknown|Expected|snapshot/i);
    expect(within(row).queryByText(/Preparation met|No clash found|Eligible/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Timetable check:|Completion term|evidence incomplete/)).not.toBeInTheDocument();
  });

  it('groups validation issues; selecting one highlights the affected item and shows the remedy', async () => {
    const s = server({ extraIssues: () => [issue('PREREQUISITE_MISSING', 'warning', ['c-net'], 'ZZ 331 needs ZZ 330 completed or planned earlier.')] });
    render(s);
    const panel = await screen.findByRole('region', { name: 'Plan validation' });
    await within(panel).findByText('ZZ 331 needs ZZ 330 completed or planned earlier.');
    expect(within(panel).getByRole('heading', { name: 'Warnings (1)' })).toBeInTheDocument(); // a recommendation, never an error
    expect(panel).not.toHaveTextContent('PREREQUISITE_MISSING');
    await userEvent.click(within(panel).getByRole('button', { name: 'Show affected items: ZZ 331 needs ZZ 330 completed or planned earlier.' }));
    const row = within(semester('2026–27 Semester II')).getByText('ZZ 331').closest('tr') as HTMLElement;
    expect(row).toHaveAttribute('data-highlight', 'true');
    expect(within(row).getByText(/needs ZZ 330/)).toBeInTheDocument();
  });

  it('shows the server explanation of a nested unmet prerequisite and a duplicate on every affected item', async () => {
    const s = server({
      extraIssues: () => [
        issue('PREREQUISITE_MISSING', 'warning', ['c-net'], 'Missing: ZZ 201 and (ZZ 202 or ZZ 203)'),
        issue('DUPLICATE_COURSE', 'error', ['c-net', 'c-os'], 'Already completed/selected or missing repeat instance evidence.'),
      ],
    });
    render(s);
    const panel = await screen.findByRole('region', { name: 'Plan validation' });
    await within(panel).findByText('Missing: ZZ 201 and (ZZ 202 or ZZ 203)');
    expect(within(panel).getByRole('heading', { name: 'Errors (1)' })).toBeInTheDocument(); // the duplicate
    expect(within(panel).getByRole('heading', { name: 'Warnings (1)' })).toBeInTheDocument(); // the recommendation
    const net = within(semester('2026–27 Semester II')).getByText('ZZ 331').closest('tr') as HTMLElement;
    expect(within(net).getByText('Missing: ZZ 201 and (ZZ 202 or ZZ 203)')).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Show affected items: ZZ 331 is already in your plan or already completed.' }));
    const os = within(semester('2026–27 Semester I')).getByText('ZZ 330').closest('tr') as HTMLElement;
    expect(os).toHaveAttribute('data-highlight', 'true');
    expect(net).toHaveAttribute('data-highlight', 'true');
    expect(within(os).getByText(/already in your plan or already completed/)).toBeInTheDocument();
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

  it('after an unsaved edit, rows drop the previous version\'s problems and the panel says it is checking', async () => {
    const s = server({ offlineOnce: true, eligibility: 'eligible', extraIssues: () => [issue('DUPLICATE_COURSE', 'error', ['c-os'], 'Synthetic duplicate on ZZ 330.')] });
    render(s);
    const sem1 = await screen.findByRole('region', { name: '2026–27 Semester I' });
    const before = within(sem1).getByText('ZZ 330').closest('tr') as HTMLElement;
    await waitFor(() => expect(within(before).getByText('ZZ 330 is already in your plan or already completed.')).toBeInTheDocument());
    await userEvent.selectOptions(within(sem1).getByLabelText('Move ZZ 330 to'), '2027-28-I');
    await userEvent.click(within(sem1).getByRole('button', { name: 'Move ZZ 330' }));
    // The save fails (offline), so no newer validation arrives: old results must not stay on the row.
    await waitFor(() => expect(screen.getByRole('status', { name: 'Plan save status' })).toHaveTextContent('Offline'), { timeout: 2000 });
    const moved = within(semester('2027–28 Semester I')).getByText('ZZ 330').closest('tr') as HTMLElement;
    expect(within(moved).queryByText('ZZ 330 is already in your plan or already completed.')).not.toBeInTheDocument();
    expect(moved).not.toHaveTextContent(/Not checked/);
    expect(screen.getByRole('region', { name: 'Plan validation' })).toHaveTextContent(/Checking your latest changes/);
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
