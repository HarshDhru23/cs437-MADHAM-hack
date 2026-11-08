import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../api/client';
import { curriculum } from '../test/fixtures';
import { fakeApi } from '../test/harness';
import indexHtml from '../../index.html?raw';
import { AppRoot } from './App';
import { THEME_KEY } from './theme';

function renderShell() {
  const { fetchImpl } = fakeApi({ 'GET /curricula/cse-2024': () => ({ data: curriculum }), 'GET /catalogue': () => ({ data: { courses: [], coverage: 'unknown', review_status: 'draft' } }) }, null);
  return render(<AppRoot router="memory" initialPath="/" createClient={(onAuthExpired) => new ApiClient({ fetch: fetchImpl, onAuthExpired })} />);
}

beforeEach(() => {
  document.documentElement.removeAttribute('data-theme');
  window.localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe('theme', () => {
  it('is dark by default, whatever the system prefers', async () => {
    window.matchMedia = ((query: string) => ({ matches: query.includes('light'), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
    renderShell();
    await screen.findByRole('button', { name: 'Switch to light theme' });
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  });

  it('the toggle switches to light and back, names the other theme, and remembers the choice', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(await screen.findByRole('button', { name: 'Switch to light theme' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(window.localStorage.getItem(THEME_KEY)).toBe('light');
    await user.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(window.localStorage.getItem(THEME_KEY)).toBe('dark');
  });

  it('a remembered light choice is used when the page loads', async () => {
    window.localStorage.setItem(THEME_KEY, 'light');
    renderShell();
    await screen.findByRole('button', { name: 'Switch to dark theme' });
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
  });

  it('when storage is blocked the theme is still dark and the toggle still works for this tab', async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    renderShell();
    await user.click(await screen.findByRole('button', { name: 'Switch to light theme' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
  });

  it('index.html sets the theme before first paint, defaulting to dark', () => {
    const html = indexHtml;
    expect(html).toMatch(/localStorage\.getItem\('coursepath-theme'\)/);
    expect(html).toMatch(/catch \(e\) \{\s*document\.documentElement\.setAttribute\('data-theme', 'dark'\)/);
  });
});
