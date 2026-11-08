/** usePlanCheck: the debounced, latest-only server check of a plan that the draft panel (and any plan editor) shares. */
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlanCheck, PlannedSemester, PlanValidation } from '../../api/types';
import { fakeApi, issue, renderApp } from '../../test/harness';
import { PlanProgress } from './PlanProgress';
import { abortAfter, REQUEST_TIMEOUT_MS, timeouts, usePlanCheck } from './usePlanCheck';

const emptyValidation = { workload: {}, per_course: [], issues: [], meeting_check_status: 'not_checked', completion_term: null } as PlanValidation;
const answer = (uncovered: string): PlanCheck => ({
  validation: emptyValidation,
  degree: { total_credits: '170', counted_credits: '100', remaining_credits: '70' },
  placeholder_credits: '0',
  uncovered_credits: uncovered,
  status: { valid: Number(uncovered) <= 0, problems: 0, uncovered_credits: uncovered },
  requirements: [],
  online: { planned_credits: '0', counted_credits: '0' },
  load: {},
});
const one = (code: string): PlannedSemester[] => [{ term_id: '2026-27-I', courses: [{ id: `c-${code}`, normalized_code: code, credits: '4' }], placeholders: [] }];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function Probe({ revision = 3 }: { revision?: number }) {
  const [semesters, setSemesters] = useState<PlannedSemester[] | null>(one('ZZ 101'));
  const [key, setKey] = useState(0);
  const state = usePlanCheck(revision, semesters, key);
  return (
    <div>
      <button onClick={() => setSemesters(one(`ZZ ${100 + Math.floor(Math.random() * 800)}`))}>change</button>
      <button onClick={() => setKey((k) => k + 1)}>new draft</button>
      <button onClick={() => setSemesters(null)}>nothing</button>
      <button onClick={state.retry}>retry</button>
      <p data-testid="state">{JSON.stringify({ left: state.check?.uncovered_credits ?? null, pending: state.pending, error: state.error?.message ?? null, conflict: state.conflict })}</p>
    </div>
  );
}

const read = () => JSON.parse(screen.getByTestId('state').textContent ?? '{}') as { left: string | null; pending: boolean; error: string | null; conflict: boolean };

afterEach(() => {
  timeouts.request = REQUEST_TIMEOUT_MS;
});

describe('usePlanCheck', () => {
  it('checks at once the first time, then answers with the server numbers', async () => {
    const api = fakeApi({ 'POST /plans/check': () => ({ data: answer('66') }) });
    renderApp(<Probe />, { fetchImpl: api.fetchImpl });
    await waitFor(() => expect(read().left).toBe('66'), { timeout: 1000 }); // well inside the 400 ms edit delay would still pass; see the next test for the delay
    expect(read().pending).toBe(false);
    expect(api.calls.filter((c) => c.path === '/plans/check')).toHaveLength(1);
    expect(api.calls.find((c) => c.path === '/plans/check')!.body).toEqual({ record_revision: 3, semesters: one('ZZ 101') });
  });

  it('waits a moment after a change and sends only the last of several quick changes', async () => {
    const api = fakeApi({ 'POST /plans/check': () => ({ data: answer('66') }) });
    renderApp(<Probe />, { fetchImpl: api.fetchImpl });
    await waitFor(() => expect(read().left).toBe('66'));
    for (let i = 0; i < 3; i += 1) await userEvent.click(screen.getByRole('button', { name: 'change' }));
    expect(read().pending).toBe(true);
    expect(read().left).toBe('66'); // the last answer stays while the next one is awaited
    expect(api.calls.filter((c) => c.path === '/plans/check')).toHaveLength(1); // nothing sent yet: the delay has not passed
    await waitFor(() => expect(api.calls.filter((c) => c.path === '/plans/check')).toHaveLength(2), { timeout: 2000 });
    await waitFor(() => expect(read().pending).toBe(false));
  });

  it('uses only the latest answer when an earlier request is slow', async () => {
    let n = 0;
    const api = fakeApi({
      'POST /plans/check': async () => {
        n += 1;
        if (n === 2) {
          await sleep(900);
          return { data: answer('11') };
        }
        return { data: answer(n === 1 ? '66' : '22') };
      },
    });
    renderApp(<Probe />, { fetchImpl: api.fetchImpl });
    await waitFor(() => expect(read().left).toBe('66'));
    await userEvent.click(screen.getByRole('button', { name: 'change' }));
    await waitFor(() => expect(n).toBe(2), { timeout: 2000 });
    await userEvent.click(screen.getByRole('button', { name: 'change' }));
    await waitFor(() => expect(read().left).toBe('22'), { timeout: 3000 });
    await act(() => sleep(1100));
    expect(read().left).toBe('22');
  });

  it('a new draft clears the old answer and checks without waiting', async () => {
    let n = 0;
    const api = fakeApi({
      'POST /plans/check': async () => {
        if ((n += 1) === 1) return { data: answer('66') };
        await sleep(100); // long enough to see the cleared state
        return { data: answer('55') };
      },
    });
    renderApp(<Probe />, { fetchImpl: api.fetchImpl });
    await waitFor(() => expect(read().left).toBe('66'));
    await userEvent.click(screen.getByRole('button', { name: 'new draft' }));
    expect(read().left).toBeNull();
    expect(read().pending).toBe(true);
    await waitFor(() => expect(read().left).toBe('55'), { timeout: 350 }); // sent at once, not after the 400 ms edit delay
  });

  it('with nothing to check it sends nothing and shows nothing', async () => {
    const api = fakeApi({ 'POST /plans/check': () => ({ data: answer('66') }) });
    renderApp(<Probe />, { fetchImpl: api.fetchImpl });
    await waitFor(() => expect(read().left).toBe('66'));
    await userEvent.click(screen.getByRole('button', { name: 'nothing' }));
    await waitFor(() => expect(read()).toEqual({ left: null, pending: false, error: null, conflict: false }));
    await act(() => sleep(600));
    expect(api.calls.filter((c) => c.path === '/plans/check')).toHaveLength(1);
  });

  it('reports a stale record as a conflict, not an error, and does not retry by itself', async () => {
    const api = fakeApi({ 'POST /plans/check': () => ({ status: 409, data: { current_revision: 9, action: 'reload_compare' }, issues: [issue('REVISION_CONFLICT', 'error', [], 'Reload.')] }) });
    renderApp(<Probe />, { fetchImpl: api.fetchImpl });
    await waitFor(() => expect(read().conflict).toBe(true));
    expect(read().error).toBeNull();
    await act(() => sleep(600));
    expect(api.calls.filter((c) => c.path === '/plans/check')).toHaveLength(1);
  });

  it('an error is reported and retry asks again', async () => {
    let n = 0;
    const api = fakeApi({ 'POST /plans/check': () => (++n === 1 ? { status: 400, issues: [issue('INVALID_INPUT', 'error', [], 'Not right now.')] } : { data: answer('66') }) });
    renderApp(<Probe />, { fetchImpl: api.fetchImpl });
    await waitFor(() => expect(read().error).toBe('Not right now.'));
    expect(read().pending).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'retry' }));
    await waitFor(() => expect(read().left).toBe('66'));
    expect(read().error).toBeNull();
  });

  it('a check that never answers is cut off after the timeout with a plain message', async () => {
    timeouts.request = 120;
    const api = fakeApi({ 'POST /plans/check': () => new Promise(() => undefined) });
    const honoring = ((input: RequestInfo | URL, init?: RequestInit) =>
      new Promise((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        api.fetchImpl(input, init).then(resolve, reject);
      })) as typeof fetch;
    renderApp(<Probe />, { fetchImpl: honoring });
    await waitFor(() => expect(read().error).toBe('This is taking too long. Try again.'), { timeout: 2000 });
    expect(read().pending).toBe(false);
  });

  it('leaving the page aborts the request that is still in flight', async () => {
    let signal: AbortSignal | null | undefined;
    const api = fakeApi({ 'POST /plans/check': () => new Promise(() => undefined) });
    const watching = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/plans/check')) signal = init?.signal;
      return api.fetchImpl(input, init);
    }) as typeof fetch;
    const view = renderApp(<Probe />, { fetchImpl: watching });
    await waitFor(() => expect(signal).toBeTruthy());
    view.unmount();
    expect(signal!.aborted).toBe(true);
  });
});

describe('abortAfter', () => {
  it('aborts after its time and says it timed out, but not when cancelled', async () => {
    const slow = abortAfter(30);
    await sleep(80);
    expect(slow.signal.aborted).toBe(true);
    expect(slow.timedOut()).toBe(true);
    const cancelled = abortAfter(1000);
    cancelled.cancel();
    expect(cancelled.signal.aborted).toBe(true);
    expect(cancelled.timedOut()).toBe(false);
  });
});

describe('PlanProgress', () => {
  const req = (id: string, label: string, group: string, uncovered: string) => ({ id, label, group, required_credits: '8', counted_credits: '0', remaining_credits: '8', held_credits: '0', uncovered_credits: uncovered });
  const view = (check: PlanCheck | null, pending = false) => {
    const api = fakeApi({});
    return renderApp(<PlanProgress check={check} pending={pending} />, { fetchImpl: api.fetchImpl });
  };

  it('shows a checking line before the first answer, and nothing when there is nothing to check', () => {
    view(null, true);
    expect(screen.getByText('Checking your plan…')).toBeInTheDocument();
  });

  it('shows nothing but its title when idle with no answer', () => {
    view(null, false);
    expect(screen.getByRole('heading', { name: 'Your plan so far' })).toBeInTheDocument();
    expect(screen.queryByText('Checking your plan…')).not.toBeInTheDocument();
  });

  it('says "1 credit" and "1 more credit" in the singular', () => {
    view({ ...answer('1'), requirements: [req('open-electives', 'Open electives', 'Open electives', '1')] });
    expect(screen.getByText('1 credit left for graduation')).toBeInTheDocument();
    expect(screen.getByText('Open electives: 1 more credit needed')).toBeInTheDocument();
  });

  it('keeps the last numbers and says it is updating while a newer check is pending', () => {
    view({ ...answer('12'), requirements: [req('open-electives', 'Open electives', 'Open electives', '12')] }, true);
    expect(screen.getByText('12 credits left for graduation')).toBeInTheDocument();
    expect(screen.getByText('Updating…')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Your plan so far' })).toHaveAttribute('aria-busy', 'true');
  });

  it('lists a group once with its rows, and a requirement that is its own group on one line', () => {
    view({
      ...answer('20'),
      requirements: [req('hss-other', 'HSS electives', 'Humanities and Social Sciences', '8'), req('hs191', 'Introduction to Writing I', 'Humanities and Social Sciences', '4'), req('open-electives', 'Open electives', 'Open electives', '8')],
    });
    const list = screen.getByRole('list', { name: 'Credits still needed' });
    expect(list).toHaveTextContent('Humanities and Social Sciences');
    expect(list).toHaveTextContent('HSS electives: 8 more credits needed');
    expect(list).toHaveTextContent('Introduction to Writing I: 4 more credits needed');
    expect(list).toHaveTextContent('Open electives: 8 more credits needed');
    expect(screen.queryByText('Everything else is covered.')).not.toBeInTheDocument(); // no covered rows in this answer
  });
});
