import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { AcademicRecord, Catalogue, CurrentEnrolment, RecordPatch } from '../../api/types';
import { record } from '../../test/fixtures';
import { fakeApi, renderApp } from '../../test/harness';
import { RecordPage } from './RecordPage';

// Issue #157 (CP-48): Undo after re-adding a removed course by code, and the course search for a student with no completed term.

const catalogue: Catalogue = {
  coverage: 'partial',
  review_status: 'reviewed',
  courses: [{ id: 'k1', normalized_code: 'ZZ 330', title: 'Synthetic operating systems', credits: '4', department: 'ZZ', baskets: [], could_satisfy: [] }],
};

const enrolled = (code: string, credits = '4'): CurrentEnrolment => ({ id: `e-${code}`, normalized_code: code, term_id: '2026-27-I', credits, confirmed: true });

function server(start: Partial<AcademicRecord> = {}) {
  let current: AcademicRecord = { ...structuredClone(record), ...start };
  const patches: RecordPatch[] = [];
  const api = fakeApi({
    'GET /record': () => ({ data: current }),
    'GET /catalogue': () => ({ data: catalogue }),
    'PATCH /record': (req) => {
      const body = req.body as RecordPatch;
      patches.push(body);
      current = { ...current, revision: current.revision + 1, ...(body.current_enrolment ? { current_enrolment: body.current_enrolment } : {}) };
      return { data: current };
    },
  });
  return { ...api, patches };
}

const open = async (s: ReturnType<typeof server>) => {
  renderApp(<RecordPage />, { fetchImpl: s.fetchImpl });
  return screen.findByRole('region', { name: 'Current enrolment' });
};

const rowsFor = (section: HTMLElement, code: string) => within(section).queryAllByRole('row').filter((r) => r.textContent?.includes(code));

async function addByCode(section: HTMLElement, code: string, credits: string) {
  await userEvent.type(within(section).getByLabelText('Course code'), code);
  await userEvent.type(within(section).getByLabelText('Credits'), credits);
  await userEvent.click(within(section).getByLabelText(/I confirm I am enrolled/));
  await userEvent.click(within(section).getByRole('button', { name: 'Add to current enrolment' }));
}

describe('Undo after re-adding the same course by code (issue #157)', () => {
  it('Remove, add the course again by code, then Undo leaves exactly one row and counts its credits once', async () => {
    const s = server({ current_enrolment: [enrolled('ZZ 330')] });
    const section = await open(s);
    await userEvent.click(within(section).getByRole('button', { name: 'Remove ZZ 330 from current enrolment' }));
    await addByCode(section, 'ZZ 330', '4');
    expect(rowsFor(section, 'ZZ 330')).toHaveLength(1);
    const undo = within(section).queryByRole('button', { name: 'Undo' });
    if (undo) await userEvent.click(undo);
    expect(rowsFor(section, 'ZZ 330')).toHaveLength(1);
    expect(within(section).getByText('4 of 28 credits')).toBeInTheDocument();
    await waitFor(() => expect(s.patches.length).toBeGreaterThan(0), { timeout: 2000 });
    const last = s.patches[s.patches.length - 1]?.current_enrolment ?? [];
    expect(last.filter((e) => e.normalized_code === 'ZZ 330')).toHaveLength(1);
  });

  it('refuses to add by code a course that is already registered for that semester, and says so', async () => {
    const s = server({ current_enrolment: [enrolled('ZZ 330')] });
    const section = await open(s);
    await addByCode(section, 'zz330', '4');
    expect(within(section).getByRole('alert')).toHaveTextContent(/ZZ 330 is already/);
    expect(rowsFor(section, 'ZZ 330')).toHaveLength(1);
  });

  it('still puts a removed course back with Undo when it was not added again', async () => {
    const s = server({ current_enrolment: [enrolled('ZZ 330')] });
    const section = await open(s);
    await userEvent.click(within(section).getByRole('button', { name: 'Remove ZZ 330 from current enrolment' }));
    await userEvent.click(within(section).getByRole('button', { name: 'Undo' }));
    expect(rowsFor(section, 'ZZ 330')).toHaveLength(1);
  });
});

describe('Course search for a student with no completed term (issue #157)', () => {
  it('offers a semester menu, and adds the chosen course to the semester the student picks', async () => {
    const s = server({ attempts: [], current_enrolment: [] });
    const section = await open(s);
    const semester = within(section).getByLabelText('Semester');
    await userEvent.selectOptions(semester, '2024-25-I');
    const box = await within(section).findByRole('combobox', { name: /Find a course/ });
    await userEvent.type(box, 'oper');
    await userEvent.click(within(within(section).getByRole('listbox')).getByRole('option', { name: /ZZ 330/ }));
    expect(within(section).queryByRole('alert')).not.toBeInTheDocument();
    expect(rowsFor(section, 'ZZ 330')).toHaveLength(1);
    await waitFor(() => expect(s.patches).toHaveLength(1), { timeout: 2000 });
    expect(s.patches[0]?.current_enrolment).toEqual([expect.objectContaining({ normalized_code: 'ZZ 330', term_id: '2024-25-I', confirmed: true })]);
  });

  it('asks for the semester, pointing at a menu that is on the page, when none is chosen yet', async () => {
    const s = server({ attempts: [], current_enrolment: [] });
    const section = await open(s);
    expect(within(section).getByLabelText('Semester')).toBeInTheDocument();
    const box = await within(section).findByRole('combobox', { name: /Find a course/ });
    await userEvent.type(box, 'oper');
    await userEvent.click(within(within(section).getByRole('listbox')).getByRole('option', { name: /ZZ 330/ }));
    expect(within(section).getByRole('alert')).toHaveTextContent(/Choose the semester first/);
    expect(s.patches).toHaveLength(0);
  });
});
