/** A project course can be added to a plan (CP-39, D-52). Projects are arranged with a supervisor, so no timetable lists them; the picker
 * offers them by department and level, and the server decides whether one counts as the open project or as an elective. */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { fakeApi, renderApp } from '../test/harness';
import { curriculum } from '../test/fixtures';
import { CoursePicker } from './CoursePicker';

function render(term?: string) {
  const onPick = vi.fn();
  const api = fakeApi({
    'GET /curricula/cse-2024': () => ({ data: curriculum }),
    'GET /offerings?term_id=2027-28-I': () => ({ data: { id: 'snap', term_id: '2027-28-I', coverage: 'complete', review_status: 'reviewed', offerings: [] } }),
  });
  renderApp(<CoursePicker {...(term ? { term } : {})} courses={[]} coverage="partial" onPick={onPick} />, { fetchImpl: api.fetchImpl });
  return onPick;
}

describe('Add a project course', () => {
  it('adds a CS project with the credits the student enters, as an arranged course (not from the catalogue)', async () => {
    const onPick = render('2027-28-I');
    const form = await screen.findByRole('form', { name: 'Add a project course' });
    await userEvent.selectOptions(screen.getByLabelText('Project level'), '399');
    await userEvent.clear(screen.getByLabelText('Project credits'));
    await userEvent.type(screen.getByLabelText('Project credits'), '6');
    expect(form).toHaveTextContent(/decides/i); // says that CoursePath chooses between open project and elective
    await userEvent.click(screen.getByRole('button', { name: 'Add project course' }));
    expect(onPick).toHaveBeenCalledWith({ normalized_code: 'CS 399', credits: '6', fromCatalogue: false });
  });

  it('takes another department, in capitals whatever the student types', async () => {
    const onPick = render('2027-28-I');
    await userEvent.clear(await screen.findByLabelText('Department code'));
    await userEvent.type(screen.getByLabelText('Department code'), 'ee');
    await userEvent.click(screen.getByRole('button', { name: 'Add project course' }));
    expect(onPick).toHaveBeenCalledWith({ normalized_code: 'EE 299', credits: '4', fromCatalogue: false });
  });

  it('refuses a department that is not two to four letters and credits that are not a positive number', async () => {
    const onPick = render('2027-28-I');
    await userEvent.clear(await screen.findByLabelText('Department code'));
    await userEvent.type(screen.getByLabelText('Department code'), 'C1');
    await userEvent.click(screen.getByRole('button', { name: 'Add project course' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/department/i);
    await userEvent.clear(screen.getByLabelText('Department code'));
    await userEvent.type(screen.getByLabelText('Department code'), 'CS');
    await userEvent.clear(screen.getByLabelText('Project credits'));
    await userEvent.type(screen.getByLabelText('Project credits'), '0');
    await userEvent.click(screen.getByRole('button', { name: 'Add project course' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/credits/i);
    expect(onPick).not.toHaveBeenCalled();
  });
});
