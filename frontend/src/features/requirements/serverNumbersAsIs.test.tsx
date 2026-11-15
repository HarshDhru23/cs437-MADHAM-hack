import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { analysis, catalogue, curriculum, plan, record } from '../../test/fixtures';
import { fakeApi, renderApp } from '../../test/harness';
import { RequirementsPage } from './RequirementsPage';

/**
 * CR-70 (CP-03, CP-17, D-07): the page shows the credits the server counted, as they are. A client-side clamp to "what the requirement asks
 * for" would turn a group's surplus into "28 of 28" and hide a shortfall elsewhere in it (the server now caps a group by its parts, so there is
 * nothing left to hide). The fixture's CSE core group asks for 36 and the server counted 4.
 */
const withCounted = (counted: string) => ({
  ...analysis,
  audit: { ...analysis.audit, actual: analysis.audit.actual.map((n) => (n.id === 'cse-core' ? { ...n, counted_credits: counted } : n)) },
});

function routesFor(counted: string) {
  return {
    'GET /curricula/cse-2024': () => ({ data: curriculum }),
    'GET /catalogue': () => ({ data: catalogue, issues: [] }),
    'GET /record': () => ({ data: record }),
    'GET /plans': () => ({ data: [plan] }),
    'POST /analysis': () => ({ data: withCounted(counted), issues: analysis.audit.issues }),
  };
}

describe('the requirements page shows the server\'s counted credits as they are', () => {
  it('a group row shows the number the server sent, even above what the group asks for', async () => {
    const { fetchImpl } = fakeApi(routesFor('40'));
    renderApp(<RequirementsPage />, { fetchImpl });
    await screen.findByRole('region', { name: 'Overview' }, { timeout: 5000 }); // the analysis has loaded
    const list = screen.getByRole('list', { name: 'Requirements' });
    expect(within(list).getByRole('button', { name: /^Cse core/ })).toHaveTextContent('40 of 36 credits');
  });

  it('the ring caption for that group shows the same number', async () => {
    const { fetchImpl } = fakeApi(routesFor('40'));
    const { container } = renderApp(<RequirementsPage />, { fetchImpl });
    await screen.findByRole('region', { name: 'Overview' }, { timeout: 5000 });
    const arc = [...container.querySelectorAll('[data-ring-arc]')].find((a) => a.getAttribute('data-ring-arc') === 'cse-core')!;
    await userEvent.hover(arc);
    expect(container.querySelector('.ring-caption')).toHaveTextContent(/Cse core · 40 \/ 36/);
  });

  it('a group below what it asks for still shows its real count (negative)', async () => {
    const { fetchImpl } = fakeApi(routesFor('26'));
    renderApp(<RequirementsPage />, { fetchImpl });
    await screen.findByRole('region', { name: 'Overview' }, { timeout: 5000 }); // the analysis has loaded
    const list = screen.getByRole('list', { name: 'Requirements' });
    expect(within(list).getByRole('button', { name: /^Cse core/ })).toHaveTextContent('26 of 36 credits');
  });
});
