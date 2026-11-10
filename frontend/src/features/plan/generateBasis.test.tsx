/** "Plan from" (CP-38, D-49): a student with confirmed current courses chooses between planning from the completed courses alone and from the
 * completed + current courses. The default sends nothing new; "completed only" sends options.include_current = false. */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import generationExample from '../../../../examples/plan-generation.json';
import type { AcademicRecord, PlanValidation } from '../../api/types';
import { curriculum, plan, record } from '../../test/fixtures';
import { fakeApi, renderApp } from '../../test/harness';
import { PlanIndexPage } from './PlanPage';

const emptyValidation = { workload: {}, per_course: [], issues: [], meeting_check_status: 'not_checked', completion_term: null } as PlanValidation;
const withCurrent: AcademicRecord = { ...record, current_enrolment: [{ id: 'ce1', normalized_code: 'CS 330', term_id: '2026-27-I', credits: '4', confirmed: true }] };

function server(rec: AcademicRecord) {
  return fakeApi({
    'GET /record': () => ({ data: rec }),
    'GET /curricula/cse-2024': () => ({ data: curriculum }),
    'GET /catalogue': () => ({ data: { courses: [], coverage: 'partial', review_status: 'reviewed' }, issues: [] }),
    'GET /plans': () => ({ data: [] }),
    'GET /plans/:id': () => ({ data: plan }),
    'POST /plans/:id/validate': () => ({ data: emptyValidation }),
    'POST /plans/generate': () => ({ data: generationExample.data, issues: generationExample.issues }),
    'POST /plans/check': () => ({
      data: {
        validation: emptyValidation,
        degree: { total_credits: '170', counted_credits: '100', remaining_credits: '70' },
        placeholder_credits: '0',
        uncovered_credits: '70',
        requirements: [],
        online: { planned_credits: '0', counted_credits: '0' },
        load: {},
        status: { valid: false, problems: 0, uncovered_credits: '70' },
      },
    }),
  });
}

const render = (s: ReturnType<typeof server>) => renderApp(<PlanIndexPage />, { fetchImpl: s.fetchImpl, route: '/plan', path: '/plan' });
const generated = (s: ReturnType<typeof server>) => s.calls.filter((c) => c.method === 'POST' && c.path === '/plans/generate');

describe('Plan from (CP-38)', () => {
  it('is offered only when the student has confirmed current courses', async () => {
    render(server(record));
    await screen.findByRole('button', { name: 'Generate plan' });
    expect(screen.queryByLabelText('Plan from')).not.toBeInTheDocument();
  });

  it('defaults to completed + current courses and sends nothing extra', async () => {
    const s = server(withCurrent);
    render(s);
    expect(await screen.findByLabelText('Plan from')).toHaveValue('current');
    await userEvent.click(screen.getByRole('button', { name: 'Generate plan' }));
    await waitFor(() => expect(generated(s)).toHaveLength(1));
    expect(generated(s)[0]!.body).toEqual({ record_revision: withCurrent.revision });
  });

  it('"Completed courses only" asks the server to leave current courses out', async () => {
    const s = server(withCurrent);
    render(s);
    await userEvent.selectOptions(await screen.findByLabelText('Plan from'), 'completed');
    await userEvent.click(screen.getByRole('button', { name: 'Generate plan' }));
    await waitFor(() => expect(generated(s)).toHaveLength(1));
    expect(generated(s)[0]!.body).toEqual({ record_revision: withCurrent.revision, options: { include_current: false } });
  });

  it('changing the choice with a draft on screen builds the draft again from the other starting point', async () => {
    const s = server(withCurrent);
    render(s);
    await userEvent.click(await screen.findByRole('button', { name: 'Generate plan' }));
    await screen.findByRole('region', { name: 'Draft plan (not saved)' });
    await userEvent.selectOptions(screen.getByLabelText('Plan from'), 'completed');
    await waitFor(() => expect(generated(s)).toHaveLength(2));
    expect(generated(s)[1]!.body).toEqual({ record_revision: withCurrent.revision, options: { include_current: false } });
  });
});
