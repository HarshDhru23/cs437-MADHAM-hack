import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CatalogueCourse, Curriculum, TermOfferingSnapshot } from '../api/types';
import { curriculum as baseCurriculum } from '../test/fixtures';
import { fakeApi, renderApp } from '../test/harness';
import { CoursePicker } from './CoursePicker';

/** A small set of rules with the shapes the real ones use: a mandatory course, two baskets, a science elective and open electives. */
const rules: Curriculum = {
  ...baseCurriculum,
  requirements: [
    { id: 'cse-core', label: 'CSE core', type: 'all_of', minimum_credits: '4', source_refs: [], children: [{ id: 'os', label: 'Operating Systems', type: 'mandatory_course', course_id: 'ZZ 330', minimum_credits: '4', source_refs: [] }] },
    {
      id: 'cse-electives',
      label: 'CSE discipline electives',
      type: 'all_of',
      minimum_credits: '16',
      source_refs: [],
      children: [
        { id: 'theory', label: 'Theory & Algorithms basket', type: 'minimum_credits', minimum_credits: '8', course_ids: ['ZZ 301'], source_refs: [] },
        { id: 'systems', label: 'Systems basket', type: 'minimum_credits', minimum_credits: '8', course_ids: ['ZZ 327', 'ZZ 331', 'ZZ 335'], source_refs: [] },
      ],
    },
    { id: 'bs-elective', label: 'Basic Science elective', type: 'minimum_credits', minimum_credits: '4', course_prefixes: ['PH'], source_refs: [] },
    { id: 'open-electives', label: 'Open electives', type: 'minimum_credits', minimum_credits: '16', any_course: true, source_refs: [] },
  ],
};

const course = (code: string, title: string, baskets: string[], labels: string[], credits = '4'): CatalogueCourse => ({
  id: `v1:${code}`,
  normalized_code: code,
  title,
  credits,
  department: code.split(' ')[0],
  baskets,
  could_satisfy: labels,
  prerequisite_summary: 'No recommendation recorded',
  offering_status: 'confirmed_in_snapshot',
});

const SYSTEMS = 'Systems basket';
const OPEN = 'Open electives';
// ZZ 327 and ZZ 331 are systems courses offered in the odd semester; ZZ 335 only in the even one.
const systems = [course('ZZ 327', 'Synthetic Distributed Systems', ['systems', 'open-electives'], [SYSTEMS, OPEN]), course('ZZ 331', 'Synthetic Networks', ['systems', 'open-electives'], [SYSTEMS, OPEN]), course('ZZ 335', 'Synthetic Security', ['systems', 'open-electives'], [SYSTEMS, OPEN])];
const science = [course('PH 201', 'Synthetic Electrodynamics', ['bs-elective', 'open-electives'], ['Basic Science elective', OPEN]), course('PH 202', 'Synthetic Quantum Physics', ['bs-elective', 'open-electives'], ['Basic Science elective', OPEN])];
const theory = [course('ZZ 301', 'Synthetic Algorithms', ['theory', 'open-electives'], ['Theory & Algorithms basket', OPEN])];
const mandatory = [course('ZZ 330', 'Synthetic Operating Systems', ['os'], ['Operating Systems'])];
const fillers = Array.from({ length: 30 }, (_, i) => course(`XX ${String(100 + i)}`, `Synthetic elective ${i}`, ['open-electives'], [OPEN]));
const catalogue = [...systems, ...science, ...theory, ...mandatory, ...fillers];

const snapshot = (term: string, codes: string[]): TermOfferingSnapshot => ({
  id: `snap-${term}`,
  term_id: term,
  coverage: 'complete',
  review_status: 'reviewed',
  offerings: codes.map((code) => ({ id: `${term}:${code}`, code, meeting_groups: [] })),
});

const ODD = ['ZZ 327', 'ZZ 331', 'PH 201', 'ZZ 301', 'ZZ 330', ...fillers.map((f) => f.normalized_code)];
const EVEN = ['ZZ 335', 'PH 202', 'ZZ 330'];

function render(term: string, extra: Record<string, () => { status?: number; data?: unknown }> = {}, onPick = vi.fn()) {
  const api = fakeApi({
    'GET /curricula/cse-2024': () => ({ data: rules }),
    'GET /offerings?term_id=2027-28-I': () => ({ data: snapshot('2027-28-I', ODD) }),
    'GET /offerings?term_id=2027-28-II': () => ({ data: snapshot('2027-28-II', EVEN) }),
    'GET /offerings?term_id=2027-28-SUMMER': () => ({ data: { id: null, term_id: '2027-28-SUMMER', coverage: 'unknown', review_status: null, offerings: [] } }),
    ...extra,
  });
  renderApp(<CoursePicker term={term} courses={catalogue} coverage="partial" onPick={onPick} />, { fetchImpl: api.fetchImpl });
  return { onPick, api };
}

const listed = () => within(screen.getByRole('list', { name: 'Matching courses' })).getAllByRole('listitem').map((li) => within(li).getByText(/^[A-Z]{2} \d{3}$/).textContent);

describe('CoursePicker: find a course by requirement in a semester', () => {
  it('lists exactly the Systems basket courses offered in that semester', async () => {
    render('2027-28-I');
    await userEvent.selectOptions(await screen.findByLabelText('Requirement'), SYSTEMS);
    expect(listed()).toEqual(['ZZ 327', 'ZZ 331']); // ZZ 335 is a systems course, but only the even semester offers it
    expect(screen.getByText('2 courses count toward Systems basket in 2027–28 Semester I')).toBeInTheDocument();
  });

  it('shows the other semester\'s Systems courses for that semester, and none of the first one\'s', async () => {
    render('2027-28-II');
    await userEvent.selectOptions(await screen.findByLabelText('Requirement'), SYSTEMS);
    expect(listed()).toEqual(['ZZ 335']);
  });

  it('does the same for the Basic Science elective', async () => {
    render('2027-28-I');
    await userEvent.selectOptions(await screen.findByLabelText('Requirement'), 'Basic Science elective');
    expect(listed()).toEqual(['PH 201']); // PH 202 is offered only in the even semester
  });

  it('lists every offered course for Open electives, more than the 20 shown by default, sorted by code', async () => {
    render('2027-28-I');
    const select = await screen.findByLabelText('Requirement');
    await waitFor(() => expect(screen.getByText(/Showing 20 of \d+ courses/)).toBeInTheDocument());
    expect(listed()).toHaveLength(20);
    await userEvent.selectOptions(select, OPEN);
    const codes = listed();
    expect(codes.length).toBeGreaterThan(20);
    expect(codes).toHaveLength(ODD.length - 1); // every offered course except ZZ 330, which is a mandatory course and cannot also be an open elective
    expect(codes).not.toContain('ZZ 330');
    expect(codes).toEqual([...codes].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
    expect(screen.getByText(`${codes.length} courses count toward Open electives in 2027–28 Semester I`)).toBeInTheDocument();
  });

  it('narrows within the chosen requirement as the student types, and still searches code, title and department', async () => {
    render('2027-28-I');
    await userEvent.selectOptions(await screen.findByLabelText('Requirement'), SYSTEMS);
    await userEvent.type(screen.getByRole('searchbox', { name: /Search courses/ }), 'network');
    expect(listed()).toEqual(['ZZ 331']);
    await userEvent.clear(screen.getByRole('searchbox', { name: /Search courses/ }));
    await userEvent.selectOptions(screen.getByLabelText('Requirement'), 'Any requirement');
    await userEvent.type(screen.getByRole('searchbox', { name: /Search courses/ }), 'PH');
    expect(listed()).toEqual(['PH 201']);
  });

  it('offers baskets and electives as requirements, not each mandatory course', async () => {
    render('2027-28-I');
    const select = await screen.findByLabelText('Requirement');
    await waitFor(() => expect(within(select).getAllByRole('option').length).toBeGreaterThan(1));
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Any requirement', 'Theory & Algorithms basket', SYSTEMS, 'Basic Science elective', OPEN]);
  });

  it('adds a course with the keyboard: choose the requirement, tab to a result, press Enter', async () => {
    const onPick = vi.fn();
    render('2027-28-I', {}, onPick);
    const select = await screen.findByLabelText('Requirement');
    select.focus();
    await userEvent.selectOptions(select, SYSTEMS); // jsdom does not move a select with the arrow keys; a browser does the same selection
    await waitFor(() => expect(listed()).toEqual(['ZZ 327', 'ZZ 331']));
    await userEvent.tab(); // the search box
    await userEvent.tab(); // the first result's button
    expect(screen.getByRole('button', { name: 'Add ZZ 327' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledWith({ normalized_code: 'ZZ 327', credits: '4', fromCatalogue: true, course_version_id: 'v1:ZZ 327' });
  });

  it('says what each course counts toward in requirement names, with no ids, evidence badges or notes about missing data', async () => {
    render('2027-28-I');
    await userEvent.selectOptions(await screen.findByLabelText('Requirement'), SYSTEMS);
    const text = document.body.textContent ?? '';
    expect(text).toContain('Counts toward: Systems basket, Open electives');
    expect(text).not.toMatch(/open-electives|bs-elective|cse-core|systems\b(?! basket)/);
    expect(text).not.toMatch(/unknown|No recommendation|confirmed|not checked|expected|snapshot|D-\d\d|[A-Z]{3,}_[A-Z_]{3,}/i);
  });

  it('shows a plain note for a summer term, lists no timetabled courses, and still adds a course by its code', async () => {
    const { onPick } = render('2027-28-SUMMER');
    expect(await screen.findByText(/No timetabled courses run in 2027–28 Summer/)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Matching courses' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Requirement')).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Course code'), 'CS 901');
    await userEvent.type(screen.getByLabelText(/Credits/), '4');
    await userEvent.click(screen.getByRole('button', { name: 'Add course' }));
    expect(onPick).toHaveBeenCalledWith({ normalized_code: 'CS 901', credits: '4', fromCatalogue: false });
  });

  it('falls back to every course, with a retry, when the semester\'s timetable cannot be loaded', async () => {
    let calls = 0;
    render('2027-28-I', {
      'GET /offerings?term_id=2027-28-I': () => {
        calls += 1;
        return calls === 1 ? { status: 500, data: null } : { data: snapshot('2027-28-I', ODD) };
      },
    });
    expect(await screen.findByText(/could not be loaded, so all courses are listed/)).toBeInTheDocument();
    expect(listed().length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByText(/could not be loaded/)).not.toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText('Requirement'), SYSTEMS);
    expect(listed()).toEqual(['ZZ 327', 'ZZ 331']);
  });

  it('lists everything with a short note when a semester has no timetable at all', async () => {
    render('2030-31-I', { 'GET /offerings?term_id=2030-31-I': () => ({ data: { id: null, term_id: '2030-31-I', coverage: 'unknown', review_status: null, offerings: [] } }) });
    expect(await screen.findByText('Showing all courses.')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Requirement'), SYSTEMS);
    expect(listed()).toEqual(['ZZ 327', 'ZZ 331', 'ZZ 335']);
  });
});
