import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import generationExample from '../../../../examples/plan-generation.json';
import type { AcademicRecord, PlanCheck, PlanValidation } from '../../api/types';
import { curriculum, plan, record } from '../../test/fixtures';
import { fakeApi, renderApp } from '../../test/harness';
import { PlanIndexPage } from './PlanPage';
import { PlanStatusNote } from './PlanStatusNote';

// Review follow-up to #153 (CP-44): the note before saving is a draft check, which has one 28-credit limit. A student who set their own
// credit limit (GPS standing or an advisor limit) is told that it is checked when they save, so "Valid" before and "Not valid" after is not a surprise.

const VALID = { valid: true, problems: 0, uncovered_credits: '0' };
const emptyValidation = { workload: {}, per_course: [], issues: [], meeting_check_status: 'not_checked', completion_term: null } as PlanValidation;
const validCheck: PlanCheck = {
  validation: emptyValidation,
  degree: { total_credits: '170', counted_credits: '170', remaining_credits: '0' },
  placeholder_credits: '0',
  uncovered_credits: '0',
  requirements: [],
  online: { planned_credits: '0', counted_credits: '0' },
  load: { '2026-27-I': { planned_credits: '8', limit_credits: '28', available_credits: '20' } },
  status: VALID,
};

describe('The valid-plan note and a limit the student set themselves', () => {
  it('says the student\'s own credit limit is checked when they save', () => {
    render(<PlanStatusNote status={VALID} pending={false} ownLimit />);
    const note = screen.getByTestId('plan-validity');
    expect(note).toHaveTextContent('Valid plan.');
    expect(note).toHaveTextContent(/your own credit limit is checked when you save/i);
  });

  it('says nothing about a limit when the student has not set one', () => {
    render(<PlanStatusNote status={VALID} pending={false} />);
    expect(screen.getByTestId('plan-validity')).not.toHaveTextContent(/credit limit/i);
  });

  it('adds nothing to a plan that is not valid, which already says it is not', () => {
    render(<PlanStatusNote status={{ valid: false, problems: 1, uncovered_credits: '0' }} pending={false} ownLimit />);
    expect(screen.getByTestId('plan-validity')).not.toHaveTextContent(/checked when you save/i);
  });

  const generate = async (rec: AcademicRecord) => {
    const api = fakeApi({
      'GET /record': () => ({ data: rec }),
      'GET /curricula/cse-2024': () => ({ data: curriculum }),
      'GET /catalogue': () => ({ data: { courses: [], coverage: 'partial', review_status: 'reviewed' }, issues: [] }),
      'GET /plans': () => ({ data: [] }),
      'GET /plans/:id': () => ({ data: plan }),
      'POST /plans/generate': () => ({ data: generationExample.data, issues: generationExample.issues }),
      'POST /plans/check': () => ({ data: validCheck }),
    });
    renderApp(<PlanIndexPage />, { fetchImpl: api.fetchImpl, route: '/plan', path: '/plan' });
    await userEvent.click(await screen.findByRole('button', { name: 'Generate plan' }));
    const draft = await screen.findByRole('region', { name: 'Draft plan (not saved)' });
    await waitFor(() => expect(within(draft).getByRole('button', { name: 'Save as my plan' })).toBeEnabled(), { timeout: 3000 });
    return draft;
  };

  it('on the draft page, a GPS student is told, and a regular student is not', async () => {
    const gps = await generate({ ...structuredClone(record), profile: { ...record.profile, standing: 'GPS' } });
    expect(within(gps).getByTestId('plan-validity')).toHaveTextContent(/your own credit limit is checked when you save/i);
  });

  it('on the draft page, a student with an advisor limit is told too', async () => {
    const capped = await generate({ ...structuredClone(record), profile: { ...record.profile, advisor_cap: '20' } });
    expect(within(capped).getByTestId('plan-validity')).toHaveTextContent(/your own credit limit is checked when you save/i);
  });
});
