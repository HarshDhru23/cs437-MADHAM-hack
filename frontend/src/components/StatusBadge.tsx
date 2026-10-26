import type { RequirementStatus, Severity } from '../api/types';

type Tone = 'success' | 'warning' | 'danger' | 'unknown' | 'neutral' | 'scenario';

export function Badge({ tone, symbol, children }: { tone: Tone; symbol?: string; children: React.ReactNode }) {
  return (
    <span className={`badge badge-${tone}`}>
      {symbol ? <span aria-hidden="true">{symbol}</span> : null}
      {children}
    </span>
  );
}

const REQUIREMENT: Record<RequirementStatus, { tone: Tone; symbol: string; label: string }> = {
  satisfied: { tone: 'success', symbol: '✓', label: 'Satisfied' },
  pending: { tone: 'warning', symbol: '○', label: 'Pending' },
  conditional: { tone: 'scenario', symbol: '◐', label: 'Conditional' },
  needs_review: { tone: 'unknown', symbol: '?', label: 'Needs review' },
};

export function RequirementStatusBadge({ status }: { status: RequirementStatus }) {
  const meta = REQUIREMENT[status];
  if (!meta) return <Badge tone="unknown" symbol="?">{`Unknown status (${String(status)})`}</Badge>;
  return (
    <Badge tone={meta.tone} symbol={meta.symbol}>
      {meta.label}
    </Badge>
  );
}

const SEVERITY: Record<Severity, { tone: Tone; symbol: string; label: string }> = {
  error: { tone: 'danger', symbol: '✕', label: 'Error' },
  warning: { tone: 'warning', symbol: '!', label: 'Warning' },
  unknown: { tone: 'unknown', symbol: '?', label: 'Unknown' },
  approval_required: { tone: 'scenario', symbol: '⚑', label: 'Approval required' },
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  const meta = SEVERITY[severity] ?? SEVERITY.unknown;
  return (
    <Badge tone={meta.tone} symbol={meta.symbol}>
      {meta.label}
    </Badge>
  );
}

/** Generic evidence status (eligibility/offering/meeting check) without implying success. */
export function EvidenceBadge({ value }: { value: string | null | undefined }) {
  const v = value ?? 'unknown';
  const map: Record<string, { tone: Tone; symbol: string; label: string }> = {
    eligible: { tone: 'success', symbol: '✓', label: 'Eligible' },
    ineligible: { tone: 'danger', symbol: '✕', label: 'Not eligible' },
    conditional: { tone: 'scenario', symbol: '◐', label: 'Conditional' },
    unknown: { tone: 'unknown', symbol: '?', label: 'Unknown' },
    clear: { tone: 'success', symbol: '✓', label: 'No clash found' },
    conflicts: { tone: 'danger', symbol: '✕', label: 'Clash' },
    not_checked: { tone: 'unknown', symbol: '?', label: 'Not checked' },
    confirmed_in_snapshot: { tone: 'success', symbol: '✓', label: 'In supplied snapshot' },
    tentative: { tone: 'warning', symbol: '~', label: 'Tentative' },
    historical: { tone: 'neutral', symbol: '↺', label: 'Historical hint' },
  };
  const meta = map[v] ?? { tone: 'unknown' as Tone, symbol: '?', label: v };
  return (
    <Badge tone={meta.tone} symbol={meta.symbol}>
      {meta.label}
    </Badge>
  );
}
