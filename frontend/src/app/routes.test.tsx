import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ApiClient } from '../api/client';
import { curriculum, plan, record } from '../test/fixtures';
import { fakeApi } from '../test/harness';
import { AppRoot } from './App';

function renderAt(path: string, signedIn: boolean) {
  const { fetchImpl } = fakeApi(
    {
      'GET /curricula/cse-2024': () => ({ data: curriculum }),
      'GET /catalogue': () => ({ data: { courses: [], coverage: 'unknown', review_status: 'draft' } }),
      'GET /record': () => ({ data: record }),
      'GET /plans': () => ({ data: [plan] }),
      'GET /plans/:id': () => ({ data: plan }),
      'POST /analysis': () => ({ status: 409, data: { current_revision: 9, action: 'reload_compare' } }),
    },
    signedIn ? { id: '1', username: 'synthetic-student' } : null,
  );
  return render(<AppRoot router="memory" initialPath={path} createClient={(onAuthExpired) => new ApiClient({ fetch: fetchImpl, onAuthExpired })} />);
}

describe('routes and shell (A01)', () => {
  it.each([
    ['/', 'CSE 2024 graduation requirements'],
    ['/login', 'Sign in'],
    ['/signup', 'Create account'],
    ['/record/import', 'Add your academic record'],
    ['/awards', 'Awards'],
    ['/scenarios', 'Scenarios'],
  ])('%s renders its screen', async (path, heading) => {
    renderAt(path, false);
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
  });

  it.each(['/record', '/performance', '/plan/plan-1', '/account', '/record/review/abc', '/report/plan-1'])('%s asks a signed-out visitor to sign in without leaking data', async (path) => {
    renderAt(path, false);
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in required' })).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', `/login?next=${encodeURIComponent(path)}`);
    expect(screen.queryByText(/synthetic data structures/i)).not.toBeInTheDocument();
  });

  it('shows the three main areas and data context in the shell', async () => {
    renderAt('/', false);
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(nav).toHaveTextContent('Requirements');
    expect(nav).toHaveTextContent('My record');
    expect(nav).toHaveTextContent('Plan');
    expect(await screen.findByText('cse-2024-draft-v1 (draft)')).toBeInTheDocument();
    expect(screen.getByText('Public requirements (no personal data)')).toBeInTheDocument();
  });

  it('marks the current main area', async () => {
    renderAt('/plan/plan-1', true);
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(nav.querySelector('[aria-current="page"]')).toHaveTextContent('Plan');
  });

  it('keeps the page\'s data context and rule review status after in-app navigation to a protected page', async () => {
    renderAt('/plan/plan-1', true);
    await screen.findByRole('region', { name: '2026–27 Semester I' });
    const context = screen.getByRole('region', { name: 'Data context' });
    await waitFor(() => expect(context).toHaveTextContent('Projected plan (not completed)'));
    expect(context).toHaveTextContent('cse-2024-draft-v1 (draft)');
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'My record' }));
    await screen.findByRole('heading', { level: 1, name: 'My record' });
    await waitFor(() => expect(context).toHaveTextContent('Actual completed history'));
    expect(context).toHaveTextContent('cse-2024-draft-v1 (draft)');
  });

  it('keeps the page\'s data context when navigating from a public page to a protected one', async () => {
    renderAt('/', true);
    await screen.findByRole('heading', { level: 1, name: 'CSE 2024 graduation requirements' });
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Plan' }));
    await screen.findByRole('heading', { level: 1, name: 'Plans' });
    const context = screen.getByRole('region', { name: 'Data context' });
    // With the defect, the shell's "no data" lands after the page's context in the same commit, so this never appears.
    await waitFor(() => expect(context).toHaveTextContent('Projected plan (not completed)'));
  });

  it('renders a not-found page for unknown routes', async () => {
    renderAt('/nope', false);
    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
  });

  it('does not show a development mock banner in a normal (non-mock) build', async () => {
    renderAt('/', false);
    await screen.findByRole('navigation', { name: 'Main' });
    expect(screen.queryByText(/Development mock data/)).not.toBeInTheDocument();
  });
});
