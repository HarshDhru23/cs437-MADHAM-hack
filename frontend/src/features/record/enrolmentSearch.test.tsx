import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { AcademicRecord, Catalogue, CurrentEnrolment, RecordPatch } from '../../api/types';
import { record } from '../../test/fixtures';
import { fakeApi, renderApp } from '../../test/harness';
import { RecordPage } from './RecordPage';

const catalogue: Catalogue = {
  coverage: 'partial',
  review_status: 'reviewed',
  courses: [
    { id: 'k1', normalized_code: 'ZZ 330', title: 'Synthetic operating systems', credits: '4', department: 'ZZ', baskets: ['systems'], could_satisfy: ['Systems basket'] },
    { id: 'k2', normalized_code: 'ZZ 331', title: 'Synthetic computer networks', credits: '4', department: 'ZZ', baskets: ['systems'], could_satisfy: ['Systems basket'] },
    { id: 'k3', normalized_code: 'ZZ 432', title: 'Synthetic database design', credits: '3', department: 'ZZ', baskets: [], could_satisfy: [] },
  ],
};

const enrolled = (code: string, credits = '4'): CurrentEnrolment => ({ id: `e-${code}`, normalized_code: code, term_id: '2026-27-I', credits, confirmed: true });

function server(current_enrolment: CurrentEnrolment[] = [], withCatalogue = true) {
  let current: AcademicRecord = { ...structuredClone(record), current_enrolment };
  const patches: RecordPatch[] = [];
  const api = fakeApi({
    'GET /record': () => ({ data: current }),
    'GET /catalogue': () => (withCatalogue ? { data: catalogue } : { status: 503, data: null }),
    'PATCH /record': (req) => {
      const body = req.body as RecordPatch;
      patches.push(body);
      current = { ...current, revision: current.revision + 1, ...(body.current_enrolment ? { current_enrolment: body.current_enrolment } : {}) };
      return { data: current };
    },
  });
  return { ...api, patches };
}

/** The courses listed under the search box (the semester menu has options of its own). */
const listed = (section: HTMLElement) => within(within(section).getByRole('listbox')).getAllByRole('option');

const open = async (s: ReturnType<typeof server>) => {
  renderApp(<RecordPage />, { fetchImpl: s.fetchImpl });
  const section = await screen.findByRole('region', { name: 'Current enrolment' });
  const box = await within(section).findByRole('combobox', { name: /Find a course/ });
  return { section, box };
};

describe('Adding a current course by searching (CP-48)', () => {
  it('lists the courses that match a part of the code or the title as the student types', async () => {
    const { section, box } = await open(server());
    await userEvent.type(box, 'oper');
    const options = listed(section);
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('ZZ 330');
    expect(options[0]).toHaveTextContent('Synthetic operating systems');
    expect(options[0]).toHaveTextContent('4 credits');
    await userEvent.clear(box);
    await userEvent.type(box, 'zz33'); // a code is found however it is spaced
    expect(listed(section).map((o) => o.textContent)).toEqual([expect.stringContaining('ZZ 330'), expect.stringContaining('ZZ 331')]);
  });

  it('adds the chosen course with its own credits to the semester shown, as a confirmed course, with no code or credits typed', async () => {
    const s = server();
    const { section, box } = await open(s);
    await userEvent.type(box, 'networks');
    await userEvent.click(within(within(section).getByRole('listbox')).getByRole('option', { name: /ZZ 331/ }));
    expect(within(section).getByRole('table', { name: 'Confirmed current courses' })).toHaveTextContent('ZZ 331');
    await waitFor(() => expect(s.patches).toHaveLength(1), { timeout: 2000 });
    expect(s.patches[0]).toMatchObject({ current_enrolment: [{ normalized_code: 'ZZ 331', credits: '4', confirmed: true, term_id: '2026-27-I' }] });
    expect(box).toHaveValue(''); // ready for the next course
  });

  it('works from the keyboard: arrow down, Enter, and Escape to close', async () => {
    const s = server();
    const { section, box } = await open(s);
    await userEvent.type(box, 'zz3');
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(within(section).getByRole('table', { name: 'Confirmed current courses' })).toHaveTextContent('ZZ 331');
    await userEvent.type(box, 'zz');
    expect(listed(section).length).toBeGreaterThan(0);
    await userEvent.keyboard('{Escape}');
    expect(within(section).queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('shows a course that is already registered as added and does not add it twice', async () => {
    const s = server([enrolled('ZZ 330')]);
    const { section, box } = await open(s);
    await userEvent.type(box, 'ZZ 330');
    const option = within(within(section).getByRole('listbox')).getByRole('option', { name: /ZZ 330/ });
    expect(option).toHaveAttribute('aria-disabled', 'true');
    expect(option).toHaveTextContent('Added');
    await userEvent.click(option);
    expect(within(section).getAllByRole('row').filter((r) => /ZZ 330/.test(r.textContent ?? ''))).toHaveLength(1);
  });

  it('says what no course matches, and keeps the by-code form for a course the list does not have', async () => {
    const s = server();
    const { section, box } = await open(s);
    await userEvent.type(box, 'qqq');
    expect(within(section).getByText(/No course matches/)).toBeInTheDocument();
    expect(within(section).getByLabelText('Course code')).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: 'Add to current enrolment' })).toBeInTheDocument();
  });

  it('still offers adding by code when the course list could not be loaded', async () => {
    const s = server([], false);
    renderApp(<RecordPage />, { fetchImpl: s.fetchImpl });
    const section = await screen.findByRole('region', { name: 'Current enrolment' });
    expect(within(section).getByLabelText('Course code')).toBeInTheDocument();
    expect(within(section).queryByRole('combobox', { name: /Find a course/ })).not.toBeInTheDocument();
  });

  it('shows how many credits are registered out of 28, and says so in words when that is more', async () => {
    const s = server([enrolled('ZZ 330'), enrolled('ZZ 331')]);
    const { section } = await open(s);
    expect(within(section).getByText('8 of 28 credits')).toBeInTheDocument();
    expect(within(section).queryByText(/over the 28-credit limit/i)).not.toBeInTheDocument();
  });

  it('says it is over the limit when the registered credits pass 28, without blocking anything', async () => {
    const s = server(['A 1', 'B 2', 'C 3', 'D 4', 'E 5', 'F 6', 'G 7', 'H 8'].map((c) => enrolled(`ZZ ${c.slice(-1)}00`, '4')));
    const { section } = await open(s);
    expect(within(section).getByText('32 of 28 credits')).toBeInTheDocument();
    expect(within(section).getByText(/over the 28-credit limit/i)).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: 'Add to current enrolment' })).toBeEnabled();
  });

  it('puts a removed course back with Undo, in the same place, and saves the final list', async () => {
    const s = server([enrolled('ZZ 330'), enrolled('ZZ 331')]);
    const { section } = await open(s);
    await userEvent.click(within(section).getByRole('button', { name: 'Remove ZZ 330 from current enrolment' }));
    expect(within(section).getByText(/Removed ZZ 330/)).toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: 'Remove ZZ 330 from current enrolment' })).not.toBeInTheDocument();
    await userEvent.click(within(section).getByRole('button', { name: 'Undo' }));
    expect(within(section).getByRole('button', { name: 'Remove ZZ 330 from current enrolment' })).toBeInTheDocument();
    expect(within(section).queryByText(/Removed ZZ 330/)).not.toBeInTheDocument();
    const rows = within(section).getAllByRole('row').map((r) => r.textContent ?? '');
    expect(rows.findIndex((t) => t.includes('ZZ 330'))).toBeLessThan(rows.findIndex((t) => t.includes('ZZ 331')));
  });

  it('shows plain words only, no codes, revision numbers or developer detail', async () => {
    const s = server([enrolled('ZZ 330')]);
    const { section, box } = await open(s);
    await userEvent.type(box, 'zz');
    expect(section.textContent).not.toMatch(/revision|\bD-\d\d\b|[A-Z]{3,}_[A-Z_]{3,}/);
  });
});
