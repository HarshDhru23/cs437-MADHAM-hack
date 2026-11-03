/**
 * A08 (CP-23, CP-24): term offerings, section choice and clashes in the planner.
 *
 * Snapshot data comes from examples/offerings.json (PH 202 and ES 667 with B1/B2
 * lectures and the H2 tutorial). Where a test needs a shape the example lacks
 * (a choose-one group, unknown grouping, two variants), it derives it from the
 * example with the change spelled out. Expected weekdays and times are the slot
 * times in docs/team/source-findings.md (B1 Tuesday 08:30-09:50, B2 Friday
 * 08:30-09:50, H2 Wednesday 11:30-12:50, H1 Monday 17:00-18:20), not output of
 * the code under test. Clash results are the server's (fake) validation.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import offeringsExample from '../../../../examples/offerings.json';
import type { AcademicPlan, CourseOffering, Issue, MeetingConflict, OfferingMeeting, PlanPayload, PlanValidation, TermOfferingSnapshot } from '../../api/types';
import { curriculum, record } from '../../test/fixtures';
import { fakeApi, issue, renderApp } from '../../test/harness';
import { PlanPage } from './PlanPage';

type Patch = PlanPayload & { expected_revision: number };
const TERM = '2026-27-I';
const LATER = '2027-28-I';

const example = offeringsExample.data as unknown as TermOfferingSnapshot;
const snapshot = (change?: (s: TermOfferingSnapshot) => void): TermOfferingSnapshot => {
  const copy = structuredClone(example);
  change?.(copy);
  return copy;
};
const offering = (s: TermOfferingSnapshot, code: string) => s.offerings.find((o) => o.code === code) as CourseOffering;
const lecture = (code: string, slot: string) => offering(example, code).meeting_groups[0]!.meetings.find((m) => m.original_slot === slot) as OfferingMeeting;
/** The server's "no snapshot" shape (server/api/views.py offerings()). */
const noSnapshot = (term: string) => ({
  data: { id: null, term_id: term, coverage: 'unknown', review_status: null, offerings: [], slot_map: {}, source_refs: [] },
  issues: [issue('OFFERING_UNKNOWN', 'unknown', [], `No timetable snapshot is loaded for ${term}; availability and clashes are unknown.`)],
});

function conflict(a: OfferingMeeting, b: OfferingMeeting, certain: boolean, assumptions: string[] = []): MeetingConflict {
  return {
    // The server's id shape: clash:{item}|{item}|{meeting}|{meeting} (coursepath/timetable.py).
    id: `clash:c-ph|c-es|${a.id}|${b.id}`,
    item_ids: ['c-ph', 'c-es'],
    meeting_ids: [a.id, b.id],
    kinds: [a.kind ?? null, b.kind ?? null],
    weekday: a.weekday,
    start_minute: Math.max(a.start_minute, b.start_minute),
    end_minute: Math.min(a.end_minute, b.end_minute),
    certain,
    assumptions,
    source_refs: [...(a.source_refs ?? []), ...(b.source_refs ?? [])],
  };
}

const basePlan = (): AcademicPlan => ({
  id: 'plan-1',
  revision: 2,
  label: 'Main plan',
  semesters: [
    {
      term_id: TERM,
      courses: [
        { id: 'c-ph', normalized_code: 'PH 202', credits: '4' },
        { id: 'c-es', normalized_code: 'ES 667', credits: '4' },
      ],
      placeholders: [],
    },
    { term_id: LATER, courses: [{ id: 'c-net', normalized_code: 'CS 331', credits: '4' }], placeholders: [] },
  ],
});

interface TermResult {
  status: 'clear' | 'conflicts' | 'not_checked';
  conflicts?: MeetingConflict[];
  offering?: string;
  perItem?: Record<string, 'clear' | 'conflicts' | 'not_checked'>;
  offeringIds?: Record<string, string[]>;
}

function server(opts: { terms: Record<string, TermResult>; snapshots: Record<string, unknown>; issues?: Issue[]; plan?: AcademicPlan; conflictOnce?: boolean }) {
  let current = opts.plan ?? basePlan();
  let conflictOnce = opts.conflictOnce ?? false;
  const patches: Patch[] = [];
  const validate = (p: AcademicPlan): PlanValidation => ({
    workload: Object.fromEntries(p.semesters.map((s) => [s.term_id, { selected_credits: '8', placeholder_credits: '0', target_credits: '8' }])),
    per_course: p.semesters.flatMap((s) =>
      s.courses.map((c) => ({
        id: c.id,
        term_id: s.term_id,
        eligibility: 'unknown' as const,
        offering_status: opts.terms[s.term_id]?.offering ?? 'unknown',
        meeting_check_status: opts.terms[s.term_id]?.perItem?.[c.id] ?? opts.terms[s.term_id]?.status ?? 'not_checked',
        ...(opts.terms[s.term_id]?.offeringIds?.[c.id] ? { offering_ids: opts.terms[s.term_id]!.offeringIds![c.id] } : {}),
      })),
    ),
    issues: opts.issues ?? [],
    meeting_check_status: 'not_checked',
    meeting_checks: Object.fromEntries(p.semesters.map((s) => [s.term_id, { status: opts.terms[s.term_id]?.status ?? 'not_checked', conflicts: opts.terms[s.term_id]?.conflicts ?? [] }])),
    completion_term: null,
  });
  const routes: Parameters<typeof fakeApi>[0] = {
    'GET /record': () => ({ data: record }),
    'GET /curricula/cse-2024': () => ({ data: curriculum }),
    'GET /catalogue': () => ({ data: { courses: [], coverage: 'unknown', review_status: 'draft' } }),
    'GET /plans/:id': () => ({ data: current }),
    'POST /plans/:id/validate': () => ({ data: validate(current) }),
    'PATCH /plans/:id': (req) => {
      const body = req.body as Patch;
      patches.push(body);
      if (conflictOnce || body.expected_revision !== current.revision) {
        conflictOnce = false;
        return { status: 409, data: { current_revision: current.revision + 1, action: 'reload_compare' }, issues: [issue('REVISION_CONFLICT', 'error')] };
      }
      current = { id: current.id, revision: current.revision + 1, label: body.label, semesters: body.semesters };
      return { data: { ...current, validation: validate(current) } };
    },
  };
  for (const term of [TERM, LATER]) {
    const value = opts.snapshots[term];
    // A stored snapshot comes back with the example envelope's issues; a missing one with the server's no-snapshot shape.
    routes[`GET /offerings?term_id=${term}`] = () => (value ? { data: value, issues: offeringsExample.issues } : noSnapshot(term));
  }
  const api = fakeApi(routes);
  return { fetchImpl: api.fetchImpl, patches, calls: api.calls };
}

const render = (s: ReturnType<typeof server>) => renderApp(<PlanPage />, { fetchImpl: s.fetchImpl, route: '/plan/plan-1', path: '/plan/:plan_id' });
const panel = (label: string) => screen.findByRole('region', { name: `Timetable check for ${label}` });

describe('Term timetable panel (A08, CP-23/24)', () => {
  it('shows "Not checked" with the server\'s reasons, never a green check, and the snapshot label, date, review and coverage', async () => {
    const s = server({
      terms: { [TERM]: { status: 'not_checked', offering: 'confirmed_in_snapshot' } },
      snapshots: { [TERM]: snapshot() },
      issues: [issue('MEETINGS_UNKNOWN', 'unknown', ['c-ph', '2026-27-I:PH202:tutorial'], 'Some tutorial meetings could not be resolved from the source.')],
    });
    render(s);
    const p = await panel('2026–27 Semester I');
    await waitFor(() => expect(within(p).getByRole('note', { name: 'Why 2026–27 Semester I is not checked' })).toHaveTextContent('Some tutorial meetings could not be resolved'));
    expect(within(p).getAllByText('Not checked').length).toBeGreaterThan(0);
    expect(within(p).queryByText('No clashes found')).not.toBeInTheDocument();
    expect(p.querySelector('.badge-success')?.textContent ?? '').not.toMatch(/clash/i);
    expect(within(p).getByRole('note', { name: /not checked/ })).toHaveTextContent('MEETINGS_UNKNOWN');
    // Snapshot facts from the example file.
    expect(p).toHaveTextContent('timetable-2026-27-I');
    expect(p).toHaveTextContent('synthetic-timetable.xlsx');
    expect(p).toHaveTextContent('Not stated by the source');
    // The review line follows examples/offerings.json (draft once the #10 follow-up lands).
    expect(p).toHaveTextContent(offeringsExample.data.review_status === 'reviewed' ? 'Reviewed against its source by staff' : 'Draft, not reviewed: offerings are tentative');
    expect(p).toHaveTextContent(/Coverage\s*Partial/);
    expect(p).toHaveTextContent('not a registration guarantee');
    expect(p).toHaveTextContent('A course absent from it is unknown, not unavailable');
    expect(p).toHaveTextContent('OFFERING_COVERAGE_PARTIAL');
    expect(within(p).getAllByText('Confirmed in snapshot').length).toBe(2);
  });

  it('shows "No clashes found" only when the server reports the term clear', async () => {
    const s = server({ terms: { [TERM]: { status: 'clear', offering: 'tentative' } }, snapshots: { [TERM]: snapshot() } });
    render(s);
    const p = await panel('2026–27 Semester I');
    await waitFor(() => expect(within(p).getAllByText('No clashes found').length).toBeGreaterThan(0));
    expect(within(p).queryByRole('note', { name: /not checked/ })).not.toBeInTheDocument();
    expect(within(p).getAllByText('Tentative (draft snapshot)').length).toBe(2);
  });

  it('marks a certain clash as an error and a possible one as a warning with the server\'s assumptions and source cells', async () => {
    const assumption = 'Active dates are not stated; both meetings are assumed to run all term.';
    const s = server({
      terms: {
        [TERM]: {
          status: 'conflicts',
          offering: 'confirmed_in_snapshot',
          conflicts: [conflict(lecture('PH 202', 'B1'), lecture('ES 667', 'B1'), true), conflict(lecture('PH 202', 'B2'), lecture('ES 667', 'B2'), false, [assumption])],
        },
      },
      snapshots: { [TERM]: snapshot() },
    });
    render(s);
    const p = await panel('2026–27 Semester I');
    await waitFor(() => expect(within(p).getByRole('heading', { name: 'Clashes reported by the server (2)' })).toBeInTheDocument());
    expect(within(p).getAllByText('Clashes').length).toBeGreaterThan(0);
    const certain = p.querySelector('li[data-severity="error"]') as HTMLElement;
    const possible = p.querySelector('li[data-severity="warning"]') as HTMLElement;
    // B1 is Tuesday 08:30-09:50 and B2 Friday 08:30-09:50 (source-findings).
    expect(certain).toHaveTextContent('Error');
    expect(certain).toHaveTextContent(/PH 202\s*lecture and\s*ES 667\s*lecture overlap on Tuesday 08:30–09:50/);
    expect(certain).toHaveTextContent('Time table!K3');
    expect(certain).toHaveTextContent('Time table!K4');
    expect(certain).toHaveTextContent('slot B1');
    expect(certain).toHaveTextContent('room not stated');
    expect(certain).not.toHaveTextContent('Possible clash');
    expect(possible).toHaveTextContent('Warning');
    expect(possible).toHaveTextContent('Possible clash');
    expect(possible).toHaveTextContent('Friday 08:30–09:50');
    expect(possible).toHaveTextContent(assumption);
    expect(p).toHaveTextContent('Different rooms do not resolve a clash');
    // Weekly detail supplements the list and has a text alternative.
    const list = within(p).getByRole('list', { name: 'Weekly meetings for 2026–27 Semester I (list)' });
    expect(list).toHaveTextContent(/Tuesday:.*08:30–09:50 PH 202 lecture, slot B1 \(required; room not stated\) — in a reported clash/);
    expect(list).toHaveTextContent(/Wednesday:.*11:30–12:50 PH 202 tutorial, slot H2/);
    expect(within(p).getByRole('table', { name: /Weekly meetings for 2026–27 Semester I \(grid\)/ })).toBeInTheDocument();
  });

  it('a choose-one tutorial is picked with radio buttons and saved as section_ids through the plan save path', async () => {
    // Derived from the example: PH 202's tutorial becomes a choose-one group with H2 and an H1 alternative.
    const choose = snapshot((x) => {
      const tutorial = offering(x, 'PH 202').meeting_groups[1]!;
      tutorial.selection_semantics = 'choose_one';
      tutorial.meetings.push({ ...tutorial.meetings[0]!, id: '2026-27-I:PH202:tutorial:H1', weekday: 0, start_minute: 1020, end_minute: 1100, original_slot: 'H1' });
    });
    const s = server({ terms: { [TERM]: { status: 'conflicts', offering: 'confirmed_in_snapshot' } }, snapshots: { [TERM]: choose } });
    render(s);
    const p = await panel('2026–27 Semester I');
    await userEvent.click(await within(p).findByRole('button', { name: 'Choose sections for PH 202' }));
    const dialog = screen.getByRole('dialog', { name: 'Sections for PH 202 in 2026–27 Semester I' });
    expect(within(dialog).getByRole('region', { name: 'PH 202 lecture meetings' })).toHaveTextContent('All listed meetings required');
    const group = within(dialog).getByRole('group', { name: /Choose one tutorial meeting for PH 202/ });
    expect(within(group).getByRole('radio', { name: /Not chosen yet/ })).toBeChecked();
    expect(within(group).getByRole('radio', { name: /Wednesday 11:30–12:50 · slot H2/ })).toBeInTheDocument();
    await userEvent.click(within(group).getByRole('radio', { name: /Monday 17:00–18:20 · slot H1/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save section choice' }));
    await waitFor(() => expect(s.patches).toHaveLength(1), { timeout: 2000 });
    expect(s.patches[0]!.expected_revision).toBe(2);
    const ph = s.patches[0]!.semesters.find((x) => x.term_id === TERM)!.courses.find((c) => c.id === 'c-ph')!;
    expect(ph.section_ids).toEqual(['2026-27-I:PH202:tutorial:H1']);
    await waitFor(() => expect(screen.getByRole('status', { name: 'Plan save status' })).toHaveTextContent('Saved'));
  });

  it('a stale section save gets the 409 reload/compare panel and is not retried', async () => {
    const s = server({ terms: { [TERM]: { status: 'conflicts', offering: 'confirmed_in_snapshot' } }, snapshots: { [TERM]: snapshot() }, conflictOnce: true });
    render(s);
    const p = await panel('2026–27 Semester I');
    await userEvent.click(await within(p).findByRole('button', { name: 'Choose sections for ES 667' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save section choice' }));
    await waitFor(() => expect(screen.getByRole('status', { name: 'Plan save status' })).toHaveTextContent('Conflict'), { timeout: 2000 });
    expect(screen.getByRole('button', { name: 'Reload saved version' })).toBeInTheDocument();
    expect(s.patches).toHaveLength(1);
  });

  it('a group with unstated semantics gets a clarification, not radio buttons or "required"', async () => {
    // Derived from the example: ES 667's lecture group with semantics the source does not state.
    const unknown = snapshot((x) => {
      offering(x, 'ES 667').meeting_groups[0]!.selection_semantics = 'unknown';
    });
    const s = server({ terms: { [TERM]: { status: 'conflicts', offering: 'confirmed_in_snapshot' } }, snapshots: { [TERM]: unknown } });
    render(s);
    const p = await panel('2026–27 Semester I');
    await userEvent.click(await within(p).findByRole('button', { name: 'Choose sections for ES 667' }));
    const dialog = screen.getByRole('dialog', { name: 'Sections for ES 667 in 2026–27 Semester I' });
    const group = within(dialog).getByRole('region', { name: 'ES 667 lecture meetings' });
    expect(group).toHaveTextContent('Grouping not stated');
    expect(group).toHaveTextContent('does not say whether you attend every listed lecture slot or only one of them');
    expect(group).toHaveTextContent('does not assume all of them are compulsory');
    expect(group).not.toHaveTextContent('All listed meetings required');
    expect(within(group).getAllByText('Listed; meaning not stated')).toHaveLength(2);
    expect(within(dialog).queryAllByRole('radio')).toHaveLength(0);
  });

  it('a future term with no snapshot is "Not checked" and its offering unknown, never clear', async () => {
    const s = server({
      terms: { [TERM]: { status: 'conflicts', offering: 'confirmed_in_snapshot' }, [LATER]: { status: 'not_checked', offering: 'unknown' } },
      snapshots: { [TERM]: snapshot() },
      issues: [issue('MEETINGS_UNKNOWN', 'unknown', ['c-net'], 'No timetable snapshot exists for this term; clashes were not checked.')],
    });
    render(s);
    const p = await panel('2027–28 Semester I');
    await waitFor(() => expect(within(p).getByRole('note', { name: 'Why 2027–28 Semester I is not checked' })).toHaveTextContent('No timetable snapshot is stored for 2027–28 Semester I'));
    expect(p).toHaveTextContent('This does not mean there are none.');
    expect(within(p).getAllByText('Not checked').length).toBeGreaterThan(0);
    expect(within(p).getByText('No timetable snapshot')).toBeInTheDocument();
    expect(within(p).getByText('Unknown')).toBeInTheDocument();
    expect(within(p).queryByText('No clashes found')).not.toBeInTheDocument();
    expect(within(p).queryByText(/Confirmed in snapshot|Tentative/)).not.toBeInTheDocument();
    expect(within(p).queryByRole('button', { name: /Choose sections/ })).not.toBeInTheDocument();
    // The current term's snapshot is not reused for the later term.
    expect(p).not.toHaveTextContent('timetable-2026-27-I');
  });

  it('offers the variant choice the server asks for and renders unfamiliar issue codes generically', async () => {
    // Derived from the example: a second PH 202 variant (an (E) label) in the same snapshot.
    const variants = snapshot((x) => {
      const ph = offering(x, 'PH 202');
      x.offerings.push({ ...structuredClone(ph), id: '2026-27-I:PH202#v2', raw_label: 'PH 202 (E)' });
    });
    const ids = ['2026-27-I:PH202', '2026-27-I:PH202#v2'];
    const s = server({
      terms: { [TERM]: { status: 'not_checked', offering: 'confirmed_in_snapshot', offeringIds: { 'c-ph': ids, 'c-es': ['2026-27-I:ES667'] } } },
      snapshots: { [TERM]: variants },
      issues: [
        issue('OFFERING_SECTION_REQUIRED', 'unknown', ['c-ph', ...ids], 'Several source variants exist; choose the offering before clashes can be checked.'),
        issue('OFFERING_VARIANT_UNKNOWN', 'error', ['c-es'], 'The chosen offering variant is not in this snapshot.'),
      ],
    });
    render(s);
    const p = await panel('2026–27 Semester I');
    const why = await within(p).findByRole('note', { name: 'Why 2026–27 Semester I is not checked' });
    // The note first says the plan is not validated yet; wait for the server's reasons.
    await waitFor(() => expect(why).toHaveTextContent('Several source variants exist'));
    expect(why).toHaveTextContent('OFFERING_VARIANT_UNKNOWN');
    expect(why).toHaveTextContent('The chosen offering variant is not in this snapshot.');
    await userEvent.click(within(p).getByRole('button', { name: 'Choose sections for PH 202' }));
    const dialog = screen.getByRole('dialog', { name: 'Sections for PH 202 in 2026–27 Semester I' });
    const variant = within(dialog).getByRole('group', { name: 'Source variant for PH 202' });
    expect(variant).toHaveTextContent('Choose the one you will take');
    expect(within(dialog).getByRole('button', { name: 'Save section choice' })).toBeDisabled();
    await userEvent.click(within(variant).getByRole('radio', { name: /PH 202 \(E\)/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save section choice' }));
    await waitFor(() => expect(s.patches).toHaveLength(1), { timeout: 2000 });
    const ph = s.patches[0]!.semesters.find((x) => x.term_id === TERM)!.courses.find((c) => c.id === 'c-ph')!;
    expect(ph.offering_id).toBe('2026-27-I:PH202#v2');
    expect(ph.section_ids).toEqual([]);
  });

  it('an empty term shows the server\'s "Not checked" next to "No courses are planned", never "No clashes found"', async () => {
    const plan = basePlan();
    plan.semesters[1]!.courses = [];
    // Main's server reports every empty term as not_checked (coursepath/timetable.py).
    const s = server({ plan, terms: { [TERM]: { status: 'conflicts' }, [LATER]: { status: 'not_checked' } }, snapshots: { [TERM]: snapshot() } });
    render(s);
    const p = await panel('2027–28 Semester I');
    await waitFor(() => expect(within(p).getByText('No courses are planned for this term.', { exact: false })).toBeInTheDocument());
    expect(within(p).getByText('Not checked')).toBeInTheDocument();
    expect(within(p).queryByText('No clashes found')).not.toBeInTheDocument();
    expect(within(p).queryByText('Nothing to check')).not.toBeInTheDocument();
  });

  it('a saved variant that is no longer in the snapshot can be fixed in the picker and is never sent back', async () => {
    // Main's issue shape (coursepath/timetable.py): entities [item_id, stale_offering_id], severity error.
    // The example snapshot lists only 2026-27-I:PH202; the plan still holds a #v2 picked under an earlier draft.
    const stale = '2026-27-I:PH202#v2';
    const plan = basePlan();
    plan.semesters[0]!.courses[0] = { ...plan.semesters[0]!.courses[0]!, offering_id: stale, section_ids: [] };
    const s = server({
      plan,
      terms: { [TERM]: { status: 'not_checked', offering: 'tentative', perItem: { 'c-ph': 'not_checked', 'c-es': 'clear' }, offeringIds: { 'c-ph': ['2026-27-I:PH202'] } } },
      snapshots: { [TERM]: snapshot() },
      issues: [issue('OFFERING_VARIANT_UNKNOWN', 'error', ['c-ph', stale], "The selected offering variant is not in this term's snapshot for PH 202.")],
    });
    render(s);
    const p = await panel('2026–27 Semester I');
    const button = await within(p).findByRole('button', { name: 'Choose sections for PH 202' });
    // The label changes once the server's validation arrives.
    await waitFor(() => expect(button).toHaveTextContent('Choose variant and sections'));
    expect(p).toHaveTextContent(`Saved variant ${stale} (not in snapshot)`);
    await userEvent.click(button);
    const dialog = screen.getByRole('dialog', { name: 'Sections for PH 202 in 2026–27 Semester I' });
    expect(dialog).toHaveTextContent(`Your saved variant ${stale} is not in the current timetable snapshot`);
    // The current offering's meetings are shown and the save is possible.
    expect(within(dialog).getByRole('region', { name: 'PH 202 lecture meetings' })).toBeInTheDocument();
    const save = within(dialog).getByRole('button', { name: 'Save section choice' });
    expect(save).toBeEnabled();
    await userEvent.click(save);
    await waitFor(() => expect(s.patches).toHaveLength(1), { timeout: 2000 });
    const ph = s.patches[0]!.semesters.find((x) => x.term_id === TERM)!.courses.find((c) => c.id === 'c-ph')!;
    expect(ph.offering_id).not.toBe(stale);
    expect(ph.offering_id ?? null).toBeNull();
  });

  it('a saved variant for a course no longer in the snapshot can be cleared', async () => {
    // Derived from the example: ES 667 is gone from a corrected snapshot, but the plan still pins its old offering.
    const stale = '2026-27-I:ES667';
    const corrected = snapshot((x) => {
      x.offerings = x.offerings.filter((o) => o.code !== 'ES 667');
    });
    const plan = basePlan();
    plan.semesters[0]!.courses[1] = { ...plan.semesters[0]!.courses[1]!, offering_id: stale, section_ids: ['2026-27-I:ES667:lecture:B1'] };
    const s = server({
      plan,
      terms: { [TERM]: { status: 'not_checked', offering: 'unknown', offeringIds: { 'c-ph': ['2026-27-I:PH202'], 'c-es': [] } } },
      snapshots: { [TERM]: corrected },
      issues: [issue('OFFERING_VARIANT_UNKNOWN', 'error', ['c-es', stale], "The selected offering variant is not in this term's snapshot for ES 667.")],
    });
    render(s);
    const p = await panel('2026–27 Semester I');
    const button = await within(p).findByRole('button', { name: 'Choose sections for ES 667' });
    await waitFor(() => expect(button).toHaveTextContent('Clear saved variant'));
    await userEvent.click(button);
    const dialog = screen.getByRole('dialog', { name: 'Sections for ES 667 in 2026–27 Semester I' });
    expect(dialog).toHaveTextContent("is not in this term's timetable snapshot");
    await userEvent.click(within(dialog).getByRole('button', { name: 'Clear saved variant' }));
    await waitFor(() => expect(s.patches).toHaveLength(1), { timeout: 2000 });
    const es = s.patches[0]!.semesters.find((x) => x.term_id === TERM)!.courses.find((c) => c.id === 'c-es')!;
    expect(es.offering_id ?? null).toBeNull();
    expect(es.section_ids ?? []).toEqual([]);
  });

  it('exam groups are not shown as required weekly meetings', async () => {
    // Derived from the example: ES 667 gains an exam group; the server's clash check skips kind "exam".
    const withExam = snapshot((x) => {
      const es = offering(x, 'ES 667');
      const b1 = es.meeting_groups[0]!.meetings[0]!;
      es.meeting_groups.push({ id: '2026-27-I:ES667:exam', kind: 'exam', selection_semantics: 'all_required', meetings: [{ ...b1, id: '2026-27-I:ES667:exam:1', kind: 'exam', weekday: 3 }] });
    });
    const s = server({ terms: { [TERM]: { status: 'clear', offering: 'confirmed_in_snapshot' } }, snapshots: { [TERM]: withExam } });
    render(s);
    const p = await panel('2026–27 Semester I');
    const list = await within(p).findByRole('list', { name: 'Weekly meetings for 2026–27 Semester I (list)' });
    expect(list).not.toHaveTextContent('exam');
    expect(list).not.toHaveTextContent('Thursday');
    await userEvent.click(within(p).getByRole('button', { name: 'Choose sections for ES 667' }));
    const dialog = screen.getByRole('dialog', { name: 'Sections for ES 667 in 2026–27 Semester I' });
    const exam = within(dialog).getByRole('region', { name: 'ES 667 exam meetings' });
    expect(exam).toHaveTextContent('Not a weekly class');
    expect(exam).not.toHaveTextContent('Required');
    expect(exam).not.toHaveTextContent('All listed meetings required');
  });
});
