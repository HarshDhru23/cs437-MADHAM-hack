import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { record } from '../../test/fixtures';
import { fakeApi, renderApp } from '../../test/harness';
import { RecordPage } from './RecordPage';

const setup = () => renderApp(<RecordPage />, { fetchImpl: fakeApi({ 'GET /record': () => ({ data: record }) }).fetchImpl });

describe('My record look', () => {
  it('shows the latest term and the number of courses as readout tiles', async () => {
    const { container } = setup();
    await screen.findByRole('region', { name: 'Academic history' }, { timeout: 5000 });
    const tiles = container.querySelector('.rec-tiles') as HTMLElement;
    expect(within(tiles).getByText('Latest completed term').parentElement).toHaveTextContent('2025–26 Semester II');
    expect(within(tiles).getByText('Courses on record').parentElement).toHaveTextContent(String(record.attempts.length));
  });

  it('shows each grade as a small pill and a missing grade as plain "Blank"', async () => {
    const { container } = setup();
    const history = await screen.findByRole('region', { name: 'Academic history' }, { timeout: 5000 });
    const pills = [...container.querySelectorAll('.grade-pill')].map((p) => p.textContent);
    expect(pills.length).toBeGreaterThan(0);
    for (const attempt of record.attempts.filter((a) => a.grade)) expect(pills).toContain(attempt.grade);
    const blank = record.attempts.filter((a) => !a.grade).length;
    expect(within(history).queryAllByText('Blank')).toHaveLength(blank);
  });

  it('keeps the actions on every row', async () => {
    setup();
    await screen.findByRole('region', { name: 'Academic history' }, { timeout: 5000 });
    expect(screen.getAllByRole('button', { name: /^Correct / }).length).toBe(record.attempts.length);
  });
});
