/**
 * The shared contract examples (examples/*.json) are validated against the
 * schema by the backend suite (tests/domain/test_contract.py) and the schema
 * against live responses (server/records/test_analysis.py). Rendering the same
 * files here closes the loop: if the server shape, the schema/examples and the
 * frontend types drift apart, one of these suites fails.
 */
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import auditExample from '../../../examples/audit.json';
import emptyRecordExample from '../../../examples/empty-record.json';
import planValidationExample from '../../../examples/plan-validation.json';
import conflictExample from '../../../examples/revision-conflict.json';
import type { AcademicPlan, AnalysisResult, AuditResult, PlanValidation } from '../api/types';
import { PlanPage } from '../features/plan/PlanPage';
import { RecordPage } from '../features/record/RecordPage';
import { RequirementsPage } from '../features/requirements/RequirementsPage';
import { analysis, curriculum, record } from './fixtures';
import { fakeApi, renderApp } from './harness';

// These render whole pages with several requests each; allow for a loaded CI machine.
const wait = { timeout: 5000 };

describe('shared contract examples render in the UI', () => {
  it('examples/audit.json', async () => {
    const audit = auditExample.data as unknown as AuditResult;
    const result: AnalysisResult = { ...analysis, audit, rule_version: audit.rule_version ?? analysis.rule_version };
    const { fetchImpl } = fakeApi({
      'GET /curricula/cse-2024': () => ({ data: curriculum }),
      'GET /record': () => ({ data: record }),
      'GET /plans': () => ({ data: [] }),
      'POST /analysis': () => ({ data: result, issues: auditExample.issues }),
    });
    renderApp(<RequirementsPage />, { fetchImpl });
    const overview = await screen.findByRole('region', { name: 'Overview' }, wait);
    // The example reports the degree total and nothing counted yet: 170 credits to go.
    expect(within(overview).getByRole('status')).toHaveTextContent('Not yet eligible to graduate — 170 credits to go');
    expect(within(overview).getByText('Credits counted').parentElement).toHaveTextContent('0 of 170');
    expect(screen.getByRole('region', { name: 'Things to check' })).toHaveTextContent('CS 203 does not establish CS 202 completion.');
  });

  it('examples/plan-validation.json', async () => {
    const validation = planValidationExample.data as unknown as PlanValidation;
    const plan: AcademicPlan = { id: 'plan-x', revision: 1, label: 'Example', semesters: [{ term_id: '2026-27-I', courses: [{ id: 'c1', normalized_code: 'ZZ 330', credits: '4' }], placeholders: [] }] };
    const { fetchImpl } = fakeApi({
      'GET /record': () => ({ data: record }),
      'GET /curricula/cse-2024': () => ({ data: curriculum }),
      'GET /catalogue': () => ({ data: { courses: [], coverage: 'unknown', review_status: 'draft' } }),
      'GET /plans/:id': () => ({ data: plan }),
      'POST /plans/:id/validate': () => ({ data: validation, issues: planValidationExample.issues }),
    });
    renderApp(<PlanPage />, { fetchImpl, route: '/plan/plan-x', path: '/plan/:plan_id' });
    const term = await screen.findByRole('region', { name: '2026–27 Semester I' }, wait);
    // Values straight from the example: workload is keyed by term.
    // The server's target workload for the term (12), shown against the 28-credit limit; the selected/placeholder split is no longer shown.
    expect(await within(term).findByText('Semester total: 12 / 28 credits', {}, wait)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Plan validation' })).toHaveTextContent('Synthetic required lectures overlap.');
  });

  it('examples/empty-record.json', async () => {
    const { fetchImpl } = fakeApi({ 'GET /record': () => ({ data: emptyRecordExample.data }), 'GET /curricula/cse-2024': () => ({ data: curriculum }) });
    renderApp(<RecordPage />, { fetchImpl });
    expect(await screen.findByText('No courses on your record yet.', {}, wait)).toBeInTheDocument();
  });

  it('examples/revision-conflict.json', async () => {
    const { fetchImpl } = fakeApi({
      'GET /record': () => ({ data: record }),
      'GET /curricula/cse-2024': () => ({ data: curriculum }),
      'GET /plans': () => ({ data: [] }),
      'POST /analysis': () => ({ status: 409, data: conflictExample.data, issues: conflictExample.issues }),
    });
    renderApp(<RequirementsPage />, { fetchImpl });
    expect(await screen.findByText('Saved elsewhere', {}, wait)).toBeInTheDocument();
  });
});
