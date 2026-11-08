import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { usePlans } from '../../api/hooks';
import type { AcademicPlan, PlanPayload, PlanValidation } from '../../api/types';
import { curriculum, plan, record } from '../../test/fixtures';
import { fakeApi, issue, renderApp, type FakeRequest } from '../../test/harness';
import { PlanIndexPage, PlanPage } from './PlanPage';

/**
 * Saved plans on their own page and in the list: deleting them, and the bugs found while exercising the page (stale cached revision after a
 * save, team wording in problems, plan titles, placeholder form). A fake server keeps real state so a request is only answered the way the
 * real one would be: a stale revision on PATCH/DELETE is a 409, a missing plan a 404.
 */
type Method = 'PATCH' | 'DELETE';

function makeServer(opts: { network?: { delete?: number; patch?: number }; deleteStatus?: number; extra?: (p: AcademicPlan) => PlanValidation['issues'] } = {}) {
  let plans: AcademicPlan[] = [structuredClone(plan), { ...structuredClone(plan), id: 'plan-2', revision: 0, label: 'Second plan' }];
  const log: { method: Method; id: string; revision: number | null }[] = [];
  let failDelete = opts.network?.delete ?? 0;
  let failPatch = opts.network?.patch ?? 0;
  const validate = (p: AcademicPlan): PlanValidation => ({
    workload: Object.fromEntries(p.semesters.map((s) => [s.term_id, { selected_credits: '4', placeholder_credits: '0', target_credits: '4' }])),
    per_course: [],
    issues: opts.extra?.(p) ?? [],
    meeting_check_status: 'not_checked',
    completion_term: null,
  });
  const find = (req: FakeRequest) => plans.find((p) => p.id === req.path.split('/')[2]);
  const missing = () => ({ status: 404, data: null, issues: [issue('NOT_FOUND', 'error')] });
  const conflict = (p: AcademicPlan) => ({ status: 409, data: { current_revision: p.revision, action: 'reload_compare' }, issues: [issue('REVISION_CONFLICT', 'error')] });
  const noTimetable = (term: string) => ({ data: { id: null, term_id: term, coverage: 'unknown', review_status: null, offerings: [], slot_map: {}, source_refs: [] } });
  const timetables = Object.fromEntries(['2026-27-I', '2026-27-II', '2027-28-I', '2027-28-II', '2028-29-I', '2028-29-II'].map((t) => [`GET /offerings?term_id=${t}`, () => noTimetable(t)]));
  const api = fakeApi({
    ...timetables,
    'GET /record': () => ({ data: record }),
    'GET /curricula/cse-2024': () => ({ data: curriculum }),
    'GET /catalogue': () => ({
      data: { courses: [{ id: 'cse-2024-v1:ZZ 330', normalized_code: 'ZZ 330', title: 'Synthetic operating systems', credits: '4' }], coverage: 'partial', review_status: 'reviewed' },
    }),
    'GET /plans': () => ({ data: plans }),
    'GET /plans/:id': (req) => {
      const p = find(req);
      return p ? { data: p } : missing();
    },
    'POST /plans/:id/validate': (req) => {
      const p = find(req);
      return p ? { data: validate(p) } : missing();
    },
    'PATCH /plans/:id': (req) => {
      const p = find(req);
      const body = req.body as PlanPayload & { expected_revision: number };
      log.push({ method: 'PATCH', id: req.path.split('/')[2]!, revision: body.expected_revision });
      if (failPatch > 0) {
        failPatch -= 1;
        throw new TypeError('Failed to fetch');
      }
      if (!p) return missing();
      if (body.expected_revision !== p.revision) return conflict(p);
      const next = { ...p, revision: p.revision + 1, label: body.label, semesters: body.semesters };
      plans = plans.map((x) => (x.id === p.id ? next : x));
      return { data: { ...next, validation: validate(next) } };
    },
    'DELETE /plans/:id': (req) => {
      const id = req.path.split('/')[2]!;
      const p = find(req);
      log.push({ method: 'DELETE', id, revision: (req.body as { expected_revision: number }).expected_revision });
      if (failDelete > 0) {
        failDelete -= 1;
        throw new TypeError('Failed to fetch');
      }
      if (opts.deleteStatus === 404 || !p) return missing();
      if ((req.body as { expected_revision: number }).expected_revision !== p.revision) return conflict(p);
      plans = plans.filter((x) => x.id !== id);
      return { data: null };
    },
  });
  return {
    ...api,
    log,
    get plans() {
      return plans;
    },
    /** Another tab or device changes plan-1 behind the page's back. */
    changeElsewhere() {
      plans = plans.map((p) => (p.id === 'plan-1' ? { ...p, revision: p.revision + 1 } : p));
    },
    /** Another tab or device deletes plan-1. */
    deleteElsewhere() {
      plans = plans.filter((p) => p.id !== 'plan-1');
    },
  };
}

function PlansProbe() {
  const plans = usePlans();
  return <p data-testid="plans-probe">{plans.data ? `${plans.data.length} plans` : 'loading'}</p>;
}

function renderRoutes(server: ReturnType<typeof makeServer>, route: string) {
  return renderApp(
    <>
      <nav>
        <Link to="/plan">go to the list</Link>
        <Link to="/plan/plan-1">go to plan 1</Link>
      </nav>
      <PlansProbe />
      <Routes>
        <Route path="/plan" element={<PlanIndexPage />} />
        <Route path="/plan/:plan_id" element={<PlanPage />} />
      </Routes>
    </>,
    { fetchImpl: server.fetchImpl, route, path: '/*' },
  );
}

const deleteCalls = (s: ReturnType<typeof makeServer>) => s.calls.filter((c) => c.method === 'DELETE');
const listItem = (name: string) => within(screen.getByRole('list', { name: 'Your saved plans' })).getByText(name).closest('li') as HTMLElement;

describe('Deleting saved plans from the list', () => {
  it('asks first and sends nothing until the student confirms', async () => {
    const s = makeServer();
    renderRoutes(s, '/plan');
    await userEvent.click(await screen.findByRole('button', { name: 'Delete plan Main plan' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete this plan?' });
    expect(dialog).toHaveTextContent('“Main plan” will be deleted and cannot be undone. Your record and your other plans are not changed.');
    expect(deleteCalls(s)).toHaveLength(0);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(deleteCalls(s)).toHaveLength(0);
    expect(s.plans).toHaveLength(2);
  });

  it('deletes the plan with its revision, removes it from the list and says so', async () => {
    const s = makeServer();
    renderRoutes(s, '/plan');
    await userEvent.click(await screen.findByRole('button', { name: 'Delete plan Main plan' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Delete this plan?' })).getByRole('button', { name: 'Delete plan' }));
    await waitFor(() => expect(screen.queryByText('Main plan', { selector: 'a' })).not.toBeInTheDocument());
    expect(s.log).toEqual([{ method: 'DELETE', id: 'plan-1', revision: 2 }]);
    expect(screen.getByText('Deleted “Main plan”.')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Your saved plans' })).getByText('Second plan')).toBeInTheDocument();
    expect(s.plans.map((p) => p.id)).toEqual(['plan-2']);
  });

  it('refreshes every other view of the plans list (the Requirements projection selector) after a delete', async () => {
    const s = makeServer();
    renderRoutes(s, '/plan');
    await waitFor(() => expect(screen.getByTestId('plans-probe')).toHaveTextContent('2 plans'));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete plan Second plan' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Delete this plan?' })).getByRole('button', { name: 'Delete plan' }));
    await waitFor(() => expect(screen.getByTestId('plans-probe')).toHaveTextContent('1 plans'));
  });

  it('a stale plan (changed on another device) is not deleted: it says so and reloads the list', async () => {
    const s = makeServer();
    renderRoutes(s, '/plan');
    await userEvent.click(await screen.findByRole('button', { name: 'Delete plan Main plan' }));
    s.changeElsewhere();
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Delete this plan?' })).getByRole('button', { name: 'Delete plan' }));
    expect(await screen.findByText(/changed in another tab or on another device, so it was not deleted/)).toBeInTheDocument();
    expect(s.plans.map((p) => p.id)).toEqual(['plan-1', 'plan-2']);
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument(); // retrying with the old revision would conflict again
    // The list was reloaded, so the next delete uses the newer revision and works.
    await waitFor(() => expect(s.calls.filter((c) => c.method === 'GET' && c.path === '/plans').length).toBeGreaterThan(1));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete plan Main plan' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Delete this plan?' })).getByRole('button', { name: 'Delete plan' }));
    await waitFor(() => expect(s.plans.map((p) => p.id)).toEqual(['plan-2']));
    expect(s.log.at(-1)).toEqual({ method: 'DELETE', id: 'plan-1', revision: 3 });
  });

  it('a plan that is already gone just disappears from the list', async () => {
    const s = makeServer({ deleteStatus: 404 });
    renderRoutes(s, '/plan');
    await userEvent.click(await screen.findByRole('button', { name: 'Delete plan Main plan' }));
    s.deleteElsewhere();
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Delete this plan?' })).getByRole('button', { name: 'Delete plan' }));
    await waitFor(() => expect(screen.queryByText('Main plan', { selector: 'a' })).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a network failure keeps the plan, explains, and "Try again" deletes it', async () => {
    const s = makeServer({ network: { delete: 1 } });
    renderRoutes(s, '/plan');
    await userEvent.click(await screen.findByRole('button', { name: 'Delete plan Main plan' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Delete this plan?' })).getByRole('button', { name: 'Delete plan' }));
    expect(await screen.findByText('CoursePath could not be reached, so the plan was not deleted.')).toBeInTheDocument();
    expect(s.plans).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Delete plan Main plan' })).toBeEnabled(); // the button is usable again
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(s.plans.map((p) => p.id)).toEqual(['plan-2']));
    expect(deleteCalls(s)).toHaveLength(2);
  });

  it('while one delete is running no other delete can be started', async () => {
    const s = makeServer();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const slow = s.fetchImpl;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'DELETE') await gate;
      return slow(input, init);
    }) as typeof fetch;
    renderApp(<PlanIndexPage />, { fetchImpl, route: '/plan', path: '/plan' });
    await userEvent.click(await screen.findByRole('button', { name: 'Delete plan Main plan' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Delete this plan?' })).getByRole('button', { name: 'Delete plan' }));
    expect(await screen.findByRole('button', { name: 'Delete plan Main plan' })).toHaveTextContent('Deleting…');
    expect(screen.getByRole('button', { name: 'Delete plan Second plan' })).toBeDisabled();
    await act(async () => release());
    await waitFor(() => expect(s.plans.map((p) => p.id)).toEqual(['plan-2']));
  });
});

describe('Deleting a saved plan from its own page', () => {
  it('confirms, deletes, goes back to the list and says which plan was deleted', async () => {
    const s = makeServer();
    renderRoutes(s, '/plan/plan-1');
    await userEvent.click(await screen.findByRole('button', { name: 'Delete plan Main plan' }));
    expect(deleteCalls(s)).toHaveLength(0);
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Delete this plan?' })).getByRole('button', { name: 'Delete plan' }));
    expect(await screen.findByRole('heading', { name: 'Plans' })).toBeInTheDocument();
    expect(screen.getByText('Deleted “Main plan”.')).toBeInTheDocument();
    expect(s.plans.map((p) => p.id)).toEqual(['plan-2']);
    expect(listItem('Second plan')).toBeInTheDocument();
    expect(screen.queryByText('Main plan', { selector: 'a' })).not.toBeInTheDocument();
  });

  it('a waiting edit is saved first so the delete uses the newest revision, and nothing is sent to the plan afterwards', async () => {
    const s = makeServer();
    renderRoutes(s, '/plan/plan-1');
    const sem = await screen.findByRole('region', { name: '2026–27 Semester II' });
    await userEvent.click(within(sem).getByRole('button', { name: 'Remove ZZ 331' })); // an edit still inside the save delay
    await userEvent.click(screen.getByRole('button', { name: 'Delete plan Main plan' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Delete this plan?' })).getByRole('button', { name: 'Delete plan' }));
    await screen.findByRole('heading', { name: 'Plans' });
    expect(s.log).toEqual([
      { method: 'PATCH', id: 'plan-1', revision: 2 },
      { method: 'DELETE', id: 'plan-1', revision: 3 },
    ]);
    await act(async () => new Promise((r) => setTimeout(r, 700)));
    expect(s.log).toHaveLength(2);
  });

  it('an edit that cannot be saved (offline) does not block deleting: the acknowledged revision is used and the draft is dropped', async () => {
    const s = makeServer({ network: { patch: 1 } });
    renderRoutes(s, '/plan/plan-1');
    const sem = await screen.findByRole('region', { name: '2026–27 Semester II' });
    await userEvent.click(within(sem).getByRole('button', { name: 'Remove ZZ 331' }));
    await waitFor(() => expect(screen.getByRole('status', { name: 'Plan save status' })).toHaveTextContent('Offline'), { timeout: 2000 });
    await userEvent.click(screen.getByRole('button', { name: 'Delete plan Main plan' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Delete this plan?' })).getByRole('button', { name: 'Delete plan' }));
    await screen.findByRole('heading', { name: 'Plans' });
    expect(s.log.at(-1)).toEqual({ method: 'DELETE', id: 'plan-1', revision: 2 });
    await act(async () => new Promise((r) => setTimeout(r, 700)));
    expect(s.log.filter((l) => l.method === 'PATCH')).toHaveLength(1); // the failed save was not retried against the deleted plan
  });

  it('a plan changed elsewhere is not deleted from its page either', async () => {
    const s = makeServer();
    renderRoutes(s, '/plan/plan-1');
    await userEvent.click(await screen.findByRole('button', { name: 'Delete plan Main plan' }));
    s.changeElsewhere();
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Delete this plan?' })).getByRole('button', { name: 'Delete plan' }));
    expect(await screen.findByText(/changed in another tab or on another device, so it was not deleted/)).toBeInTheDocument();
    expect(s.plans.map((p) => p.id)).toEqual(['plan-1', 'plan-2']);
    expect(screen.getByRole('heading', { name: 'Main plan' })).toBeInTheDocument(); // still on the plan
  });

  it('opening a plan that was deleted shows "Plan not found" with a way back, never an empty planner', async () => {
    const s = makeServer();
    s.deleteElsewhere();
    renderRoutes(s, '/plan/plan-1');
    expect(await screen.findByText('Plan not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Your plans' })).toHaveAttribute('href', '/plan');
    expect(screen.queryByRole('button', { name: /Delete plan/ })).not.toBeInTheDocument();
  });
});

describe('Saved plan page: bugs found while exercising it', () => {
  it('after a save, leaving and coming back starts from the saved revision (an older cached copy would conflict on the next edit)', async () => {
    const s = makeServer();
    renderRoutes(s, '/plan/plan-1');
    const sem = await screen.findByRole('region', { name: '2026–27 Semester II' });
    await userEvent.click(within(sem).getByRole('button', { name: 'Remove ZZ 331' }));
    await waitFor(() => expect(screen.getByRole('status', { name: 'Plan save status' })).toHaveTextContent('Saved'), { timeout: 2000 });
    await userEvent.click(screen.getByRole('link', { name: 'go to the list' }));
    await screen.findByRole('heading', { name: 'Plans' });
    await userEvent.click(screen.getByRole('link', { name: 'go to plan 1' }));
    const again = await screen.findByRole('region', { name: '2026–27 Semester II' });
    expect(within(again).queryByText('ZZ 331')).not.toBeInTheDocument(); // the saved edit, not the copy cached before it
    await userEvent.click(within(screen.getByRole('region', { name: '2026–27 Semester I' })).getByRole('button', { name: 'Remove ZZ 330' }));
    await waitFor(() => expect(s.log.filter((l) => l.method === 'PATCH')).toHaveLength(2), { timeout: 2000 });
    expect(s.log.filter((l) => l.method === 'PATCH').map((l) => l.revision)).toEqual([2, 3]);
    expect(screen.queryByText(/Saved elsewhere|Conflict/)).not.toBeInTheDocument();
  });

  it('shows a course title from the catalogue, and still lists and removes a course the catalogue does not know', async () => {
    const s = makeServer();
    renderRoutes(s, '/plan/plan-1');
    const sem1 = await screen.findByRole('region', { name: '2026–27 Semester I' });
    expect(await within(sem1).findByText('Synthetic operating systems')).toBeInTheDocument();
    const sem2 = screen.getByRole('region', { name: '2026–27 Semester II' }); // ZZ 331 is not in the catalogue
    expect(within(sem2).getByText('ZZ 331')).toBeInTheDocument();
    await userEvent.click(within(sem2).getByRole('button', { name: 'Remove ZZ 331' }));
    expect(within(sem2).queryByText('ZZ 331')).not.toBeInTheDocument();
  });

  it('problems are in plain words: no "CoursePath team", no codes, no notes', async () => {
    const s = makeServer({
      extra: () => [
        issue('PREREQUISITE_MISSING', 'warning', ['c-net'], 'Recommended preparation (CoursePath team) missing: ZZ 201'),
        issue('PREREQUISITE_CONDITIONAL', 'warning', ['c-os'], 'Recommended preparation (CoursePath team) is planned earlier; it helps only if passed.'),
        issue('STANDING_ASSUMED', 'info', ['2026-27-I'], 'Assuming regular standing (28-credit cap) until you set your standing.'),
        issue('LOAD_GUIDANCE', 'warning', ['2026-27-I'], 'Normal regular-term guidance is 20-24 credits.'),
      ],
    });
    renderRoutes(s, '/plan/plan-1');
    const panel = await screen.findByRole('region', { name: 'Plan validation' });
    expect(await within(panel).findByText('Recommended earlier course not completed or planned: ZZ 201')).toBeInTheDocument();
    expect(within(panel).getByText('A recommended earlier course is planned first; it only helps if you pass it.')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/CoursePath team|standing|20-24|[A-Z]{3,}_[A-Z]+/);
  });

  it('the placeholder form lists only requirements a student works on, and rejects 0 credits', async () => {
    const s = makeServer();
    renderRoutes(s, '/plan/plan-1');
    const sem = await screen.findByRole('region', { name: '2027–28 Semester II' });
    await userEvent.click(within(sem).getByRole('button', { name: 'Add placeholder to 2027–28 Semester II' }));
    const dialog = screen.getByRole('dialog', { name: /Add placeholder/ });
    const options = within(dialog).getAllByRole('option').map((o) => o.textContent ?? '');
    expect(options.join(' | ')).not.toMatch(/HSS \(GE included\)|CSE core/); // whole groups are not requirements to fill
    expect(options.length).toBeGreaterThan(0);
    await userEvent.type(within(dialog).getByLabelText('Target credits'), '0');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add placeholder' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Target credits must be more than 0.');
    expect(s.log).toHaveLength(0);
  });

  it('extending twice adds two consecutive terms and no term twice', async () => {
    const s = makeServer();
    renderRoutes(s, '/plan/plan-1');
    await screen.findByRole('region', { name: '2027–28 Semester II' });
    await userEvent.click(screen.getByRole('button', { name: 'Extend plan by one term' }));
    await userEvent.click(screen.getByRole('button', { name: 'Extend plan by one term' }));
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings.filter((h) => h === '2028–29 Semester I')).toHaveLength(1);
    expect(headings.filter((h) => h === '2028–29 Semester II')).toHaveLength(1);
    expect(headings.indexOf('2028–29 Semester I')).toBeLessThan(headings.indexOf('2028–29 Semester II'));
  });
});

describe('Timetable panel when the timetable cannot be loaded', () => {
  it('says so in plain words with a retry, never an error code', async () => {
    const s = makeServer();
    const original = s.fetchImpl;
    let failing = true;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/offerings?term_id=2026-27-I') && failing) return new Response(JSON.stringify({ data: null, issues: [issue('INTERNAL_FAILURE', 'error')], schema_version: '1' }), { status: 500 });
      return original(input, init);
    }) as typeof fetch;
    renderApp(<PlanPage />, { fetchImpl, route: '/plan/plan-1', path: '/plan/:plan_id' });
    const panel = await screen.findByRole('region', { name: 'Timetable for 2026–27 Semester I' });
    expect(panel).toHaveTextContent('The timetable for 2026–27 Semester I could not be loaded, so clashes could not be checked.');
    expect(panel).not.toHaveTextContent(/INTERNAL_FAILURE|Something went wrong/);
    failing = false;
    await userEvent.click(within(panel).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Timetable for 2026–27 Semester I' })).not.toBeInTheDocument()); // loaded, nothing to say
  });
});
