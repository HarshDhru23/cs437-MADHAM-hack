/**
 * The generated-plan editor (D-41, D-42): the student names the plan, adds online courses by hand (in a semester or a summer break),
 * sees what online courses could do for each semester's load, and can go back to exactly what the server generated.
 * The draft is `examples/plan-generation.json`; every number a student reads comes from the server's answers.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import generationExample from '../../../../examples/plan-generation.json';
import type { AcademicPlan, PlanCheck, PlanCheckRequirement, PlanGeneration, PlanValidation } from '../../api/types';
import { curriculum, plan, record } from '../../test/fixtures';
import { fakeApi, renderApp } from '../../test/harness';
import { PlanIndexPage } from './PlanPage';
import { REQUEST_TIMEOUT_MS, timeouts } from './usePlanCheck';

const generation = generationExample.data as unknown as PlanGeneration;
const emptyValidation = { workload: {}, per_course: [], issues: [], meeting_check_status: 'not_checked', completion_term: null } as PlanValidation;

const row = (id: string, label: string, group: string, required: string, counted: string, uncovered: string): PlanCheckRequirement => ({
  id,
  label,
  group,
  required_credits: required,
  counted_credits: counted,
  remaining_credits: String(Number(required) - Number(counted)),
  held_credits: '0',
  uncovered_credits: uncovered,
});

const requirements = [
  row('hss-other', 'HSS electives', 'Humanities and Social Sciences (GE included)', '8', '0', '8'),
  row('bs-elective', 'Basic Science elective', 'Basic Science elective', '4', '4', '0'),
  row('cse-general', 'General CSE electives', 'CSE discipline electives', '10', '8', '2'),
  row('open-electives', 'Open electives', 'Open electives', '16', '4', '12'),
];

const checkResult = (change: Partial<PlanCheck> = {}): PlanCheck => ({
  validation: emptyValidation,
  degree: { total_credits: '170', counted_credits: '100', remaining_credits: '70' },
  placeholder_credits: '4',
  uncovered_credits: '66',
  requirements,
  online: { planned_credits: '0', counted_credits: '0' },
  load: {
    '2026-27-I': { planned_credits: '8', limit_credits: '28', available_credits: '20' },
    '2027-28-I': { planned_credits: '8', limit_credits: '28', available_credits: '20' },
    '2026-27-SUMMER': { planned_credits: '0', limit_credits: '10', available_credits: '10' },
  },
  ...change,
});

const potential = (change: Partial<PlanGeneration['online_potential']> = {}): PlanGeneration['online_potential'] => ({
  credits_available: '16',
  break_terms: ['2026-27-SUMMER'],
  busiest_semester_credits: '28',
  busiest_before: null,
  lightened: false,
  ...change,
});

type Reply = { status?: number; data?: unknown; issues?: unknown[] };
type Req = { body: unknown };
interface Opts {
  plans?: AcademicPlan[];
  generate?: (req: Req, n: number) => Reply;
  check?: (req: Req, n: number) => Reply;
}

const draftWith = (change: Partial<PlanGeneration> = {}): PlanGeneration => ({ ...structuredClone(generation), online_potential: potential(), ...change });

function server(opts: Opts = {}) {
  let generates = 0;
  let checks = 0;
  const api = fakeApi({
    'GET /record': () => ({ data: record }),
    'GET /curricula/cse-2024': () => ({ data: curriculum }),
    'GET /catalogue': () => ({ data: { courses: [], coverage: 'partial', review_status: 'reviewed' }, issues: [] }),
    'GET /plans': () => ({ data: opts.plans ?? [] }),
    'GET /plans/:id': () => ({ data: plan }),
    'POST /plans/:id/validate': () => ({ data: emptyValidation }),
    'POST /plans/generate': (req) => opts.generate?.(req, (generates += 1)) ?? { data: draftWith() },
    'POST /plans/check': (req) => opts.check?.(req, (checks += 1)) ?? { data: checkResult() },
    'POST /plans': (req) => ({ status: 201, data: { id: 'saved-plan-1', revision: 0, label: (req.body as { label: string }).label, semesters: (req.body as { semesters: unknown }).semesters, validation: emptyValidation } }),
  });
  const count = (method: string, path: string) => api.calls.filter((c) => c.method === method && c.path === path);
  return { ...api, count };
}

async function open(s: ReturnType<typeof server>) {
  renderApp(<PlanIndexPage />, { fetchImpl: s.fetchImpl, route: '/plan', path: '/plan' });
  await userEvent.click(await screen.findByRole('button', { name: 'Generate plan' }));
  const draft = await screen.findByRole('region', { name: 'Draft plan (not saved)' });
  await settled(draft);
  return draft;
}

const settled = (draft: HTMLElement) => waitFor(() => expect(within(draft).getByRole('button', { name: 'Save as my plan' })).toBeEnabled(), { timeout: 3000 });
const card = (draft: HTMLElement, name: RegExp) => within(draft).getByRole('region', { name });
const nameField = (draft: HTMLElement) => within(draft).getByLabelText('Plan name') as HTMLInputElement;
const lastBody = (s: ReturnType<typeof server>, path: string) => s.count('POST', path).at(-1)!.body as Record<string, unknown>;

afterEach(() => {
  timeouts.request = REQUEST_TIMEOUT_MS;
});

describe('Naming the plan', () => {
  it('starts as "Generated plan" and is saved under that name', async () => {
    const s = server();
    const draft = await open(s);
    expect(nameField(draft).value).toBe('Generated plan');
    await userEvent.click(within(draft).getByRole('button', { name: 'Save as my plan' }));
    await screen.findByText('navigated-away');
    expect(lastBody(s, '/plans').label).toBe('Generated plan');
  });

  it('takes the next free number when a plan with that name exists', async () => {
    const named = (label: string): AcademicPlan => ({ ...structuredClone(plan), id: `p-${label}`, label });
    const draft = await open(server({ plans: [named('Generated plan')] }));
    await waitFor(() => expect(nameField(draft).value).toBe('Generated plan 2'));
  });

  it('skips every taken number, whatever the letter case', async () => {
    const named = (label: string): AcademicPlan => ({ ...structuredClone(plan), id: `p-${label}`, label });
    const draft = await open(server({ plans: [named('generated plan'), named('Generated plan 2')] }));
    await waitFor(() => expect(nameField(draft).value).toBe('Generated plan 3'));
  });

  it('saves the name the student typed, trimmed', async () => {
    const s = server();
    const draft = await open(s);
    await userEvent.clear(nameField(draft));
    await userEvent.type(nameField(draft), '   Plan with an internship  ');
    await userEvent.click(within(draft).getByRole('button', { name: 'Save as my plan' }));
    await screen.findByText('navigated-away');
    expect(lastBody(s, '/plans').label).toBe('Plan with an internship');
  });

  it('an empty name falls back to the default', async () => {
    const s = server();
    const draft = await open(s);
    await userEvent.clear(nameField(draft));
    expect(nameField(draft)).toHaveAttribute('placeholder', 'Generated plan');
    await userEvent.click(within(draft).getByRole('button', { name: 'Save as my plan' }));
    await screen.findByText('navigated-away');
    expect(lastBody(s, '/plans').label).toBe('Generated plan');
  });

  it('200 characters are fine; 201 get a plain message and block Save', async () => {
    const s = server();
    const draft = await open(s);
    const save = within(draft).getByRole('button', { name: 'Save as my plan' });
    await userEvent.clear(nameField(draft));
    await userEvent.click(nameField(draft));
    await userEvent.paste('a'.repeat(200));
    expect(save).toBeEnabled();
    expect(within(draft).queryByText(/at most 200 characters/)).not.toBeInTheDocument();
    await userEvent.type(nameField(draft), 'b');
    expect(await within(draft).findByRole('alert')).toHaveTextContent('Use at most 200 characters for the plan name.');
    expect(save).toBeDisabled();
    await userEvent.type(nameField(draft), '{Backspace}');
    expect(save).toBeEnabled();
  });

  it('the name stays through edits, a new draft and a reset, and goes with Discard', async () => {
    const s = server();
    const draft = await open(s);
    await userEvent.clear(nameField(draft));
    await userEvent.type(nameField(draft), 'My own name');
    await userEvent.click(within(draft).getByRole('button', { name: 'Remove ZZ 310 from 2026–27 Semester I' }));
    expect(nameField(draft).value).toBe('My own name');
    await userEvent.click(within(draft).getByRole('button', { name: 'Reset to generated plan' }));
    expect(nameField(draft).value).toBe('My own name');
    await userEvent.selectOptions(within(draft).getByLabelText('Internship semester'), '2027-28-I');
    await waitFor(() => expect(s.count('POST', '/plans/generate')).toHaveLength(2));
    await within(draft).findByRole('button', { name: 'Save as my plan' });
    expect(nameField(draft).value).toBe('My own name');
    await userEvent.click(within(draft).getByRole('button', { name: 'Discard' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Generate plan' }));
    const again = await screen.findByRole('region', { name: 'Draft plan (not saved)' });
    expect(nameField(again).value).toBe('Generated plan');
  });
});

describe('Adding an online course by hand', () => {
  const addForm = async (draft: HTMLElement, term = /2026–27 Semester I/, label = 'Add online course to 2026–27 Semester I') => {
    await userEvent.click(within(card(draft, term)).getByRole('button', { name: label }));
    return within(card(draft, term)).getByRole('form', { name: label });
  };

  it('offers the four elective requirements with what each still needs, and no ids', async () => {
    const draft = await open(server());
    const form = await addForm(draft);
    const select = within(form).getByLabelText('Counts toward') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      'HSS electives — 8 more credits needed',
      'Basic Science elective',
      'General CSE electives — 2 more credits needed',
      'Open electives — 12 more credits needed',
    ]);
    expect(form).not.toHaveTextContent(/hss-other|open-electives|cse-general|bs-elective/);
  });

  it('the credits start at the least of 4, what the requirement needs and what the semester has room for', async () => {
    const s = server({ check: () => ({ data: checkResult({ load: { '2026-27-I': { planned_credits: '27', limit_credits: '28', available_credits: '1' } } }) }) });
    const draft = await open(s);
    const form = await addForm(draft);
    const credits = within(form).getByLabelText('Credits') as HTMLInputElement;
    expect(credits.value).toBe('1'); // only 1 credit of room, although HSS electives need 8
    await userEvent.selectOptions(within(form).getByLabelText('Counts toward'), 'cse-general');
    expect(credits.value).toBe('1');
  });

  it('defaults to 4 when the requirement needs more and the semester has room, and to what is needed when that is less', async () => {
    const draft = await open(server());
    const form = await addForm(draft);
    const credits = within(form).getByLabelText('Credits') as HTMLInputElement;
    expect(credits.value).toBe('4'); // HSS electives need 8, the semester has room for 20
    await userEvent.selectOptions(within(form).getByLabelText('Counts toward'), 'cse-general');
    expect(credits.value).toBe('2'); // CSE electives need only 2
  });

  it('adds a placeholder marked online, with the name the student gave, and asks the server to check it', async () => {
    const s = server();
    const draft = await open(s);
    const form = await addForm(draft);
    await userEvent.selectOptions(within(form).getByLabelText('Counts toward'), 'open-electives');
    await userEvent.clear(within(form).getByLabelText('Credits'));
    await userEvent.type(within(form).getByLabelText('Credits'), '3');
    await userEvent.type(within(form).getByLabelText('Course name (optional)'), 'Machine Learning on NPTEL');
    await userEvent.click(within(form).getByRole('button', { name: 'Add online course' }));
    const semester = card(draft, /2026–27 Semester I/);
    const placeholderRow = within(semester).getByText('Machine Learning on NPTEL').closest('tr') as HTMLElement;
    expect(within(placeholderRow).getByRole('rowheader')).toHaveTextContent('Online course');
    expect(within(placeholderRow).getByText('3')).toBeInTheDocument();
    expect(within(placeholderRow).getByText('Open electives')).toBeInTheDocument();
    await waitFor(() => expect(s.count('POST', '/plans/check')).toHaveLength(2), { timeout: 3000 });
    const sent = lastBody(s, '/plans/check') as { semesters: { term_id: string; placeholders: object[] }[] };
    expect(sent.semesters.find((x) => x.term_id === '2026-27-I')!.placeholders).toEqual([
      { id: 'user-online-2026-27-I-1', requirement_id: 'open-electives', desired_credits: '3', label: 'Machine Learning on NPTEL', online: true },
    ]);
    expect(s.count('POST', '/plans')).toHaveLength(0);
  });

  it('without a name it is called "Online course" and a second one gets its own id', async () => {
    const s = server();
    const draft = await open(s);
    for (let i = 0; i < 2; i += 1) {
      const form = await addForm(draft);
      await userEvent.click(within(form).getByRole('button', { name: 'Add online course' }));
    }
    await waitFor(() => expect(s.count('POST', '/plans/check').length).toBeGreaterThanOrEqual(2), { timeout: 3000 });
    await waitFor(() => {
      const sent = lastBody(s, '/plans/check') as { semesters: { term_id: string; placeholders: { id: string; label: string; online: boolean }[] }[] };
      expect(sent.semesters.find((x) => x.term_id === '2026-27-I')!.placeholders.map((p) => [p.id, p.label, p.online])).toEqual([
        ['user-online-2026-27-I-1', 'Online course', true],
        ['user-online-2026-27-I-2', 'Online course', true],
      ]);
    });
    expect(within(card(draft, /2026–27 Semester I/)).getAllByRole('button', { name: 'Remove Online course from 2026–27 Semester I' })).toHaveLength(2);
  });

  it('refuses credits that are not a number from 1 to 8 and names longer than 80 characters, in plain words', async () => {
    const draft = await open(server());
    const form = await addForm(draft);
    const credits = within(form).getByLabelText('Credits');
    for (const bad of ['0', '9', 'abc', '-2', '']) {
      await userEvent.clear(credits);
      if (bad) await userEvent.type(credits, bad);
      await userEvent.click(within(form).getByRole('button', { name: 'Add online course' }));
      expect(await within(form).findByRole('alert')).toHaveTextContent('Enter the credits as a number from 1 to 8.');
    }
    await userEvent.clear(credits);
    await userEvent.type(credits, '4');
    await userEvent.click(within(form).getByLabelText('Course name (optional)'));
    await userEvent.paste('x'.repeat(81));
    await userEvent.click(within(form).getByRole('button', { name: 'Add online course' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Use at most 80 characters for the name.');
    expect(form).toBeInTheDocument(); // nothing was added
  });

  it('Cancel closes the form without adding anything', async () => {
    const s = server();
    const draft = await open(s);
    const form = await addForm(draft);
    await userEvent.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(within(card(draft, /2026–27 Semester I/)).queryByRole('form')).not.toBeInTheDocument();
    expect(s.count('POST', '/plans/check')).toHaveLength(1);
  });

  it('only one of the two forms is open in a semester at a time', async () => {
    const draft = await open(server());
    await addForm(draft);
    await userEvent.click(within(card(draft, /2026–27 Semester I/)).getByRole('button', { name: 'Add elective credits to 2026–27 Semester I' }));
    expect(within(card(draft, /2026–27 Semester I/)).queryByRole('form', { name: 'Add online course to 2026–27 Semester I' })).not.toBeInTheDocument();
    expect(within(card(draft, /2026–27 Semester I/)).getByRole('form', { name: 'Add elective credits to 2026–27 Semester I' })).toBeInTheDocument();
  });

  it('a summer break can be added from the breaks the server names, takes online courses and no elective credits', async () => {
    // The fake server answers like the real one: the semester's planned credits are what the plan holds in it.
    const s = server({
      check: (req) => {
        const sent = (req.body as { semesters: { term_id: string; courses: { credits: string }[]; placeholders: { desired_credits: string }[] }[] }).semesters;
        const load = Object.fromEntries(
          sent.map((x) => {
            const planned = [...x.courses.map((c) => c.credits), ...x.placeholders.map((p) => p.desired_credits)].reduce((a, c) => a + Number(c), 0);
            const limit = x.term_id.endsWith('SUMMER') ? 10 : 28;
            return [x.term_id, { planned_credits: String(planned), limit_credits: String(limit), available_credits: String(limit - planned) }];
          }),
        );
        return { data: checkResult({ load }) };
      },
    });
    const draft = await open(s);
    const addSemester = within(draft).getByLabelText('Add a semester') as HTMLSelectElement;
    expect([...addSemester.options].map((o) => o.textContent)).toContain('2026–27 Summer');
    await userEvent.selectOptions(addSemester, '2026-27-SUMMER');
    const summer = card(draft, /2026–27 Summer/);
    expect(summer).toHaveTextContent('Nothing planned in this semester.');
    expect(within(summer).queryByRole('button', { name: /Add elective credits/ })).not.toBeInTheDocument();
    await userEvent.click(within(summer).getByRole('button', { name: 'Add online course to 2026–27 Summer' }));
    const form = within(summer).getByRole('form', { name: 'Add online course to 2026–27 Summer' });
    expect(form).toHaveTextContent('This break has room for 10 more credits.');
    await userEvent.click(within(form).getByRole('button', { name: 'Add online course' }));
    expect(await within(summer).findByText('Summer total: 4 / 10 credits')).toBeInTheDocument();
    await waitFor(() => {
      const sent = lastBody(s, '/plans/check') as { semesters: { term_id: string; placeholders: { online?: boolean }[] }[] };
      expect(sent.semesters.find((x) => x.term_id === '2026-27-SUMMER')!.placeholders).toHaveLength(1);
    });
  });

  it('shows how many online credits are planned and how many count, from the server', async () => {
    const s = server({ check: () => ({ data: checkResult({ online: { planned_credits: '12', counted_credits: '10' } }) }) });
    const draft = await open(s);
    const progress = within(draft).getByRole('region', { name: 'Your plan so far' });
    expect(await within(progress).findByText('Online credits: 12 planned, 10 count toward your degree')).toBeInTheDocument();
  });

  it('shows nothing about online credits when none are planned', async () => {
    const draft = await open(server());
    expect(within(draft).queryByText(/Online credits:/)).not.toBeInTheDocument();
  });

  it("shows the server's warning beside the semester it is about, in plain words", async () => {
    const warning = { code: 'ONLINE_CREDIT_LIMIT', severity: 'warning', message: 'Only 10 of your 12 online credits would count toward your degree.', entity_refs: ['2026-27-I'], source_refs: [], suggested_action: '' };
    const s = server({ check: () => ({ data: checkResult({ online: { planned_credits: '12', counted_credits: '10' }, validation: { ...emptyValidation, issues: [warning] } as PlanValidation }) }) });
    const draft = await open(s);
    const semester = card(draft, /2026–27 Semester I/);
    expect(await within(semester).findByText('Only 10 of your 12 online credits would count toward your degree.')).toBeInTheDocument();
    expect(draft).not.toHaveTextContent(/ONLINE_CREDIT_LIMIT/);
    expect(within(draft).getByRole('button', { name: 'Save as my plan' })).toBeEnabled(); // a warning does not block saving
  });

  it('shows an online course the generator placed, with its summer break', async () => {
    const withSummer = draftWith();
    withSummer.semesters = [
      ...withSummer.semesters,
      { term_id: '2026-27-SUMMER', courses: [], placeholders: [{ id: 'gen-online-2026-27-SUMMER-open-electives', requirement_id: 'open-electives', desired_credits: '8', label: 'Online course', online: true }] },
    ];
    const draft = await open(server({ generate: () => ({ data: withSummer }) }));
    const summer = card(draft, /2026–27 Summer/);
    expect(within(summer).getByText('Choose an online course')).toBeInTheDocument();
    expect(within(summer).getByRole('button', { name: 'Remove Online course from 2026–27 Summer' })).toBeInTheDocument();
  });
});

describe('The potential of online courses', () => {
  it('invites the student to see what online courses in the breaks could do', async () => {
    const draft = await open(server());
    const block = within(draft).getByTestId('online-potential');
    expect(block).toHaveTextContent('Online courses could lighten your semesters: up to 16 credits can be taken in the breaks.');
    expect(within(block).getByRole('button', { name: 'Show me how much' })).toBeInTheDocument();
  });

  it('asks the server to lighten the plan, keeping the internship, and says how much lighter it gets', async () => {
    const lightened = draftWith({
      online_potential: potential({ busiest_semester_credits: '19', busiest_before: '28', lightened: true }),
      graduation: { ...generation.graduation, online_credits: '10' },
    });
    const s = server({ generate: (req) => ((req.body as { options?: { lighten_with_online?: boolean } }).options?.lighten_with_online ? { data: lightened } : { data: draftWith() }) });
    const draft = await open(s);
    await userEvent.selectOptions(within(draft).getByLabelText('Internship semester'), '2027-28-I');
    await waitFor(() => expect(s.count('POST', '/plans/generate')).toHaveLength(2));
    await userEvent.click(await within(draft).findByRole('button', { name: 'Show me how much' }));
    await waitFor(() => expect(s.count('POST', '/plans/generate')).toHaveLength(3));
    expect(lastBody(s, '/plans/generate')).toEqual({ record_revision: record.revision, options: { internship_term: '2027-28-I', lighten_with_online: true } });
    const block = await within(draft).findByTestId('online-potential');
    await waitFor(() => expect(block).toHaveTextContent('Taking 10 online credits in the breaks lowers your busiest semester from 28 to 19 credits.'));
    expect(within(draft).getByLabelText('Internship semester')).toHaveValue('2027-28-I');
    const credits = within(draft).getByLabelText('Credits per semester');
    expect(credits).toBeDisabled();
    expect(draft).toHaveTextContent('Online courses already spread the work evenly, so this choice is off.');
  });

  it('"Back to courses only" asks again without the online option', async () => {
    const lightened = draftWith({ online_potential: potential({ busiest_semester_credits: '19', busiest_before: '28', lightened: true }), graduation: { ...generation.graduation, online_credits: '10' } });
    const s = server({ generate: (req) => ((req.body as { options?: { lighten_with_online?: boolean } }).options?.lighten_with_online ? { data: lightened } : { data: draftWith() }) });
    const draft = await open(s);
    await userEvent.click(within(draft).getByRole('button', { name: 'Show me how much' }));
    await userEvent.click(await within(draft).findByRole('button', { name: 'Back to courses only' }));
    await waitFor(() => expect(s.count('POST', '/plans/generate')).toHaveLength(3));
    expect(lastBody(s, '/plans/generate')).toEqual({ record_revision: record.revision });
    expect(await within(draft).findByRole('button', { name: 'Show me how much' })).toBeInTheDocument();
    expect(within(draft).getByLabelText('Credits per semester')).toBeEnabled();
  });

  it('with an internship chosen the potential shows even when no summer break is listed', async () => {
    const internship = draftWith({ online_potential: potential({ break_terms: [], credits_available: '12' }), options: { ...generation.options, internship_term: '2027-28-I' } });
    const s = server({ generate: (req) => ((req.body as { options?: { internship_term?: string } }).options?.internship_term ? { data: internship } : { data: draftWith({ online_potential: potential({ break_terms: [] }) }) }) });
    const draft = await open(s);
    expect(within(draft).queryByTestId('online-potential')).toBeEmptyDOMElement(); // no breaks and no internship: nothing to suggest
    await userEvent.selectOptions(within(draft).getByLabelText('Internship semester'), '2027-28-I');
    expect(await within(draft).findByText('Online courses could lighten your semesters: up to 12 credits can be taken in the breaks.')).toBeInTheDocument();
  });

  it('says nothing is on offer when no online credits are left', async () => {
    const draft = await open(server({ generate: () => ({ data: draftWith({ online_potential: potential({ credits_available: '0' }) }) }) }));
    expect(within(draft).queryByRole('button', { name: 'Show me how much' })).not.toBeInTheDocument();
  });

  it('when online courses would not lower the busiest semester, says so and keeps the draft with the student\'s edits', async () => {
    const same = draftWith({ online_potential: potential({ busiest_semester_credits: '28', busiest_before: '28', lightened: true }) });
    const s = server({ generate: (req) => ((req.body as { options?: { lighten_with_online?: boolean } }).options?.lighten_with_online ? { data: same } : { data: draftWith() }) });
    const draft = await open(s);
    await userEvent.click(within(draft).getByRole('button', { name: 'Remove ZZ 310 from 2026–27 Semester I' }));
    await userEvent.click(within(draft).getByRole('button', { name: 'Show me how much' }));
    expect(await within(draft).findByText('Online courses would not lower your busiest semester here.')).toBeInTheDocument();
    expect(within(card(draft, /2026–27 Semester I/)).queryByText('ZZ 310')).not.toBeInTheDocument(); // the student's edit is still there
    expect(within(draft).queryByRole('button', { name: 'Back to courses only' })).not.toBeInTheDocument();
    expect(within(draft).getByLabelText('Credits per semester')).toBeEnabled();
  });

  it('a lightened answer without the earlier busiest semester is treated as no improvement', async () => {
    const odd = draftWith({ online_potential: potential({ busiest_before: null, lightened: true }) });
    const s = server({ generate: (req) => ((req.body as { options?: { lighten_with_online?: boolean } }).options?.lighten_with_online ? { data: odd } : { data: draftWith() }) });
    const draft = await open(s);
    await userEvent.click(within(draft).getByRole('button', { name: 'Show me how much' }));
    expect(await within(draft).findByText('Online courses would not lower your busiest semester here.')).toBeInTheDocument();
  });
});

describe('Resetting to the generated plan', () => {
  it('is off while the draft is as generated', async () => {
    const draft = await open(server());
    expect(within(draft).getByRole('button', { name: 'Reset to generated plan' })).toBeDisabled();
  });

  it('puts back exactly what the server generated, without asking it again, and checks the plan again', async () => {
    const s = server();
    const draft = await open(s);
    await userEvent.click(within(draft).getByRole('button', { name: 'Remove ZZ 310 from 2026–27 Semester I' }));
    await userEvent.click(within(draft).getByRole('button', { name: 'Remove Open project from 2027–28 Semester I' }));
    const form = await (async () => {
      await userEvent.click(within(card(draft, /2026–27 Semester I/)).getByRole('button', { name: 'Add online course to 2026–27 Semester I' }));
      return within(card(draft, /2026–27 Semester I/)).getByRole('form');
    })();
    await userEvent.click(within(form).getByRole('button', { name: 'Add online course' }));
    const reset = within(draft).getByRole('button', { name: 'Reset to generated plan' });
    expect(reset).toBeEnabled();
    const before = s.count('POST', '/plans/check').length;
    await userEvent.click(reset);
    expect(s.count('POST', '/plans/generate')).toHaveLength(1); // no new request for the plan
    const first = card(draft, /2026–27 Semester I/);
    expect(within(first).getByText('ZZ 201')).toBeInTheDocument();
    expect(within(first).getByText('ZZ 310')).toBeInTheDocument();
    expect(within(first).queryByText('Online course')).not.toBeInTheDocument();
    expect(within(card(draft, /2027–28 Semester I/)).getAllByText('Open project').length).toBeGreaterThan(0);
    expect(reset).toBeDisabled();
    await waitFor(() => expect(s.count('POST', '/plans/check').length).toBeGreaterThan(before), { timeout: 3000 });
    expect(lastBody(s, '/plans/check')).toEqual({ record_revision: record.revision, semesters: generation.semesters });
  });

  it('is off again when the student puts back what they took out, however they did it', async () => {
    const s = server({ generate: () => ({ data: draftWith() }) });
    const draft = await open(s);
    await userEvent.click(within(draft).getByRole('button', { name: 'Remove ZZ 310 from 2026–27 Semester I' }));
    const reset = within(draft).getByRole('button', { name: 'Reset to generated plan' });
    expect(reset).toBeEnabled();
    await userEvent.click(within(card(draft, /2026–27 Semester I/)).getByRole('button', { name: 'Add course to 2026–27 Semester I' }));
    const dialog = await screen.findByRole('dialog', { name: /Add course to 2026–27 Semester I/ });
    await userEvent.type(within(dialog).getByLabelText('Course code'), 'ZZ 310');
    await userEvent.type(within(dialog).getByLabelText('Credits'), '4');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add course' }));
    await waitFor(() => expect(reset).toBeDisabled());
  });

  it('clears a failed check: the plan is checked again and Save works once it answers', async () => {
    let calls = 0;
    const s = server({ check: () => (++calls === 2 ? { status: 500, data: null, issues: [] } : { data: checkResult() }) });
    const draft = await open(s);
    await userEvent.click(within(draft).getByRole('button', { name: 'Remove ZZ 310 from 2026–27 Semester I' }));
    expect(await within(draft).findByRole('alert')).toBeInTheDocument();
    expect(within(draft).getByRole('button', { name: 'Save as my plan' })).toBeDisabled();
    await userEvent.click(within(draft).getByRole('button', { name: 'Reset to generated plan' }));
    await waitFor(() => expect(within(draft).queryByRole('alert')).not.toBeInTheDocument(), { timeout: 3000 });
    await settled(draft);
  });

  it('is off while the plan is being saved', async () => {
    const s = server();
    const draft = await open(s);
    await userEvent.click(within(draft).getByRole('button', { name: 'Remove ZZ 310 from 2026–27 Semester I' }));
    await settled(draft);
    await userEvent.click(within(draft).getByRole('button', { name: 'Save as my plan' }));
    await screen.findByText('navigated-away');
    expect(s.count('POST', '/plans')).toHaveLength(1);
  });
});

describe('No developer wording', () => {
  it('the new controls carry no decision numbers, issue codes or rule talk', async () => {
    const draft = await open(server());
    await userEvent.click(within(card(draft, /2026–27 Semester I/)).getByRole('button', { name: 'Add online course to 2026–27 Semester I' }));
    expect(draft.textContent).not.toMatch(/\bD-\d{2}\b|[A-Z]{2,}_[A-Z_]{2,}|snapshot|standing|hss-other|open-electives/);
  });
});
