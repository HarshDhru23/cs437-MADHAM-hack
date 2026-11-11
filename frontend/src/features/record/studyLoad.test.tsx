/**
 * CP-44: on the Record page a student says whether their standing is regular or GPS and, optionally, the credit limit their advisor set (1 to 28
 * whole credits). The page sends only those two profile fields, with the record's current revision, and says plainly when it could not save.
 * No decision numbers or developer words appear on the page.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { AcademicRecord, RecordPatch } from '../../api/types';
import { record } from '../../test/fixtures';
import { fakeApi, issue, renderApp } from '../../test/harness';
import { RecordPage } from './RecordPage';

function server(initial: AcademicRecord = record, options: { conflict?: boolean; fail?: boolean } = {}) {
  let current = structuredClone(initial);
  const patches: RecordPatch[] = [];
  const api = fakeApi({
    'GET /record': () => ({ data: current }),
    'PATCH /record': (req) => {
      const body = req.body as RecordPatch;
      patches.push(body);
      if (options.fail) return { status: 500, data: null, issues: [issue('SERVER_ERROR', 'error')] };
      if (options.conflict || body.expected_revision !== current.revision) {
        options.conflict = false;
        return { status: 409, data: { current_revision: current.revision + 1, action: 'reload_compare' }, issues: [issue('REVISION_CONFLICT', 'error')] };
      }
      current = { ...current, revision: current.revision + 1, ...(body.profile ? { profile: body.profile } : {}) };
      return { data: current };
    },
  });
  return { ...api, patches, get current() { return current; } };
}

const open = async (s: ReturnType<typeof server>) => {
  renderApp(<RecordPage />, { fetchImpl: s.fetchImpl });
  const section = await screen.findByRole('region', { name: 'Study load' });
  return {
    section,
    regular: within(section).getByRole('radio', { name: 'Regular' }),
    gps: within(section).getByRole('radio', { name: 'GPS' }),
    cap: within(section).getByRole('textbox', { name: /Credit limit set by my advisor/ }),
    save: within(section).getByRole('button', { name: 'Save study load' }),
  };
};

describe('Study load on the Record page (CP-44)', () => {
  it('starts as regular standing with no advisor limit, and nothing to save', async () => {
    const { regular, gps, cap, save } = await open(server());
    expect(regular).toBeChecked();
    expect(gps).not.toBeChecked();
    expect(cap).toHaveValue('');
    expect(save).toBeDisabled();
  });

  it('shows what the student declared before', async () => {
    const declared = { ...record, profile: { ...record.profile, standing: 'GPS', advisor_cap: '24' } };
    const { regular, gps, cap } = await open(server(declared));
    expect(gps).toBeChecked();
    expect(regular).not.toBeChecked();
    expect(cap).toHaveValue('24');
  });

  it('saves GPS and a limit of 24 with the current revision, changing only those two profile fields', async () => {
    const s = server();
    const { gps, cap, save, section } = await open(s);
    const user = userEvent.setup();
    await user.click(gps);
    await user.type(cap, '24');
    await user.click(save);
    await waitFor(() => expect(s.patches).toHaveLength(1));
    expect(s.patches[0]).toEqual({ expected_revision: record.revision, profile: { ...record.profile, standing: 'GPS', advisor_cap: '24' } });
    expect(await within(section).findByRole('status')).toHaveTextContent('Saved');
    expect(s.current.profile.advisor_cap).toBe('24');
  });

  it('leaves the limit out of the profile when the student clears it', async () => {
    const declared = { ...record, profile: { ...record.profile, standing: 'normal', advisor_cap: '24' } };
    const s = server(declared);
    const { cap, save } = await open(s);
    const user = userEvent.setup();
    await user.clear(cap);
    await user.click(save);
    await waitFor(() => expect(s.patches).toHaveLength(1));
    expect(s.patches[0]!.profile).toEqual({ ...record.profile, standing: 'normal' });
    expect(s.patches[0]!.profile).not.toHaveProperty('advisor_cap');
  });

  it('refuses a limit that is not a whole number from 1 to 28 and sends nothing', async () => {
    const s = server();
    const { cap, save, section } = await open(s);
    const user = userEvent.setup();
    for (const bad of ['0', '29', '24.5', '-4', 'abc', '2 4']) {
      await user.clear(cap);
      await user.type(cap, bad);
      await user.click(save);
      expect(await within(section).findByRole('alert')).toHaveTextContent(/whole number from 1 to 28/);
    }
    expect(s.patches).toHaveLength(0);
  });

  it('accepts the two ends of the range', async () => {
    const s = server();
    const { cap, save, section } = await open(s);
    const user = userEvent.setup();
    for (const ok of ['1', '28']) {
      await user.clear(cap);
      await user.type(cap, ok);
      await user.click(save);
      await waitFor(() => expect(s.patches.at(-1)?.profile?.advisor_cap).toBe(ok));
      await within(section).findByRole('status');   // the page has taken the saved record before the next edit starts
      await waitFor(() => expect(save).toBeDisabled());
    }
  });

  it('says the record changed elsewhere on a conflict, saves nothing, and offers to reload', async () => {
    const s = server(record, { conflict: true });
    const { gps, save, section } = await open(s);
    const user = userEvent.setup();
    await user.click(gps);
    await user.click(save);
    expect(await within(section).findByRole('alert')).toHaveTextContent(/changed somewhere else/);
    expect(within(section).queryByRole('status')).not.toBeInTheDocument();
    expect(within(section).getByRole('button', { name: 'Reload my record' })).toBeInTheDocument();
    expect(s.current.profile.standing).not.toBe('GPS');
  });

  it('says plainly when the save fails, without developer words', async () => {
    const s = server(record, { fail: true });
    const { gps, save, section } = await open(s);
    const user = userEvent.setup();
    await user.click(gps);
    await user.click(save);
    const alert = await within(section).findByRole('alert');
    expect(alert).toHaveTextContent(/could not be saved/);
    expect(alert.textContent).not.toMatch(/SERVER_ERROR|500|revision/i);
  });

  it('explains that the limit applies to saved plans and drafts keep 28, with no decision numbers', async () => {
    const { section } = await open(server());
    expect(section).toHaveTextContent(/when you save a plan/i);
    expect(section).toHaveTextContent(/draft you are still editing always uses 28 credits/);
    expect(section.textContent).not.toMatch(/\bD-\d\d\b|revision|server|[A-Z]{3,}_[A-Z_]{3,}/);
  });
});
