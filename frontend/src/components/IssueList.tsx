import type { Issue, Severity } from '../api/types';
import { SeverityBadge } from './StatusBadge';

const ORDER: { severity: Severity; heading: string }[] = [
  { severity: 'error', heading: 'Errors' },
  { severity: 'warning', heading: 'Warnings' },
  { severity: 'unknown', heading: 'Unknown' },
  { severity: 'approval_required', heading: 'Approval required' },
];

interface IssueListProps {
  issues: Issue[];
  onSelect?: (issue: Issue) => void;
  emptyMessage?: string;
  /** Group by severity under headings (default) or render a flat list. */
  grouped?: boolean;
  headingLevel?: 3 | 4;
}

export function IssueList({ issues, onSelect, emptyMessage = 'No issues reported.', grouped = true, headingLevel = 3 }: IssueListProps) {
  if (issues.length === 0) return <p className="muted">{emptyMessage}</p>;
  const H = `h${headingLevel}` as 'h3' | 'h4';
  const item = (entry: Issue, index: number) => (
    <li key={`${entry.code}-${index}`} data-severity={entry.severity}>
      <div className="issue-head">
        <SeverityBadge severity={entry.severity} />
        <span className="issue-code">{entry.code}</span>
      </div>
      <p>{entry.message}</p>
      {entry.suggested_action ? <p className="muted">Next step: {entry.suggested_action}</p> : null}
      {entry.source_refs.length > 0 ? <p className="muted">Source: {entry.source_refs.join(', ')}</p> : null}
      {onSelect && entry.entity_refs.length > 0 ? (
        <button type="button" className="btn btn-small" aria-label={`Show affected items for ${entry.code}`} onClick={() => onSelect(entry)}>
          Show affected items
        </button>
      ) : null}
    </li>
  );
  if (!grouped) return <ul className="issue-list">{issues.map(item)}</ul>;
  const known = new Set(ORDER.map((o) => o.severity));
  const groups = ORDER.map((o) => ({ ...o, items: issues.filter((i) => i.severity === o.severity) }));
  const other = issues.filter((i) => !known.has(i.severity));
  return (
    <div>
      {groups
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <section key={g.severity} aria-label={g.heading}>
            <H>{`${g.heading} (${g.items.length})`}</H>
            <ul className="issue-list">{g.items.map(item)}</ul>
          </section>
        ))}
      {other.length > 0 ? <ul className="issue-list">{other.map(item)}</ul> : null}
    </div>
  );
}
