import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiClient } from '../api/client';
import { AppRoot } from '../app/App';
import { curriculum, plan, record } from '../test/fixtures';
import { fakeApi } from '../test/harness';

function renderAt(path: string, signedIn: boolean) {
  const { fetchImpl, calls } = fakeApi(
    {
      'GET /curricula/cse-2024': () => ({ data: curriculum }),
      'GET /catalogue': () => ({ data: { courses: [], coverage: 'unknown', review_status: 'draft' } }),
      'GET /record': () => ({ data: record }),
      'GET /plans': () => ({ data: [plan] }),
      'GET /scenarios': () => ({ data: [] }),
      'POST /auth/logout': () => ({ data: null }),
    },
    signedIn ? { id: '1', username: 'synthetic-student' } : null,
  );
  render(<AppRoot router="memory" initialPath={path} createClient={(onAuthExpired) => new ApiClient({ fetch: fetchImpl, onAuthExpired })} />);
  return { calls };
}

const bar = () => screen.queryByRole('combobox', { name: 'Search or jump to' });
const options = () => screen.queryAllByRole('option').map((o) => o.textContent ?? '');

beforeEach(() => {
  document.documentElement.removeAttribute('data-theme');
  window.localStorage.clear();
});

describe('command bar', () => {
  it('opens from the button in the top bar and Escape closes it, giving focus back', async () => {
    const user = userEvent.setup();
    renderAt('/', false);
    const trigger = await screen.findByRole('button', { name: /Search or jump to/ });
    expect(bar()).not.toBeInTheDocument();
    await user.click(trigger);
    expect(bar()).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(bar()).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('opens with Ctrl+K from anywhere and toggles closed with it', async () => {
    const user = userEvent.setup();
    renderAt('/', false);
    await screen.findByRole('heading', { level: 1, name: 'Graduation requirements' });
    await user.keyboard('{Control>}k{/Control}');
    expect(bar()).toBeInTheDocument();
    await user.keyboard('{Control>}k{/Control}');
    expect(bar()).not.toBeInTheDocument();
  });

  it('opens with "/" outside a text field and not while typing in one', async () => {
    const user = userEvent.setup();
    renderAt('/login', false);
    const username = await screen.findByLabelText('Username');
    await user.click(username);
    await user.keyboard('a/b');
    expect(username).toHaveValue('a/b');
    expect(bar()).not.toBeInTheDocument();
    await user.click(document.body);
    await user.keyboard('/');
    expect(bar()).toBeInTheDocument();
  });

  it('every word of the query must be in the label, any case; nothing matching says so', async () => {
    const user = userEvent.setup();
    renderAt('/', false);
    await user.keyboard('/');
    await user.keyboard('PLAN');
    expect(options()).toEqual(expect.arrayContaining([expect.stringContaining('Go to Plan'), expect.stringContaining('Generate a plan')]));
    expect(options().join('|')).not.toContain('Go to Requirements');
    await user.clear(bar()!);
    await user.type(bar()!, 'go sc');
    expect(options()).toHaveLength(1);
    expect(options()[0]).toContain('Go to Scenarios');
    await user.clear(bar()!);
    await user.type(bar()!, 'zzz');
    expect(screen.getByText('No command matches')).toBeInTheDocument();
    expect(options()).toEqual([]);
  });

  it('arrow keys move the highlighted command (wrapping) and Enter runs it and closes the bar', async () => {
    const user = userEvent.setup();
    renderAt('/', false);
    await user.keyboard('/');
    const input = bar()!;
    const first = screen.getAllByRole('option')[0]!;
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', first.id);
    await user.keyboard('{ArrowDown}');
    const second = screen.getAllByRole('option')[1]!;
    expect(second).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', second.id);
    await user.keyboard('{ArrowUp}{ArrowUp}');
    const all = screen.getAllByRole('option');
    expect(all[all.length - 1]).toHaveAttribute('aria-selected', 'true');
    await user.clear(input);
    await user.type(input, 'scen{Enter}');
    expect(await screen.findByRole('heading', { level: 1, name: 'Scenarios' })).toBeInTheDocument();
    expect(bar()).not.toBeInTheDocument();
  });

  it('clicking a command runs it', async () => {
    const user = userEvent.setup();
    renderAt('/', false);
    await user.keyboard('/');
    await user.click(screen.getByRole('option', { name: /Import your record/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Add your academic record' })).toBeInTheDocument();
  });

  it('"Generate a plan" goes to the plan page', async () => {
    const user = userEvent.setup();
    renderAt('/', true);
    await user.keyboard('/');
    await user.type(bar()!, 'generate{Enter}');
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Plans' })).toBeInTheDocument());
  });

  it('a signed-out visitor sees Sign in and Create an account, and no account commands', async () => {
    const user = userEvent.setup();
    renderAt('/', false);
    await user.keyboard('/');
    const labels = options().join('|');
    expect(labels).toContain('Sign in');
    expect(labels).toContain('Create an account');
    expect(labels).not.toContain('Sign out');
    expect(labels).not.toContain('Go to Account');
  });

  it('a signed-in student sees Go to Account and Sign out, and no sign-in commands; Sign out signs out', async () => {
    const user = userEvent.setup();
    const { calls } = renderAt('/', true);
    await screen.findByRole('link', { name: /Account/ });
    await user.keyboard('/');
    const labels = options().join('|');
    expect(labels).toContain('Go to Account');
    expect(labels).toContain('Sign out');
    expect(labels).not.toContain('Create an account');
    await user.type(bar()!, 'sign out{Enter}');
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/auth/logout')).toBe(true));
  });

  it('the theme command flips the page theme and its own label', async () => {
    const user = userEvent.setup();
    renderAt('/', false);
    await screen.findByRole('heading', { level: 1, name: 'Graduation requirements' });
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    await user.keyboard('/');
    await user.type(bar()!, 'light{Enter}');
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    await user.keyboard('/');
    expect(screen.getByRole('option', { name: /Switch to dark theme/ })).toBeInTheDocument();
  });

  it('lists no Awards command', async () => {
    const user = userEvent.setup();
    renderAt('/', true);
    await user.keyboard('/');
    expect(options().join('|')).not.toMatch(/award/i);
  });
});
