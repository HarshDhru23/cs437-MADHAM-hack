/**
 * "Generate plan" (CP-35, D-36 to D-40). The generated draft is `examples/plan-generation.json`, the shared contract example, not a
 * hand-written look-alike. The draft is editable; the server checks it after every change (POST /plans/check) and only
 * "Save as my plan" posts. Nothing a student reads may carry decision numbers, issue codes, rule names or timetable-snapshot talk.
 * The panel shows every problem next to its semester, how many more credits each semester can take, how many credits are left for
 * graduation and what each requirement still needs; generating never hangs (older requests are cancelled, a slow one can be retried).
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import generationExample from '../../../../examples/plan-generation.json';
import { createMockFetch } from '../../api/mock/mockServer';
import type { AcademicPlan, AcademicRecord, CatalogueCourse, PlanCheck, PlanCheckRequirement, PlanValidation } from '../../api/types';
import { curriculum, plan, record } from '../../test/fixtures';
import { fakeApi, issue, renderApp } from '../../test/harness';
import { PlanIndexPage, PlanPage } from './PlanPage';
import { REQUEST_TIMEOUT_MS, timeouts } from './usePlanCheck';

const generation = generationExample.data;
const emptyValidation = { workload: {}, per_course: [], issues: [], meeting_check_status: 'not_checked', completion_term: null } as PlanValidation;

const row = (id: string, label: string, group: string, required: string, counted: string, uncovered: string, held = '0'): PlanCheckRequirement => ({
  id,
  label,
  group,
  required_credits: required,
  counted_credits: counted,
  remaining_credits: String(Number(required) - Number(counted)),
  held_credits: held,
  uncovered_credits: uncovered,
});

const defaultRequirements = [
  row('toc', 'Theory of Computing', 'CSE core', '4', '4', '0'),
  row('open-electives', 'Open electives', 'Open electives', '16', '4', '12'),
];

const withStatus = (check: Omit<PlanCheck, 'status'>): PlanCheck => ({
  ...check,
  status: {
    valid: check.validation.issues.every((i) => i.severity !== 'error') && Number(check.uncovered_credits) <= 0,
    problems: check.validation.issues.filter((i) => i.severity === 'error').length,
    uncovered_credits: check.uncovered_credits,
  },
});

const checkResult = (change: Partial<PlanCheck> = {}): PlanCheck =>
  withStatus({
  validation: emptyValidation,
  degree: { total_credits: '170', counted_credits: '100', remaining_credits: '70' },
  placeholder_credits: '4',
  uncovered_credits: '66',
  requirements: defaultRequirements,
  online: { planned_credits: '0', counted_credits: '0' },
  load: {
    '2026-27-I': { planned_credits: '8', limit_credits: '28', available_credits: '20' },
    '2027-28-I': { planned_credits: '8', limit_credits: '28', available_credits: '20' },
  },
  ...change,
  });

type Reply = { status?: number; data?: unknown; issues?: unknown[] };
type Req = { body: unknown };
interface Opts {
  plans?: AcademicPlan[];
  record?: AcademicRecord;
  generate?: (req: Req, n: number) => Reply | Promise<Reply>;
  check?: (req: Req, n: number) => Reply | Promise<Reply>;
  /** Catalogue courses, and the codes the 2027-28 Semester I timetable offers (for the course picker). */
  catalogue?: CatalogueCourse[];
  offered?: string[];
}

function server(opts: Opts = {}) {
  const plans = opts.plans ?? [];
  let checks = 0;
  let generates = 0;
  const api = fakeApi({
    'GET /record': () => ({ data: opts.record ?? record }),
    'GET /curricula/cse-2024': () => ({ data: curriculum }),
    'GET /catalogue': () => ({ data: { courses: opts.catalogue ?? [], coverage: 'partial', review_status: 'reviewed' }, issues: [] }),
    'GET /offerings?term_id=2027-28-I': () => ({
      data: { id: 'snap', term_id: '2027-28-I', coverage: 'complete', review_status: 'reviewed', offerings: (opts.offered ?? []).map((code) => ({ id: `2027-28-I:${code}`, code, meeting_groups: [] })) },
    }),
    'GET /plans': () => ({ data: plans }),
    'GET /plans/:id': () => ({ data: plan }),
    'POST /plans/:id/validate': () => ({ data: emptyValidation }),
    'POST /plans/generate': (req) => opts.generate?.(req, (generates += 1)) ?? { data: generation, issues: generationExample.issues },
    'POST /plans/check': (req) => opts.check?.(req, (checks += 1)) ?? { data: checkResult() },
    'POST /plans': (req) => ({ status: 201, data: { id: 'saved-plan-1', revision: 0, label: (req.body as { label: string }).label, semesters: (req.body as { semesters: unknown }).semesters, validation: emptyValidation } }),
  });
  const count = (method: string, path: string) => api.calls.filter((c) => c.method === method && c.path === path);
  return { ...api, count };
}

/** A fetch that, like the browser's, rejects when the request's signal aborts. */
function honoringAbort(base: typeof fetch): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) =>
    new Promise((resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      base(input, init).then(resolve, reject);
    })) as typeof fetch;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const never = () => new Promise<Reply>(() => undefined);

const renderIndex = (s: ReturnType<typeof server>, fetchImpl: typeof fetch = s.fetchImpl) => renderApp(<PlanIndexPage />, { fetchImpl, route: '/plan', path: '/plan' });

async function generate(s: ReturnType<typeof server>, fetchImpl?: typeof fetch) {
  renderIndex(s, fetchImpl);
  await userEvent.click(await screen.findByRole('button', { name: 'Generate plan' }));
  return screen.findByRole('region', { name: 'Draft plan (not saved)' });
}

/** The draft's first check has been answered: the progress block and Save are ready. */
const settled = (draft: HTMLElement) => waitFor(() => expect(within(draft).getByRole('button', { name: 'Save as my plan' })).toBeEnabled(), { timeout: 3000 });

const semesterCard = (draft: HTMLElement, name: RegExp) => within(draft).getByRole('region', { name });

afterEach(() => {
  timeouts.request = REQUEST_TIMEOUT_MS;
});

describe('Generate plan entry points', () => {
  it('is the only way to start a plan on the empty Plan page: no empty "My plan" to create', async () => {
    renderIndex(server());
    const generateButton = await screen.findByRole('button', { name: 'Generate plan' });
    expect(screen.queryByRole('button', { name: /Create (a|another) plan/ })).not.toBeInTheDocument();
    expect(generateButton).toHaveClass('btn-primary');
  });

  it('is also there when plans exist, and on the planner for an open plan', async () => {
    const withPlans = server({ plans: [structuredClone(plan)] });
    const first = renderIndex(withPlans);
    expect(await screen.findByRole('button', { name: 'Generate plan' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create another plan' })).not.toBeInTheDocument();
    first.unmount();
    const s = server();
    renderApp(<PlanPage />, { fetchImpl: s.fetchImpl, route: `/plan/${plan.id}`, path: '/plan/:plan_id' });
    expect(await screen.findByRole('button', { name: 'Generate plan' })).toBeInTheDocument();
  });

  it('with no record at all, Generate is off and a plain pointer says to add the record first', async () => {
    const s = server({ record: { ...record, attempts: [], current_enrolment: [] } });
    renderIndex(s);
    expect(await screen.findByRole('button', { name: 'Generate plan' })).toBeDisabled();
    expect(screen.getByText(/Add your record first/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add my record' })).toHaveAttribute('href', '/record/import');
    expect(s.count('POST', '/plans/generate')).toHaveLength(0);
  });
});

describe('Generating', () => {
  it('one click asks the server with only the record revision: no dialog, no skip-term input', async () => {
    const s = server();
    const draft = await generate(s);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText(/Terms to skip/)).not.toBeInTheDocument();
    expect(draft).toBeInTheDocument();
    const calls = s.count('POST', '/plans/generate');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual({ record_revision: record.revision });
  });

  it('checks the generated plan right away, with exactly the generated semesters', async () => {
    const s = server();
    await generate(s);
    await waitFor(() => expect(s.count('POST', '/plans/check')).toHaveLength(1));
    expect(s.count('POST', '/plans/check')[0]!.body).toEqual({ record_revision: record.revision, semesters: generation.semesters });
  });

  it('a stale record (409) says so, offers a reload, and is never retried silently', async () => {
    const s = server({ generate: () => ({ status: 409, data: { current_revision: record.revision + 3, action: 'reload_compare' }, issues: [issue('REVISION_CONFLICT', 'error', [], 'Reload and compare the newer saved revision.')] }) });
    renderIndex(s);
    await userEvent.click(await screen.findByRole('button', { name: 'Generate plan' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/record was saved elsewhere/i);
    expect(s.count('POST', '/plans/generate')).toHaveLength(1);
    await userEvent.click(within(alert).getByRole('button', { name: 'Reload my record' }));
    await waitFor(() => expect(s.count('GET', '/record').length).toBeGreaterThan(1));
    expect(s.count('POST', '/plans/generate')).toHaveLength(1); // reloading is not resubmitting
    expect(screen.queryByRole('region', { name: 'Draft plan (not saved)' })).not.toBeInTheDocument();
  });

  it('a server error shows its message and no draft', async () => {
    const s = server({ generate: () => ({ status: 400, issues: [issue('INVALID_INPUT', 'error', [], 'Invalid request fields; review the documented schema.')] }) });
    renderIndex(s);
    await userEvent.click(await screen.findByRole('button', { name: 'Generate plan' }));
    expect(await screen.findByText(/Invalid request fields/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Draft plan (not saved)' })).not.toBeInTheDocument();
  });
});

describe('Generating never hangs', () => {
  it('a request that never answers is cut off with a plain message and a Try again that works', async () => {
    timeouts.request = 150;
    const s = server({ generate: (_req, n) => (n === 1 ? never() : { data: generation }) });
    const fetchImpl = honoringAbort(s.fetchImpl);
    renderIndex(s, fetchImpl);
    const button = await screen.findByRole('button', { name: 'Generate plan' });
    await userEvent.click(button);
    expect(await screen.findByText('Building your plan…')).toBeInTheDocument();
    const alert = await screen.findByRole('alert', undefined, { timeout: 2000 });
    expect(alert).toHaveTextContent('This is taking too long.');
    expect(screen.queryByText('Building your plan…')).not.toBeInTheDocument(); // not pending any more
    expect(button).toBeEnabled();
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('region', { name: 'Draft plan (not saved)' })).toBeInTheDocument();
    expect(s.count('POST', '/plans/generate')).toHaveLength(2);
    expect(screen.queryByText(/taking too long/)).not.toBeInTheDocument();
  });

  it('a network failure shows an error, leaves every control usable and a second click works', async () => {
    const s = server();
    let calls = 0;
    const flaky = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/plans/generate') && (calls += 1) === 1) return Promise.reject(new TypeError('Failed to fetch'));
      return s.fetchImpl(input, init);
    }) as typeof fetch;
    renderIndex(s, flaky);
    const button = await screen.findByRole('button', { name: 'Generate plan' });
    await userEvent.click(button);
    expect((await screen.findAllByText(/could not be reached/i)).length).toBeGreaterThan(0);
    expect(button).toBeEnabled();
    expect(screen.queryByText('Building your plan…')).not.toBeInTheDocument();
    await userEvent.click(button);
    expect(await screen.findByRole('region', { name: 'Draft plan (not saved)' })).toBeInTheDocument();
    expect(screen.queryByText(/could not be reached/i)).not.toBeInTheDocument();
  });

  it('switching the internship semester again while one request is pending: only the newest answer is shown', async () => {
    const early = { ...generation, graduation: { internship_term: '2027-28-I', early: true, last_term: '2027-28-I', usual_last_term: '2027-28-I', message: 'You can graduate after the slow request.' } };
    const fast = { ...generation, graduation: { internship_term: null, early: true, last_term: '2027-28-I', usual_last_term: '2027-28-I', message: 'You can graduate after the newest request.' } };
    const s = server({
      generate: async (_req, n) => {
        if (n === 2) {
          await sleep(1000);
          return { data: early }; // the slow answer to the first choice
        }
        return { data: n === 1 ? generation : fast };
      },
    });
    const draft = await generate(s, honoringAbort(s.fetchImpl));
    const select = within(draft).getByLabelText('Internship semester');
    await userEvent.selectOptions(select, '2027-28-I'); // request 2: slow
    await userEvent.selectOptions(within(screen.getByRole('region', { name: 'Draft plan (not saved)' })).getByLabelText('Internship semester'), ''); // request 3: fast
    expect(await screen.findByText('You can graduate after the newest request.')).toBeInTheDocument();
    await act(() => sleep(1200)); // the slow answer would have arrived by now
    expect(screen.queryByText('You can graduate after the slow request.')).not.toBeInTheDocument();
    expect(screen.getByText('You can graduate after the newest request.')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Draft plan (not saved)' })).getByLabelText('Internship semester')).toHaveValue('');
  });

  it('the selects stay usable while a regeneration is pending, and a failed regeneration keeps the draft and the old choice', async () => {
    const s = server({ generate: (_req, n) => (n === 2 ? { status: 400, issues: [issue('INVALID_INPUT', 'error', [], 'Invalid request fields.')] } : { data: generation }) });
    const draft = await generate(s);
    const select = within(draft).getByLabelText('Internship semester');
    await userEvent.selectOptions(select, '2027-28-I');
    expect(await screen.findByText(/Invalid request fields/)).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Draft plan (not saved)' })).getByText('ZZ 201')).toBeInTheDocument(); // the draft is still there
    expect(select).toBeEnabled();
    expect(select).toHaveValue(''); // back to what the draft on screen was built with
    await userEvent.selectOptions(select, '2027-28-I'); // and it can be tried again
    await waitFor(() => expect(s.count('POST', '/plans/generate')).toHaveLength(3));
    await waitFor(() => expect(screen.queryByText(/Invalid request fields/)).not.toBeInTheDocument());
  });

  it('Discard while a regeneration is pending drops it: the late answer does not bring a draft back', async () => {
    const s = server({ generate: async (_req, n) => (n === 2 ? (await sleep(500), { data: generation }) : { data: generation }) });
    const draft = await generate(s, honoringAbort(s.fetchImpl));
    await userEvent.selectOptions(within(draft).getByLabelText('Internship semester'), '2027-28-I');
    await userEvent.click(within(screen.getByRole('region', { name: 'Draft plan (not saved)' })).getByRole('button', { name: 'Discard' }));
    await act(() => sleep(800));
    expect(screen.queryByRole('region', { name: 'Draft plan (not saved)' })).not.toBeInTheDocument();
    expect(screen.queryByText('Building your plan…')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Generate plan' })); // and a new one can start
    expect(await screen.findByRole('region', { name: 'Draft plan (not saved)' })).toBeInTheDocument();
  });

  it('clicking Generate plan twice in a row ends with one draft from the second request', async () => {
    const s = server({ generate: async (_req, n) => (n === 1 ? (await sleep(300), { data: generation }) : { data: generation }) });
    renderIndex(s, honoringAbort(s.fetchImpl));
    const button = await screen.findByRole('button', { name: 'Generate plan' });
    await userEvent.click(button);
    await userEvent.click(button);
    expect(await screen.findByRole('region', { name: 'Draft plan (not saved)' })).toBeInTheDocument();
    await act(() => sleep(500));
    expect(screen.getAllByRole('region', { name: 'Draft plan (not saved)' })).toHaveLength(1);
    expect(screen.queryByText('Building your plan…')).not.toBeInTheDocument();
  });
});

describe('Internship semester, load and early graduation', () => {
  it('offers "No internship" plus the planned semesters, and choosing one asks the server again with internship_term', async () => {
    const s = server();
    const draft = await generate(s);
    const select = within(draft).getByLabelText('Internship semester');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['No internship', '2026–27 Semester I', '2027–28 Semester I']);
    await userEvent.selectOptions(select, '2027-28-I');
    await waitFor(() => expect(s.count('POST', '/plans/generate')).toHaveLength(2));
    expect(s.count('POST', '/plans/generate')[1]!.body).toEqual({ record_revision: record.revision, options: { internship_term: '2027-28-I' } });
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Draft plan (not saved)' })).getByLabelText('Internship semester')).toHaveValue('2027-28-I'));
    // Choosing "No internship" again goes back to the plain request.
    await userEvent.selectOptions(within(screen.getByRole('region', { name: 'Draft plan (not saved)' })).getByLabelText('Internship semester'), '');
    await waitFor(() => expect(s.count('POST', '/plans/generate')).toHaveLength(3));
    expect(s.count('POST', '/plans/generate')[2]!.body).toEqual({ record_revision: record.revision });
  });

  it('"Credits per semester" defaults to as many as possible (nothing sent) and "Lighter" sends a target of 20, alone or with an internship', async () => {
    const s = server();
    const draft = await generate(s);
    const load = within(draft).getByLabelText('Credits per semester');
    expect(load).toHaveValue('most');
    expect(within(load).getAllByRole('option').map((o) => o.textContent)).toEqual(['As many as possible (up to 28)', 'Lighter (about 20)']);
    await userEvent.selectOptions(load, 'lighter');
    await waitFor(() => expect(s.count('POST', '/plans/generate')).toHaveLength(2));
    expect(s.count('POST', '/plans/generate')[1]!.body).toEqual({ record_revision: record.revision, options: { target_credits_per_term: '20' } });
    await userEvent.selectOptions(within(screen.getByRole('region', { name: 'Draft plan (not saved)' })).getByLabelText('Internship semester'), '2027-28-I');
    await waitFor(() => expect(s.count('POST', '/plans/generate')).toHaveLength(3));
    expect(s.count('POST', '/plans/generate')[2]!.body).toEqual({ record_revision: record.revision, options: { internship_term: '2027-28-I', target_credits_per_term: '20' } });
  });

  it('shows the graduation message prominently when it is set, and nothing when the server sends none', async () => {
    const early = { ...generation, graduation: { internship_term: '2027-28-I', early: true, last_term: '2027-28-I', usual_last_term: '2027-28-II', message: 'You can graduate after 2027-28-I, 1 semester before the usual 2027-28-II.' } };
    const s = server({ generate: (req) => ({ data: (req.body as { options?: unknown }).options ? early : generation }) });
    const draft = await generate(s);
    expect(within(draft).queryByRole('status')).not.toBeInTheDocument();
    await userEvent.selectOptions(within(draft).getByLabelText('Internship semester'), '2027-28-I');
    const banner = await screen.findByText(/You can graduate after 2027-28-I, 1 semester before the usual/);
    expect(banner.closest('[data-tone="success"]')).not.toBeNull();
  });

  it('says plainly which requirements could not be placed when the plan is not complete', async () => {
    const incomplete = {
      ...generation,
      summary: { ...generation.summary, complete: false },
      unmet: [{ requirement_id: 'theory', label: 'Theory & Algorithms basket', remaining_credits: '4', remaining_courses: 0, reason_code: 'NO_CAPACITY', reason: 'Offered courses exist, but none fits.', placeholder_ids: [] }],
    };
    const draft = await generate(server({ generate: () => ({ data: incomplete }) }));
    expect(within(draft).getByText(/Some requirements could not be placed: Theory & Algorithms basket/)).toBeInTheDocument();
    expect(draft).not.toHaveTextContent('Offered courses exist, but none fits.');
    expect(draft).not.toHaveTextContent('NO_CAPACITY');
  });
});

describe('The draft', () => {
  it('lists each course with its title, credits and what it counts toward, and shows credits you arrange yourself as such', async () => {
    const draft = await generate(server());
    const first = semesterCard(draft, /2026–27 Semester I/);
    const row = within(first).getByText('ZZ 201').closest('tr') as HTMLElement;
    expect(within(row).getByText('Synthetic core course')).toBeInTheDocument();
    expect(within(row).getByText('4')).toBeInTheDocument();
    expect(within(row).getByText('CSE core')).toBeInTheDocument();
    const later = semesterCard(draft, /2027–28 Semester I/);
    const project = within(later).getByRole('rowheader', { name: 'Open project' }).closest('tr') as HTMLElement;
    expect(within(project).getByText('4')).toBeInTheDocument();
    expect(within(project).getByText('Arrange it yourself')).toBeInTheDocument();
  });

  it('shows elective credits, internship modules and online courses as rows with plain names, and explains the 4-credit modules once', async () => {
    const arranged = structuredClone(generation);
    arranged.semesters[1]!.placeholders = [
      { id: 'gen-internship-1', requirement_id: 'hss-other', desired_credits: '4', label: 'Internship module (IN 498)' },
      { id: 'gen-online-1', requirement_id: 'open-electives', desired_credits: '4', label: 'Online course' },
      { id: 'gen-flex-2027-28-I-hss-other', requirement_id: 'hss-other', desired_credits: '8', label: 'HSS elective' },
    ];
    const draft = await generate(server({ generate: () => ({ data: arranged }) }));
    const later = semesterCard(draft, /2027–28 Semester I/);
    expect(within(later).getByText('Internship module')).toBeInTheDocument();
    expect(within(later).getByText('Online course')).toBeInTheDocument();
    const elective = within(later).getByText('HSS elective').closest('tr') as HTMLElement;
    expect(within(elective).getByText('8')).toBeInTheDocument();
    expect(within(elective).getByText('Choose any course that counts')).toBeInTheDocument();
    expect(within(later).getByText(/Internship credits come in 4-credit modules, 16 at most/)).toBeInTheDocument();
    expect(later).not.toHaveTextContent('IN 498');
    expect(later).not.toHaveTextContent('not in a timetable');
    expect(within(draft).getAllByText(/Internship credits come in 4-credit modules/)).toHaveLength(1);
  });

  it('a semester with nothing planned stays listed, with its Add buttons', async () => {
    const draft = await generate(server());
    await settled(draft);
    await userEvent.click(within(draft).getByRole('button', { name: 'Remove ZZ 201B from 2027–28 Semester I' }));
    await userEvent.click(within(draft).getByRole('button', { name: 'Remove Open project from 2027–28 Semester I' }));
    const later = semesterCard(draft, /2027–28 Semester I/);
    expect(within(later).getByText('Nothing planned in this semester.')).toBeInTheDocument();
    expect(within(later).getByRole('button', { name: 'Add course to 2027–28 Semester I' })).toBeInTheDocument();
    expect(within(later).getByRole('button', { name: 'Add elective credits to 2027–28 Semester I' })).toBeInTheDocument();
  });

  it('a semester that was left out of the plan can be added back, empty, and then filled', async () => {
    const wide = { ...generation, options: { ...generation.options, terms: ['2026-27-I', '2027-28-I', '2027-28-II'] } };
    const draft = await generate(server({ generate: () => ({ data: wide }) }));
    const choose = within(draft).getByLabelText('Add a semester');
    expect(within(choose).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose a semester', '2027–28 Semester II']);
    await userEvent.selectOptions(choose, '2027-28-II');
    const added = semesterCard(draft, /2027–28 Semester II/);
    expect(within(added).getByText('Nothing planned in this semester.')).toBeInTheDocument();
    expect(within(added).getByText('Semester total: 0 / 28 credits')).toBeInTheDocument();
    expect(within(added).getByText(/28 more credits can be added/)).toBeInTheDocument();
    expect(within(draft).queryByLabelText('Add a semester')).not.toBeInTheDocument(); // nothing left to add
  });

  it('carries no developer text: no decision numbers, issue codes, rule talk, assumptions, notice, or timetable-snapshot wording', async () => {
    const s = server({
      check: () => ({
        data: checkResult({
          validation: {
            ...emptyValidation,
            issues: [
              issue('STANDING_ASSUMED', 'info', ['2026-27-I'], 'Assuming regular standing (28-credit cap) until you set your standing and any advisor cap in your profile.'),
              issue('OFFERING_UNKNOWN', 'unknown', [], 'No 2027-28-I timetable snapshot is published yet (D-33).'),
              issue('PREREQUISITE_MISSING', 'warning', ['gen-2026-27-I-ZZ201'], 'Recommended preparation (CoursePath team) missing: ZZ 101'),
              issue('PREREQUISITE_CONDITIONAL', 'warning', ['gen-2026-27-I-ZZ310'], 'Recommended preparation (CoursePath team) is planned earlier; it helps only if passed.'),
              issue('SOMETHING_ELSE', 'warning', [], 'Check this (D-12) NO_REVIEWED_ALLOCATION now.'),
            ],
          },
        }),
      }),
    });
    const draft = await generate(s);
    await within(draft).findByText('ZZ 201 is best taken after ZZ 101.');
    await within(draft).findByText('ZZ 310 needs a course that is planned earlier. That only helps if you pass it.');
    const text = draft.textContent ?? '';
    expect(text).not.toMatch(/D-\d\d/);
    expect(text).not.toMatch(/\b[A-Z]{2,}(?:_[A-Z]+)+\b/);
    expect(text).not.toMatch(/standing|snapshot|assum|advisor|guidance|CoursePath team|Recommended preparation/i);
    expect(text).not.toContain(generation.notice);
    for (const a of generation.assumptions) expect(text).not.toContain(a);
    expect(within(draft).queryByRole('region', { name: 'Assumptions' })).not.toBeInTheDocument();
  });
});

describe('Every change is checked and the answer is shown at once', () => {
  it('a summer break holds online courses, is limited to 10 credits and says so in its own words', async () => {
    const withSummer = structuredClone(generation);
    withSummer.semesters = [
      ...withSummer.semesters,
      { term_id: '2027-28-SUMMER', courses: [], placeholders: [{ id: 'gen-online-2027-28-SUMMER-open-electives', requirement_id: 'open-electives', desired_credits: '12', label: 'Online course' }] },
    ];
    withSummer.graduation = { ...withSummer.graduation, early: true, last_term: '2027-28-SUMMER', online_credits: '12', message: 'You can graduate after 2027–28 Summer, 1 semester before the usual 2028–29 Semester II. This uses 12 credits of online courses taken in the breaks.' } as unknown as typeof withSummer.graduation;
    const s = server({
      generate: () => ({ data: withSummer }),
      check: () => ({ data: checkResult({ load: { '2027-28-SUMMER': { planned_credits: '12', limit_credits: '10', available_credits: '0' } }, validation: { ...emptyValidation, issues: [{ code: 'LOAD_LIMIT', severity: 'error', message: 'Target workload exceeds the 10-credit limit.', entity_refs: ['2027-28-SUMMER'], source_refs: [], suggested_action: '' }] } as PlanValidation }) }),
    });
    const draft = await generate(s);
    const summer = semesterCard(draft, /2027–28 Summer/);
    expect(within(summer).getByText('Online course')).toBeInTheDocument();
    await waitFor(() => expect(within(summer).getByText('Summer total: 12 / 10 credits')).toBeInTheDocument());
    expect(within(summer).getByText(/Over the 10-credit limit/)).toBeInTheDocument();
    expect(within(summer).getByText('This semester is over the 10-credit limit.')).toBeInTheDocument();
    expect(within(draft).getByText(/This uses 12 credits of online courses taken in the breaks/)).toBeInTheDocument();
    expect(within(draft).getByRole('button', { name: 'Save as my plan' })).toBeEnabled();   // an over-limit summer makes the plan not valid, and it can still be saved
    expect(within(draft).getByTestId('plan-validity')).toHaveTextContent('Not a valid plan yet');
  });

  it('shows each semester total out of 28 and how many more credits it can take, from the server, never a browser-side sum', async () => {
    const s = server({ check: () => ({ data: checkResult({ load: { '2026-27-I': { planned_credits: '9', limit_credits: '28', available_credits: '19' }, '2027-28-I': { planned_credits: '28', limit_credits: '28', available_credits: '0' } } }) }) });
    const draft = await generate(s);
    await waitFor(() => expect(within(semesterCard(draft, /2026–27 Semester I/)).getByText('Semester total: 9 / 28 credits')).toBeInTheDocument());
    expect(within(semesterCard(draft, /2026–27 Semester I/)).getByText(/19 more credits can be added/)).toBeInTheDocument();
    expect(within(semesterCard(draft, /2027–28 Semester I/)).getByText('Semester total: 28 / 28 credits')).toBeInTheDocument();
    expect(within(semesterCard(draft, /2027–28 Semester I/)).getByText(/no more credits can be added/)).toBeInTheDocument();
    expect(draft).not.toHaveTextContent(/Expected \(unconfirmed\)|Confirmed in|Your choice|Evidence/);
  });

  it('after a removal the new numbers replace the old ones, and the old ones stay (marked as updating) until then', async () => {
    const gate = { release: () => undefined as void };
    const s = server({
      check: async (_req, n) => {
        if (n === 1) return { data: checkResult() };
        await new Promise<void>((resolve) => (gate.release = resolve)); // the answer to the removal is held back
        return { data: checkResult({ uncovered_credits: '70', load: { '2026-27-I': { planned_credits: '4', limit_credits: '28', available_credits: '24' }, '2027-28-I': { planned_credits: '8', limit_credits: '28', available_credits: '20' } } }) };
      },
    });
    const draft = await generate(s);
    await within(draft).findByText('66 credits left for graduation');
    await userEvent.click(within(draft).getByRole('button', { name: 'Remove ZZ 310 from 2026–27 Semester I' }));
    await waitFor(() => expect(within(draft).getByRole('region', { name: 'Your plan so far' })).toHaveAttribute('data-updating', 'true'), { timeout: 3000 });
    expect(within(draft).getByText('66 credits left for graduation')).toBeInTheDocument(); // still the last answer, not blank
    expect(within(draft).getByText('Updating…')).toBeInTheDocument();
    expect(within(draft).getByRole('button', { name: 'Save as my plan' })).toBeDisabled(); // not while a check is pending
    await waitFor(() => expect(s.count('POST', '/plans/check')).toHaveLength(2), { timeout: 3000 });
    await act(async () => gate.release());
    await within(draft).findByText('70 credits left for graduation');
    expect(within(semesterCard(draft, /2026–27 Semester I/)).getByText(/24 more credits can be added/)).toBeInTheDocument();
    expect(within(draft).queryByText('Updating…')).not.toBeInTheDocument();
  });

  it('shows the credits left for graduation, how many are counted, and what each requirement still needs', async () => {
    const s = server({
      check: () => ({
        data: checkResult({
          requirements: [
            row('toc', 'Theory of Computing', 'CSE core', '4', '4', '0'),
            row('hss-other', 'HSS electives', 'Humanities and Social Sciences (GE included)', '8', '0', '8'),
            row('economics', 'Economics', 'Humanities and Social Sciences (GE included)', '4', '4', '0'),
            row('open-electives', 'Open electives', 'Open electives', '16', '4', '12'),
          ],
        }),
      }),
    });
    const draft = await generate(s);
    const progress = await within(draft).findByRole('region', { name: 'Your plan so far' });
    expect(within(progress).getByText('66 credits left for graduation')).toBeInTheDocument();
    expect(within(progress).getByText('100 of 170 degree credits covered by your plan')).toBeInTheDocument();
    expect(within(progress).getByText('4 credits held in placeholders that you fill with courses')).toBeInTheDocument();
    expect(within(progress).getByText('Open electives: 12 more credits needed')).toBeInTheDocument();
    expect(within(progress).getByText('Humanities and Social Sciences (GE included)')).toBeInTheDocument();
    expect(within(progress).getByText('HSS electives: 8 more credits needed')).toBeInTheDocument();
    expect(within(progress).queryByText(/Theory of Computing/)).not.toBeInTheDocument(); // covered rows are not listed one by one
    expect(within(progress).getByText('Everything else is covered.')).toBeInTheDocument();
  });

  it('says every requirement is covered when nothing is left', async () => {
    const s = server({ check: () => ({ data: checkResult({ uncovered_credits: '0', requirements: [row('toc', 'Theory of Computing', 'CSE core', '4', '4', '0')] }) }) });
    const draft = await generate(s);
    expect(await within(draft).findByText('Every requirement is covered.')).toBeInTheDocument();
    expect(within(draft).queryByText(/^\d+ credits? left for graduation/)).not.toBeInTheDocument();
    expect(within(draft).queryByText('Everything else is covered.')).not.toBeInTheDocument();
  });

  it('removing a course sends the plan without it to the server check', async () => {
    const s = server();
    const draft = await generate(s);
    await settled(draft);
    await userEvent.click(within(draft).getByRole('button', { name: 'Remove ZZ 310 from 2026–27 Semester I' }));
    expect(within(semesterCard(draft, /2026–27 Semester I/)).queryByText('ZZ 310')).not.toBeInTheDocument();
    await waitFor(() => expect(s.count('POST', '/plans/check')).toHaveLength(2), { timeout: 3000 });
    const sent = s.count('POST', '/plans/check')[1]!.body as { record_revision: number; semesters: { term_id: string; courses: { normalized_code: string }[] }[] };
    expect(sent.record_revision).toBe(record.revision);
    expect(sent.semesters.find((x) => x.term_id === '2026-27-I')!.courses.map((c) => c.normalized_code)).toEqual(['ZZ 201']);
    expect(s.count('POST', '/plans')).toHaveLength(0); // editing saves nothing
  });

  it('removing a placeholder works the same way', async () => {
    const s = server();
    const draft = await generate(s);
    await settled(draft);
    await userEvent.click(within(draft).getByRole('button', { name: 'Remove Open project from 2027–28 Semester I' }));
    await waitFor(() => expect(s.count('POST', '/plans/check')).toHaveLength(2), { timeout: 3000 });
    const sent = s.count('POST', '/plans/check')[1]!.body as { semesters: { term_id: string; placeholders: unknown[] }[] };
    expect(sent.semesters.find((x) => x.term_id === '2027-28-I')!.placeholders).toEqual([]);
  });

  it('removing every course of a semester sends the check without that semester, and it stays on screen', async () => {
    const s = server();
    const draft = await generate(s);
    await settled(draft);
    await userEvent.click(within(draft).getByRole('button', { name: 'Remove ZZ 201 from 2026–27 Semester I' }));
    await userEvent.click(within(draft).getByRole('button', { name: 'Remove ZZ 310 from 2026–27 Semester I' }));
    await waitFor(() => expect(s.count('POST', '/plans/check').length).toBeGreaterThanOrEqual(2), { timeout: 3000 });
    await waitFor(() => {
      const sent = s.count('POST', '/plans/check').at(-1)!.body as { semesters: { term_id: string }[] };
      expect(sent.semesters.map((x) => x.term_id)).toEqual(['2027-28-I']);
    }, { timeout: 3000 });
    expect(within(semesterCard(draft, /2026–27 Semester I/)).getByText('Nothing planned in this semester.')).toBeInTheDocument();
    expect(within(semesterCard(draft, /2026–27 Semester I/)).getByText(/28 more credits can be added/)).toBeInTheDocument();
  });

  it('adding a course through the picker sends it to the server check in that semester', async () => {
    const s = server();
    const draft = await generate(s);
    await settled(draft);
    await userEvent.click(within(draft).getByRole('button', { name: 'Add course to 2027–28 Semester I' }));
    const dialog = await screen.findByRole('dialog', { name: /Add course to 2027–28 Semester I/ });
    await userEvent.type(within(dialog).getByLabelText('Course code'), 'ZZ 421');
    await userEvent.type(within(dialog).getByLabelText(/Credits/), '4');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add course' }));
    expect(within(semesterCard(draft, /2027–28 Semester I/)).getByText('ZZ 421')).toBeInTheDocument();
    await waitFor(() => expect(s.count('POST', '/plans/check')).toHaveLength(2), { timeout: 3000 });
    const sent = s.count('POST', '/plans/check')[1]!.body as { semesters: { term_id: string; courses: { id: string; normalized_code: string; credits: string }[] }[] };
    expect(sent.semesters.find((x) => x.term_id === '2027-28-I')!.courses).toContainEqual(expect.objectContaining({ id: 'user-2027-28-I-ZZ421', normalized_code: 'ZZ 421', credits: '4' }));
  });

  it('"Add course" lists the Systems basket courses offered in that semester, and adding one sends it to the check', async () => {
    const systems = (code: string, title: string): CatalogueCourse => ({ id: `v1:${code}`, normalized_code: code, title, credits: '4', department: 'ZZ', baskets: ['systems'], could_satisfy: ['Systems basket'] });
    const s = server({ catalogue: [systems('ZZ 327', 'Synthetic Distributed Systems'), systems('ZZ 332', 'Synthetic Compilers')], offered: ['ZZ 327'] }); // ZZ 332 is not offered in 2027-28 Semester I
    const draft = await generate(s);
    await settled(draft);
    await userEvent.click(within(draft).getByRole('button', { name: 'Add course to 2027–28 Semester I' }));
    const dialog = await screen.findByRole('dialog', { name: /Add course to 2027–28 Semester I/ });
    await userEvent.selectOptions(await within(dialog).findByLabelText('Requirement'), 'Systems basket');
    const results = within(dialog).getByRole('list', { name: 'Matching courses' });
    expect(within(results).getByText('ZZ 327')).toBeInTheDocument();
    expect(within(results).queryByText('ZZ 332')).not.toBeInTheDocument();
    await userEvent.click(within(results).getByRole('button', { name: 'Add ZZ 327' }));
    await waitFor(() => expect(s.count('POST', '/plans/check').length).toBeGreaterThanOrEqual(2), { timeout: 3000 });
    const sent = s.count('POST', '/plans/check').at(-1)!.body as { semesters: { term_id: string; courses: { normalized_code: string }[] }[] };
    expect(sent.semesters.find((x) => x.term_id === '2027-28-I')!.courses.map((c) => c.normalized_code)).toContain('ZZ 327');
  });

  it('adding the same course twice gives it its own id, and the problem the server reports is shown next to the semester', async () => {
    const s = server({
      check: (req) => {
        const sent = (req.body as { semesters: { courses: { id: string; normalized_code: string }[] }[] }).semesters.flatMap((x) => x.courses);
        const twin = sent.filter((c) => c.normalized_code === 'ZZ 201');
        return { data: checkResult(twin.length > 1 ? { validation: { ...emptyValidation, issues: [issue('DUPLICATE_COURSE', 'warning', twin.map((c) => c.id), 'This course is already selected in your plan.')] } } : {}) };
      },
    });
    const draft = await generate(s);
    await settled(draft);
    await userEvent.click(within(draft).getByRole('button', { name: 'Add course to 2027–28 Semester I' }));
    const dialog = await screen.findByRole('dialog', { name: /Add course to 2027–28 Semester I/ });
    await userEvent.type(within(dialog).getByLabelText('Course code'), 'ZZ 201');
    await userEvent.type(within(dialog).getByLabelText(/Credits/), '4');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add course' }));
    await userEvent.click(within(draft).getByRole('button', { name: 'Add course to 2027–28 Semester I' }));
    const again = await screen.findByRole('dialog', { name: /Add course to 2027–28 Semester I/ });
    await userEvent.type(within(again).getByLabelText('Course code'), 'ZZ 201');
    await userEvent.type(within(again).getByLabelText(/Credits/), '4');
    await userEvent.click(within(again).getByRole('button', { name: 'Add course' }));
    await waitFor(() => {
      const sent = s.count('POST', '/plans/check').at(-1)!.body as { semesters: { term_id: string; courses: { id: string }[] }[] };
      expect(sent.semesters.find((x) => x.term_id === '2027-28-I')!.courses.map((c) => c.id)).toEqual(['gen-2027-28-I-ZZ201B', 'user-2027-28-I-ZZ201', 'user-2027-28-I-ZZ201-2']);
    }, { timeout: 3000 });
    expect((await within(semesterCard(draft, /2027–28 Semester I/)).findByRole('list', { name: 'Problems in 2027–28 Semester I' }, { timeout: 3000 }))).toHaveTextContent('ZZ 201 is already in your plan or already completed.');
  });
});

describe('Problems are shown where they belong, as soon as the check answers', () => {
  it('a clash, a course that is not offered, a duplicate and an over-28 semester each appear in their semester, in plain words, with no click needed', async () => {
    const s = server({
      check: () => ({
        data: checkResult({
          validation: {
            ...emptyValidation,
            issues: [
              issue('TIMETABLE_CONFLICT', 'error', ['gen-2026-27-I-ZZ201', 'gen-2026-27-I-ZZ310', '2026-27-I:ZZ201:lecture:A1', '2026-27-I:ZZ310:lecture:A1'], 'Required meetings overlap.'),
              issue('TIMETABLE_CONFLICT', 'error', ['gen-2026-27-I-ZZ201', 'gen-2026-27-I-ZZ310', '2026-27-I:ZZ201:tutorial:A2', '2026-27-I:ZZ310:tutorial:A2'], 'Required meetings overlap.'),
              issue('OFFERING_NOT_IN_SNAPSHOT', 'warning', ['ZZ 201B'], 'ZZ 201B is not in the complete reviewed 2027-28-I snapshot.'),
              issue('LOAD_LIMIT', 'error', ['2027-28-I'], 'Target workload exceeds the 28-credit limit.'),
              issue('PLACEHOLDER_UNRESOLVED', 'unknown', ['gen-placeholder-2027-28-I-open-project'], 'Select actual courses before eligibility or completion can be established.'),
            ],
          },
          load: { '2026-27-I': { planned_credits: '8', limit_credits: '28', available_credits: '20' }, '2027-28-I': { planned_credits: '32', limit_credits: '28', available_credits: '0' } },
        }),
      }),
    });
    const draft = await generate(s);
    const first = semesterCard(draft, /2026–27 Semester I/);
    const firstList = await within(first).findByRole('list', { name: 'Problems in 2026–27 Semester I' });
    expect(within(firstList).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['ZZ 201 and ZZ 310 meet at the same time.']); // the two overlaps are one line
    const later = semesterCard(draft, /2027–28 Semester I/);
    const laterList = within(later).getByRole('list', { name: 'Problems in 2027–28 Semester I' });
    expect(within(laterList).getAllByRole('listitem').map((li) => li.textContent).sort()).toEqual(['This semester is over the 28-credit limit.', 'ZZ 201B is not offered this semester.']);
    expect(later).toHaveTextContent('Over the 28-credit limit');
    expect(later).toHaveTextContent('Semester total: 32 / 28 credits');
    expect(within(draft).queryByRole('region', { name: 'Problems with your plan' })).not.toBeInTheDocument(); // everything found its semester
    expect(draft.textContent).not.toMatch(/TIMETABLE_CONFLICT|OFFERING_NOT_IN_SNAPSHOT|LOAD_LIMIT|PLACEHOLDER_UNRESOLVED|Select actual courses/);
    expect(within(draft).getByRole('button', { name: 'Save as my plan' })).toBeEnabled(); // not valid, but it can still be saved
    expect(within(draft).getByTestId('plan-validity')).toHaveTextContent(/Not a valid plan yet: 3 problems to fix/);
  });

  it('a problem that belongs to no semester is listed under "Check these"', async () => {
    const s = server({ check: () => ({ data: checkResult({ validation: { ...emptyValidation, issues: [issue('SOME_PLAN_PROBLEM', 'warning', [], 'The plan has a problem that is about no single semester.')] } }) }) });
    const draft = await generate(s);
    const general = await within(draft).findByRole('region', { name: 'Problems with your plan' });
    expect(within(general).getByRole('heading', { name: 'Check these' })).toBeInTheDocument();
    expect(general).toHaveTextContent('The plan has a problem that is about no single semester.');
    await settled(draft); // a warning does not stop saving
  });

  it('adding a course shows its problem in that semester right away, not only a count', async () => {
    const s = server({
      check: (req) => {
        const added = (req.body as { semesters: { courses: { id: string }[] }[] }).semesters.flatMap((x) => x.courses).find((c) => c.id === 'user-2027-28-I-ZZ421');
        return { data: checkResult(added ? { validation: { ...emptyValidation, issues: [issue('OFFERING_NOT_IN_SNAPSHOT', 'warning', ['ZZ 421'], 'ZZ 421 is not in the complete reviewed 2027-28-I snapshot.')] } } : {}) };
      },
    });
    const draft = await generate(s);
    await settled(draft);
    expect(within(semesterCard(draft, /2027–28 Semester I/)).queryByRole('list', { name: /Problems in/ })).not.toBeInTheDocument();
    await userEvent.click(within(draft).getByRole('button', { name: 'Add course to 2027–28 Semester I' }));
    const dialog = await screen.findByRole('dialog', { name: /Add course to 2027–28 Semester I/ });
    await userEvent.type(within(dialog).getByLabelText('Course code'), 'ZZ 421');
    await userEvent.type(within(dialog).getByLabelText(/Credits/), '4');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add course' }));
    const list = await within(semesterCard(draft, /2027–28 Semester I/)).findByRole('list', { name: 'Problems in 2027–28 Semester I' }, { timeout: 3000 });
    expect(list).toHaveTextContent('ZZ 421 is not offered this semester.');
  });

  it('a semester that is over 28 credits is explained in plain words and the plan is marked not valid', async () => {
    const over = checkResult({
      validation: {
        ...emptyValidation,
        workload: { '2026-27-I': { selected_credits: '32', placeholder_credits: '0', target_credits: '32' } },
        issues: [issue('LOAD_LIMIT', 'error', ['2026-27-I'], 'Target workload exceeds the 28-credit limit.')],
      },
      load: { '2026-27-I': { planned_credits: '32', limit_credits: '28', available_credits: '0' } },
    });
    const s = server({ check: () => ({ data: over }) });
    const draft = await generate(s);
    await waitFor(() => expect(within(semesterCard(draft, /2026–27 Semester I/)).getByText('Over the 28-credit limit')).toBeInTheDocument());
    const card = semesterCard(draft, /2026–27 Semester I/);
    expect(card).toHaveTextContent('Semester total: 32 / 28 credits');
    expect(card).toHaveTextContent('This semester is over the 28-credit limit.');
    expect(draft).not.toHaveTextContent('LOAD_LIMIT');
    expect(within(draft).getByRole('button', { name: 'Save as my plan' })).toBeEnabled(); // not valid, but it can still be saved
    expect(within(draft).getByTestId('plan-validity')).toHaveTextContent(/Not a valid plan yet: 1 problem to fix/);
    expect(s.count('POST', '/plans')).toHaveLength(0); // nothing is saved until the student saves
  });

  it('warnings do not stop saving', async () => {
    const s = server({ check: () => ({ data: checkResult({ validation: { ...emptyValidation, issues: [issue('PREREQUISITE_MISSING', 'warning', ['gen-2026-27-I-ZZ201'], 'ZZ 201 needs ZZ 101 first.')] } }) }) });
    const draft = await generate(s);
    await within(draft).findByText('ZZ 201 needs ZZ 101 first.');
    await settled(draft);
  });
});

describe('Adding elective credits', () => {
  it('offers the requirements that still need credits with how many, defaults to 4 or what fits, and sends a placeholder to the check', async () => {
    const s = server();
    const draft = await generate(s);
    await settled(draft);
    await userEvent.click(within(draft).getByRole('button', { name: 'Add elective credits to 2027–28 Semester I' }));
    const form = within(draft).getByRole('form', { name: 'Add elective credits to 2027–28 Semester I' });
    const requirement = within(form).getByLabelText('Requirement');
    expect(within(requirement).getAllByRole('option').map((o) => o.textContent)).toEqual(['Open electives — 12 more credits needed']); // covered requirements are not offered
    expect(within(form).getByLabelText('Credits')).toHaveValue('4'); // min(4, 12 needed, 20 room)
    await userEvent.click(within(form).getByRole('button', { name: 'Add credits' }));
    const later = semesterCard(draft, /2027–28 Semester I/);
    const added = within(later).getByRole('rowheader', { name: 'Open electives' }).closest('tr') as HTMLElement;
    expect(within(added).getByText('4')).toBeInTheDocument();
    await waitFor(() => expect(s.count('POST', '/plans/check')).toHaveLength(2), { timeout: 3000 });
    const sent = s.count('POST', '/plans/check')[1]!.body as { semesters: { term_id: string; placeholders: unknown[] }[] };
    expect(sent.semesters.find((x) => x.term_id === '2027-28-I')!.placeholders).toContainEqual({ id: 'user-2027-28-I-open-electives-1', requirement_id: 'open-electives', desired_credits: '4', label: 'Open electives' });
  });

  it('the default is what the requirement still needs, or what the semester has room for, when that is less than 4', async () => {
    const s = server({
      check: () => ({
        data: checkResult({
          requirements: [row('open-electives', 'Open electives', 'Open electives', '16', '14', '2')],
          load: { '2026-27-I': { planned_credits: '27', limit_credits: '28', available_credits: '1' }, '2027-28-I': { planned_credits: '8', limit_credits: '28', available_credits: '20' } },
        }),
      }),
    });
    const draft = await generate(s);
    await settled(draft);
    await userEvent.click(within(draft).getByRole('button', { name: 'Add elective credits to 2027–28 Semester I' }));
    expect(within(within(draft).getByRole('form', { name: /Add elective credits to 2027–28/ })).getByLabelText('Credits')).toHaveValue('2'); // needs 2
    await userEvent.click(within(draft).getByRole('button', { name: 'Add elective credits to 2026–27 Semester I' }));
    await waitFor(() => expect(within(draft).getByRole('form', { name: /Add elective credits to 2026–27/ })).toBeInTheDocument());
    expect(within(within(draft).getByRole('form', { name: /Add elective credits to 2026–27/ })).getByLabelText('Credits')).toHaveValue('1'); // the semester has room for 1
  });

  it('refuses credits that are not a number, and the button is off when every requirement is covered', async () => {
    const s = server();
    const draft = await generate(s);
    await settled(draft);
    await userEvent.click(within(draft).getByRole('button', { name: 'Add elective credits to 2027–28 Semester I' }));
    const form = within(draft).getByRole('form', { name: 'Add elective credits to 2027–28 Semester I' });
    await userEvent.clear(within(form).getByLabelText('Credits'));
    await userEvent.type(within(form).getByLabelText('Credits'), 'lots');
    await userEvent.click(within(form).getByRole('button', { name: 'Add credits' }));
    expect(within(form).getByText('Enter the credits as a number, for example 4.')).toBeInTheDocument();
    expect(s.count('POST', '/plans/check')).toHaveLength(1); // nothing was added
    await userEvent.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(within(draft).queryByRole('form', { name: /Add elective credits/ })).not.toBeInTheDocument();
  });

  it('is off when every requirement is covered', async () => {
    const s = server({ check: () => ({ data: checkResult({ uncovered_credits: '0', requirements: [row('toc', 'Theory of Computing', 'CSE core', '4', '4', '0')] }) }) });
    const draft = await generate(s);
    await settled(draft);
    expect(within(draft).getByRole('button', { name: 'Add elective credits to 2026–27 Semester I' })).toBeDisabled();
  });
});

describe('Stale records, check errors and the check conflict', () => {
  it('only the latest check answer is used when an earlier, slower one arrives afterwards', async () => {
    const answer = (counted: string) => ({ data: checkResult({ degree: { total_credits: '170', counted_credits: counted, remaining_credits: '70' } }) });
    const s = server({
      check: async (_req, n) => {
        if (n === 2) {
          await sleep(1200); // the slow answer to the first edit
          return answer('11');
        }
        return answer(n === 1 ? '100' : '22');
      },
    });
    const draft = await generate(s);
    await within(draft).findByText('100 of 170 degree credits covered by your plan');
    await userEvent.click(within(draft).getByRole('button', { name: 'Remove ZZ 310 from 2026–27 Semester I' }));
    await waitFor(() => expect(s.count('POST', '/plans/check')).toHaveLength(2), { timeout: 3000 });
    await userEvent.click(within(draft).getByRole('button', { name: 'Remove ZZ 201 from 2026–27 Semester I' }));
    await waitFor(() => expect(s.count('POST', '/plans/check')).toHaveLength(3), { timeout: 3000 });
    await within(draft).findByText('22 of 170 degree credits covered by your plan');
    await act(() => sleep(1500)); // the slow answer has now arrived
    expect(within(draft).getByText('22 of 170 degree credits covered by your plan')).toBeInTheDocument();
    expect(within(draft).queryByText(/^11 of 170/)).not.toBeInTheDocument();
  });

  it('a stale record (409) during a check shows the reload message and blocks Save', async () => {
    const s = server({ check: () => ({ status: 409, data: { current_revision: record.revision + 1, action: 'reload_compare' }, issues: [issue('REVISION_CONFLICT', 'error', [], 'Reload.')] }) });
    const draft = await generate(s);
    expect(await screen.findByText(/record was saved elsewhere/i)).toBeInTheDocument();
    expect(within(draft).getByRole('button', { name: 'Save as my plan' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Reload my record' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Draft plan (not saved)' })).not.toBeInTheDocument()); // the draft was built on an old record
  });

  it('a failed check says so with a Try again that asks again, and Save stays off meanwhile', async () => {
    const s = server({ check: (_req, n) => (n === 1 ? { status: 400, issues: [issue('INVALID_INPUT', 'error', [], 'The plan could not be checked right now.')] } : { data: checkResult() }) });
    const draft = await generate(s);
    const alert = await within(draft).findByRole('alert');
    expect(alert).toHaveTextContent('The plan could not be checked right now.');
    expect(within(draft).getByRole('button', { name: 'Save as my plan' })).toBeDisabled();
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await settled(draft);
    expect(s.count('POST', '/plans/check')).toHaveLength(2);
    expect(within(draft).queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('Saving', () => {
  it('"Save as my plan" posts exactly the returned semesters when untouched, then opens the saved plan', async () => {
    const s = server();
    const draft = await generate(s);
    expect(s.count('POST', '/plans')).toHaveLength(0); // generating saved nothing
    await settled(draft);
    await userEvent.click(within(draft).getByRole('button', { name: 'Save as my plan' }));
    await screen.findByText('navigated-away');
    const saved = s.count('POST', '/plans');
    expect(saved).toHaveLength(1);
    const body = saved[0]!.body as { label: string; semesters: unknown };
    expect(body.semesters).toEqual(generation.semesters);
    expect(body.label).toBe('Generated plan'); // the student may rename it; D-42 replaces the old dated default
  });

  it('a valid plan says so beside Save, and the status follows each change the server checks', async () => {
    const s = server({ check: () => ({ data: checkResult({ uncovered_credits: '0', requirements: defaultRequirements.map((r) => ({ ...r, uncovered_credits: '0' })) }) }) });
    const draft = await generate(s);
    await settled(draft);
    const note = await within(draft).findByText(/Valid plan\./);
    expect(note.closest('[data-tone="success"]')).not.toBeNull();
    expect(draft).not.toHaveTextContent('Not a valid plan yet');
    expect(within(draft).getByRole('button', { name: 'Save as my plan' }).parentElement).toHaveTextContent('Valid');
  });

  it('a plan that is not valid (credits still uncovered) can still be saved, and says why before it is', async () => {
    const s = server(); // the default check leaves 66 credits uncovered
    const draft = await generate(s);
    await settled(draft);
    const note = within(draft).getByTestId('plan-validity');
    expect(note).toHaveTextContent('Not a valid plan yet');
    expect(note).toHaveTextContent('66 credits of your degree not covered yet');
    expect(note).toHaveTextContent('You can still save it');
    expect(within(draft).getByRole('button', { name: 'Save as my plan' }).parentElement).toHaveTextContent('Not valid');
    await userEvent.click(within(draft).getByRole('button', { name: 'Save as my plan' }));
    await screen.findByText('navigated-away');
    expect(s.count('POST', '/plans')).toHaveLength(1);
  });

  it('a double click on Save creates one plan, not two', async () => {
    const s = server();
    const draft = await generate(s);
    await settled(draft);
    await userEvent.dblClick(within(draft).getByRole('button', { name: 'Save as my plan' }));
    await screen.findByText('navigated-away');
    expect(s.count('POST', '/plans')).toHaveLength(1);
  });

  it('saves the edited plan, elective credits included, not the generated one', async () => {
    const s = server();
    const draft = await generate(s);
    await settled(draft);
    await userEvent.click(within(draft).getByRole('button', { name: 'Remove ZZ 310 from 2026–27 Semester I' }));
    await userEvent.click(within(draft).getByRole('button', { name: 'Add elective credits to 2027–28 Semester I' }));
    await userEvent.click(within(within(draft).getByRole('form', { name: /Add elective credits/ })).getByRole('button', { name: 'Add credits' }));
    await waitFor(() => expect(s.count('POST', '/plans/check').length).toBeGreaterThanOrEqual(2), { timeout: 3000 });
    await settled(draft);
    await userEvent.click(within(draft).getByRole('button', { name: 'Save as my plan' }));
    await screen.findByText('navigated-away');
    const body = s.count('POST', '/plans')[0]!.body as { semesters: { term_id: string; courses: { normalized_code: string }[]; placeholders: { requirement_id: string }[] }[] };
    expect(body.semesters.find((x) => x.term_id === '2026-27-I')!.courses.map((c) => c.normalized_code)).toEqual(['ZZ 201']);
    expect(body.semesters.find((x) => x.term_id === '2027-28-I')!.placeholders.map((p) => p.requirement_id)).toContain('open-electives');
  });

  it('Discard saves nothing, removes the draft and leaves Generate ready for a fresh start', async () => {
    const s = server();
    const draft = await generate(s);
    await userEvent.click(within(draft).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Draft plan (not saved)' })).not.toBeInTheDocument());
    expect(s.count('POST', '/plans')).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Generate plan' }));
    const second = await screen.findByRole('region', { name: 'Draft plan (not saved)' });
    expect(within(second).getByLabelText('Internship semester')).toHaveValue(''); // no stale choices from the discarded draft
    expect(within(second).getByLabelText('Credits per semester')).toHaveValue('most');
    expect(within(second).getByText('ZZ 310')).toBeInTheDocument(); // the removed-then-discarded edits are gone: a fresh draft
  });

  it('a failed save keeps the draft, says so, and a second try can succeed', async () => {
    let posts = 0;
    const failing = fakeApi({
      'GET /record': () => ({ data: record }),
      'GET /curricula/cse-2024': () => ({ data: curriculum }),
      'GET /catalogue': () => ({ data: { courses: [], coverage: 'partial', review_status: 'reviewed' }, issues: [] }),
      'GET /plans': () => ({ data: [] }),
      'POST /plans/generate': () => ({ data: generation, issues: generationExample.issues }),
      'POST /plans/check': () => ({ data: checkResult() }),
      'POST /plans': () => ((posts += 1) === 1 ? { status: 400, issues: [issue('INVALID_INPUT', 'error', [], 'Invalid request fields; review the documented schema.')] } : { status: 201, data: { id: 'saved-plan-1', revision: 0, label: 'x', semesters: [], validation: emptyValidation } }),
    });
    renderApp(<PlanIndexPage />, { fetchImpl: failing.fetchImpl, route: '/plan', path: '/plan' });
    await userEvent.click(await screen.findByRole('button', { name: 'Generate plan' }));
    const draft = await screen.findByRole('region', { name: 'Draft plan (not saved)' });
    await settled(draft);
    await userEvent.click(within(draft).getByRole('button', { name: 'Save as my plan' }));
    expect(await within(draft).findByRole('alert')).toHaveTextContent('Invalid request fields');
    expect(within(draft).getByText('ZZ 201')).toBeInTheDocument();
    await userEvent.click(within(draft).getByRole('button', { name: 'Save as my plan' }));
    await screen.findByText('navigated-away');
    expect(posts).toBe(2);
  });
});

describe('Development mock', () => {
  it('serves the contract examples for generate and check, and refuses a stale revision', async () => {
    const mock = createMockFetch();
    const post = (path: string, body: unknown) => mock(`/api/v1${path}`, { method: 'POST', body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json() }));
    await post('/auth/login', { username: 'mock-student' });
    const ok = await post('/plans/generate', { record_revision: 0 });
    expect(ok.status).toBe(200);
    expect(ok.json.data.semesters).toEqual(generation.semesters);
    const checked = await post('/plans/check', { record_revision: 0, semesters: generation.semesters });
    expect(checked.status).toBe(200);
    expect(checked.json.data.degree.total_credits).toBe('170');
    expect(checked.json.data.requirements.length).toBeGreaterThan(0);
    expect(Object.keys(checked.json.data.load).length).toBeGreaterThan(0);
    expect((await post('/plans/generate', { record_revision: 99 })).status).toBe(409);
    expect((await post('/plans/check', { record_revision: 99, semesters: [] })).status).toBe(409);
  });
});
