import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { preview, record } from '../../test/fixtures';
import { fakeApi, issue, renderApp } from '../../test/harness';
import { Steps } from './ImportPage';
import { previewStore } from './previewStore';
import { ReviewPage } from './ReviewPage';

describe('Import stepper', () => {
  it('marks the step you are on, the ones behind you as done and the ones ahead as next', () => {
    render(<Steps current="review" />);
    const steps = within(screen.getByRole('list', { name: 'Steps' })).getAllByRole('listitem');
    expect(steps.map((s) => s.textContent)).toEqual(['1. Import', '2. Review', '3. Analyze']);
    expect(steps.map((s) => s.getAttribute('data-state'))).toEqual(['done', 'current', 'next']);
    expect(steps[1]).toHaveAttribute('aria-current', 'step');
    expect(steps[0]).not.toHaveAttribute('aria-current');
  });

  it('has nothing done on the first step', () => {
    render(<Steps current="import" />);
    expect(within(screen.getByRole('list', { name: 'Steps' })).getAllByRole('listitem').map((s) => s.getAttribute('data-state'))).toEqual(['current', 'next', 'next']);
  });
});

describe('Review rows that need a look', () => {
  beforeEach(() => previewStore.clear());

  it('marks a row with an issue, and only that row, for the amber stripe', async () => {
    previewStore.put({ preview, issues: [issue('UNMATCHED_COURSE', 'unknown', ['cand-2'], 'Catalogue classification has not been reviewed.')], ownerId: '1', kind: 'ims' });
    const api = fakeApi({ 'GET /record': () => ({ data: { ...record, revision: 0, attempts: [] } }) });
    renderApp(<ReviewPage />, { fetchImpl: api.fetchImpl, route: `/record/review/${preview.id}`, path: '/record/review/:preview_id' });
    await screen.findByRole('heading', { level: 1, name: 'Review imported rows' }, { timeout: 5000 });
    const rows = [...document.querySelectorAll('.review-table tbody tr')].filter((r) => r.querySelector('input[type="checkbox"]'));
    expect(rows.length).toBeGreaterThan(1);
    const flagged = rows.filter((r) => r.getAttribute('data-flagged') === 'true');
    const code = preview.candidate_attempts.find((c) => c.id === 'cand-2')!.normalized_code;
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toHaveTextContent(code);
  });

  it('shows the row filter as a segmented control and switches with the keyboard', async () => {
    previewStore.put({ preview, issues: [], ownerId: '1', kind: 'ims' });
    const api = fakeApi({ 'GET /record': () => ({ data: { ...record, revision: 0, attempts: [] } }) });
    renderApp(<ReviewPage />, { fetchImpl: api.fetchImpl, route: `/record/review/${preview.id}`, path: '/record/review/:preview_id' });
    await screen.findByRole('heading', { level: 1, name: 'Review imported rows' }, { timeout: 5000 });
    const group = screen.getByRole('radiogroup', { name: 'Row filter' });
    const all = within(group).getAllByRole('radio')[0]!;
    all.focus();
    expect(all.closest('label')).toHaveAttribute('data-checked', 'true');
    await userEvent.keyboard('{ArrowRight}');
    expect(within(group).getAllByRole('radio')[1]).toBeChecked();
    expect(within(group).getAllByRole('radio')[1]!.closest('label')).toHaveAttribute('data-checked', 'true');
  });
});
