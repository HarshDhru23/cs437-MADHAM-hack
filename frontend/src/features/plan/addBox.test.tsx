import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { CatalogueCourse } from '../../api/types';
import { renderApp } from '../../test/harness';
import { PlanPage } from './PlanPage';
import { planServer } from './planServerFake';

const render = (s: ReturnType<typeof planServer>) => renderApp(<PlanPage />, { fetchImpl: s.fetchImpl, route: '/plan/plan-1', path: '/plan/:plan_id' });
const TERM = '2027–28 Semester I';

async function openBox(s: ReturnType<typeof planServer>, entry: 'course' | 'online course' | 'placeholder' = 'course') {
  render(s);
  const sem = await screen.findByRole('region', { name: TERM });
  await userEvent.click(within(sem).getByRole('button', { name: `Add ${entry} to ${TERM}` }));
  return screen.getByRole('dialog');
}

describe('One add box for a course, a project, an online course and a placeholder (CP-49)', () => {
  it('opens one dialog with the four kinds as tabs, on the kind of the button that was pressed', async () => {
    const dialog = await openBox(planServer(), 'online course');
    expect(within(dialog).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Course', 'Project', 'Online course', 'Placeholder']);
    expect(within(dialog).getByRole('tab', { name: 'Online course' })).toHaveAttribute('aria-selected', 'true');
    expect(dialog).toHaveAccessibleName(`Add online course to ${TERM}`);
  });

  it('switches kind inside the same dialog, and the title follows the kind', async () => {
    const dialog = await openBox(planServer());
    expect(dialog).toHaveAccessibleName(`Add course to ${TERM}`);
    await userEvent.click(within(dialog).getByRole('tab', { name: 'Placeholder' }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(dialog).toHaveAccessibleName(`Add placeholder to ${TERM}`);
    await userEvent.click(within(dialog).getByRole('tab', { name: 'Project' }));
    expect(dialog).toHaveAccessibleName(`Add course to ${TERM}`);
    expect(within(dialog).getByRole('form', { name: 'Add a project course' })).toBeInTheDocument();
  });

  it('gives every kind the same ending: its own add button and Cancel, in that order', async () => {
    const dialog = await openBox(planServer());
    const adds: Record<string, string> = { Course: 'Add course', Project: 'Add project course', 'Online course': 'Add online course', Placeholder: 'Add placeholder' };
    for (const [tab, add] of Object.entries(adds)) {
      await userEvent.click(within(dialog).getByRole('tab', { name: tab }));
      const actions = dialog.querySelector('[data-add-actions]') as HTMLElement;
      expect(actions).not.toBeNull();
      expect(within(actions).getAllByRole('button').map((b) => b.textContent)).toEqual([add, 'Cancel']);
    }
  });

  it('says how many credits still fit in the semester, from the server, on the kinds that use the limit', async () => {
    const dialog = await openBox(planServer({ room: '8' }));
    expect(await within(dialog).findByText(/Room for 8 more credits in this semester/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('tab', { name: 'Online course' }));
    expect(within(dialog).queryByText(/Room for 8 more credits/)).not.toBeInTheDocument();
    expect(within(dialog).getByText(/not part of the semester.s credit limit/)).toBeInTheDocument();
  });

  it('changes credits with plus and minus on the project, online and placeholder forms, between 1 and 8 for an online course', async () => {
    const dialog = await openBox(planServer(), 'online course');
    const credits = within(dialog).getByLabelText('Credits');
    await userEvent.clear(credits);
    await userEvent.type(credits, '7');
    await userEvent.click(within(dialog).getByRole('button', { name: 'More credits' }));
    expect(credits).toHaveValue('8');
    expect(within(dialog).getByRole('button', { name: 'More credits' })).toBeDisabled();
    for (let i = 0; i < 9; i++) if (!(within(dialog).getByRole('button', { name: 'Fewer credits' }) as HTMLButtonElement).disabled) await userEvent.click(within(dialog).getByRole('button', { name: 'Fewer credits' }));
    expect(credits).toHaveValue('1');
    expect(within(dialog).getByRole('button', { name: 'Fewer credits' })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('tab', { name: 'Project' }));
    expect(within(dialog).getByRole('button', { name: 'More credits' })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('tab', { name: 'Placeholder' }));
    expect(within(dialog).getByRole('button', { name: 'More credits' })).toBeInTheDocument();
  });

  it('adds a project in two clicks: a department chip, the level and the credits', async () => {
    const course = (code: string, department: string): CatalogueCourse => ({ id: `v1:${code}`, normalized_code: code, title: `Synthetic ${code}`, credits: '4', department });
    const s = planServer({ catalogue: [course('ZZ 301', 'ZZ'), course('ME 201', 'ME')] });  // the chips are the departments the course list names
    const dialog = await openBox(s);
    await userEvent.click(within(dialog).getByRole('tab', { name: 'Project' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'ME' }));
    expect(within(dialog).getByLabelText('Department code')).toHaveValue('ME');
    await userEvent.selectOptions(within(dialog).getByLabelText('Project level'), '399');
    await userEvent.click(within(dialog).getByRole('button', { name: 'More credits' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'More credits' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add project course' }));
    await waitFor(() => expect(s.patches.length).toBeGreaterThan(0), { timeout: 2000 });
    expect(s.patches.at(-1)!.semesters.find((x) => x.term_id === '2027-28-I')!.courses).toEqual([expect.objectContaining({ normalized_code: 'ME 399', credits: '6' })]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); // the box closes once the course is added
  });

  it('adds an online course from the same box and keeps it outside the semester limit', async () => {
    const s = planServer();
    const dialog = await openBox(s);
    await userEvent.click(within(dialog).getByRole('tab', { name: 'Online course' }));
    await userEvent.type(within(dialog).getByLabelText('Course name (optional)'), 'Machine Learning on NPTEL');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add online course' }));
    await waitFor(() => expect(s.patches.length).toBeGreaterThan(0), { timeout: 2000 });
    expect(s.patches.at(-1)!.semesters.find((x) => x.term_id === '2027-28-I')!.placeholders).toEqual([expect.objectContaining({ label: 'Machine Learning on NPTEL', online: true })]);
  });

  it('adds a course found by searching, from the Course tab, and closes', async () => {
    const course = (code: string, title: string): CatalogueCourse => ({ id: `v1:${code}`, normalized_code: code, title, credits: '4', department: 'ZZ', baskets: ['systems'], could_satisfy: ['Systems basket'] });
    const s = planServer({ catalogue: [course('ZZ 327', 'Synthetic Distributed Systems'), course('ZZ 332', 'Synthetic Compilers')] });
    const dialog = await openBox(s);
    await userEvent.type(await within(dialog).findByLabelText(/Search courses/), 'compil');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add ZZ 332' }));
    await waitFor(() => expect(s.patches.length).toBeGreaterThan(0), { timeout: 2000 });
    expect(s.patches.at(-1)!.semesters.find((x) => x.term_id === '2027-28-I')!.courses).toEqual([expect.objectContaining({ normalized_code: 'ZZ 332', credits: '4' })]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes with Cancel on every kind and adds nothing', async () => {
    const s = planServer();
    await openBox(s);
    for (const tab of ['Course', 'Project', 'Online course', 'Placeholder']) {
      const dialog = screen.getByRole('dialog');
      await userEvent.click(within(dialog).getByRole('tab', { name: tab }));
      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      await userEvent.click(within(screen.getByRole('region', { name: TERM })).getByRole('button', { name: `Add course to ${TERM}` }));
    }
    expect(s.patches).toHaveLength(0);
  });

  it('uses plain words only: no codes or developer detail in any tab', async () => {
    const dialog = await openBox(planServer());
    for (const tab of ['Course', 'Project', 'Online course', 'Placeholder']) {
      await userEvent.click(within(dialog).getByRole('tab', { name: tab }));
      expect(dialog.textContent).not.toMatch(/\bD-\d\d\b|[A-Z]{3,}_[A-Z_]{3,}|revision/);
    }
  });
});
