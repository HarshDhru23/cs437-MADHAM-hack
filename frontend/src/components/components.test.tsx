import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Issue } from '../api/types';
import { ConfirmDialog } from './ConfirmDialog';
import { CreditProgress } from './CreditProgress';
import { DataTable } from './DataTable';
import { IssueList } from './IssueList';
import { SaveStatusIndicator } from './SaveStatusIndicator';
import { SourcePanel } from './SourcePanel';
import { StatePanel } from './StatePanel';
import { PreparationBadge } from './StatusBadge';
import { RequirementStatusBadge, SeverityBadge } from './StatusBadge';
import { Tabs } from './Tabs';
import { CoursePicker } from './CoursePicker';

const issue = (code: string, severity: Issue['severity'], entity_refs: string[] = []): Issue => ({
  code,
  severity,
  message: `${code} message`,
  entity_refs,
  source_refs: ['committed-roadmap'],
  suggested_action: `${code} action`,
});

describe('status badges', () => {
  it.each([
    ['satisfied', 'Satisfied'],
    ['pending', 'Pending'],
    ['conditional', 'Conditional'],
    ['needs_review', 'Needs review'],
  ] as const)('requirement %s has a text label, not colour alone', (status, label) => {
    render(<RequirementStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('an unrecognised status is shown as unknown, never as satisfied', () => {
    render(<RequirementStatusBadge status={'mystery' as never} />);
    expect(screen.getByText(/Unknown status/)).toBeInTheDocument();
    expect(screen.queryByText('Satisfied')).not.toBeInTheDocument();
  });

  it.each([
    ['error', 'Error'],
    ['warning', 'Warning'],
    ['unknown', 'Unknown'],
    ['approval_required', 'Approval required'],
  ] as const)('severity %s is labelled', (severity, label) => {
    render(<SeverityBadge severity={severity} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

describe('IssueList', () => {
  it('groups issues by severity with code, message and suggested action', () => {
    render(<IssueList issues={[issue('DUPLICATE_COURSE', 'error'), issue('PREREQUISITE_MISSING', 'warning'), issue('OFFERING_UNKNOWN', 'unknown')]} />);
    const groups = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(groups).toEqual(['Errors (1)', 'Warnings (1)', 'Unknown (1)']);
    expect(screen.getByText('PREREQUISITE_MISSING message')).toBeInTheDocument();
    expect(screen.getByText(/PREREQUISITE_MISSING action/)).toBeInTheDocument();
  });

  it('lets the student select an issue to highlight affected items', async () => {
    const onSelect = vi.fn();
    render(<IssueList issues={[issue('PREREQUISITE_MISSING', 'warning', ['item-1'])]} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: /Show affected items/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ code: 'PREREQUISITE_MISSING', entity_refs: ['item-1'] }));
  });

  it('renders an explicit empty message', () => {
    render(<IssueList issues={[]} emptyMessage="No issues reported by the server." />);
    expect(screen.getByText('No issues reported by the server.')).toBeInTheDocument();
  });
});

describe('CreditProgress', () => {
  it('shows server counted/required strings', () => {
    render(<CreditProgress label="CSE core" counted="8" required="36" />);
    expect(screen.getByText('8 of 36 credits')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'CSE core' })).toHaveAttribute('aria-valuetext', '8 of 36 credits');
  });

  it('does not draw a healthy bar when the counted value is unknown', () => {
    render(<CreditProgress label="Electives" counted={null} required="26" />);
    expect(screen.getByText('Unknown of 26 credits')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});

describe('DataTable', () => {
  it('uses real headers and labels each cell for stacked mobile layout', () => {
    render(
      <DataTable
        caption="Attempts"
        columns={[
          { key: 'code', header: 'Code', rowHeader: true, render: (r: { code: string; credits: string }) => r.code },
          { key: 'credits', header: 'Credits', numeric: true, render: (r) => r.credits },
        ]}
        rows={[{ code: 'ZZ 101', credits: '4' }]}
        rowKey={(r) => r.code}
      />,
    );
    const table = screen.getByRole('table', { name: 'Attempts' });
    expect(within(table).getByRole('columnheader', { name: 'Code' })).toBeInTheDocument();
    expect(within(table).getByRole('rowheader', { name: 'ZZ 101' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: '4' })).toHaveAttribute('data-label', 'Credits');
  });

  it('shows an empty message instead of an empty table', () => {
    render(<DataTable caption="Attempts" columns={[]} rows={[]} rowKey={() => ''} empty="No attempts yet." />);
    expect(screen.getByText('No attempts yet.')).toBeInTheDocument();
  });
});

describe('StatePanel', () => {
  it('announces loading politely and errors assertively', () => {
    const { rerender } = render(<StatePanel kind="loading" title="Loading record" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading record');
    rerender(<StatePanel kind="error" title="Could not load" detail="Server unavailable" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Server unavailable');
  });
});

describe('SaveStatusIndicator', () => {
  it.each([
    ['pending', 'Unsaved changes'],
    ['saving', 'Saving…'],
    ['saved', 'Saved'],
    ['offline', 'Offline — changes kept on this device only'],
    ['error', 'Save failed — changes not saved'],
    ['conflict', 'Conflict — saved elsewhere'],
  ] as const)('%s is described in words', (status, text) => {
    render(<SaveStatusIndicator status={status} revision={3} />);
    expect(screen.getByRole('status')).toHaveTextContent(text);
  });
});

describe('Tabs', () => {
  it('supports arrow-key navigation between equal tabs', async () => {
    render(
      <Tabs
        label="Import method"
        tabs={[
          { id: 'pdf', label: 'Upload transcript PDF', content: <p>pdf panel</p> },
          { id: 'ims', label: 'Paste IMS grades', content: <p>ims panel</p> },
        ]}
      />,
    );
    const first = screen.getByRole('tab', { name: 'Upload transcript PDF' });
    expect(first).toHaveAttribute('aria-selected', 'true');
    first.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Paste IMS grades' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('ims panel');
  });
});

describe('ConfirmDialog', () => {
  it('requires an explicit confirm and can be cancelled', async () => {
    const onConfirm = vi.fn();
    function Host() {
      const [open, setOpen] = useState(true);
      return (
        <ConfirmDialog open={open} title="Remove course?" confirmLabel="Remove" onConfirm={onConfirm} onCancel={() => setOpen(false)}>
          This removes ZZ 101 from the plan.
        </ConfirmDialog>
      );
    }
    render(<Host />);
    expect(screen.getByRole('dialog', { name: 'Remove course?' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('SourcePanel', () => {
  it('shows row-level source evidence', () => {
    render(<SourcePanel title="Source" refs={[{ id: 'ims-v1', line: 7, raw: '2025-26 Semester II\tZZ 203\tSynthetic\t4\tA' }]} />);
    expect(screen.getByText(/ims-v1/)).toBeInTheDocument();
    expect(screen.getByText(/Line 7/)).toBeInTheDocument();
    expect(screen.getByText(/ZZ 203/)).toBeInTheDocument();
  });
});

describe('CoursePicker', () => {
  it('states that no reviewed catalogue exists and labels manual entries as unverified', async () => {
    const onPick = vi.fn();
    render(<CoursePicker courses={[]} coverage="unknown" onPick={onPick} />);
    expect(screen.getByText(/No reviewed catalogue/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Course code'), 'ZZ 330');
    await userEvent.type(screen.getByLabelText(/Credits/), '4');
    await userEvent.click(screen.getByRole('button', { name: 'Add course' }));
    expect(onPick).toHaveBeenCalledWith({ normalized_code: 'ZZ 330', credits: '4', fromCatalogue: false });
  });

  it('searches catalogue courses by code, title, basket or department', async () => {
    const onPick = vi.fn();
    render(
      <CoursePicker
        coverage="partial"
        onPick={onPick}
        courses={[
          { id: 'c1', normalized_code: 'ZZ 330', title: 'Synthetic Systems', credits: '4', department: 'ZZ', baskets: ['systems'] },
          { id: 'c2', normalized_code: 'YY 101', title: 'Synthetic Writing', credits: '2', department: 'YY', baskets: ['hss'] },
        ]}
      />,
    );
    await userEvent.type(screen.getByRole('searchbox', { name: /Search courses/ }), 'writing');
    expect(screen.getByText('YY 101')).toBeInTheDocument();
    expect(screen.queryByText('ZZ 330')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add YY 101' }));
    expect(onPick).toHaveBeenCalledWith({ normalized_code: 'YY 101', credits: '2', fromCatalogue: true, course_version_id: 'c2' });
  });

  it('rejects a malformed manual credit value without guessing', async () => {
    const onPick = vi.fn();
    render(<CoursePicker courses={[]} coverage="unknown" onPick={onPick} />);
    await userEvent.type(screen.getByLabelText('Course code'), 'ZZ 330');
    await userEvent.type(screen.getByLabelText(/Credits/), 'four');
    await userEvent.click(screen.getByRole('button', { name: 'Add course' }));
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByText(/Enter credits as a number/)).toBeInTheDocument();
  });
});

describe('PreparationBadge (D-17 recommended preparation)', () => {
  it('shows missing preparation as a warning, never a red "not eligible"', () => {
    const { container } = render(<PreparationBadge value="ineligible" />);
    expect(screen.getByText('Recommended preparation missing')).toBeInTheDocument();
    expect(container.querySelector('.badge-warning')).not.toBeNull();
    expect(container.querySelector('.badge-danger')).toBeNull();
    expect(container).not.toHaveTextContent(/not eligible|✕/i);
  });

  it('keeps an unlisted course unknown, not "none needed"', () => {
    render(<PreparationBadge value="unknown" />);
    expect(screen.getByText('No recommendation recorded')).toBeInTheDocument();
  });
});
