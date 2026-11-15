import type { Issue, Severity } from '../api/types';
import { plainMessage } from '../lib/format';
import { SeverityBadge } from './StatusBadge';

/** Notes (severity `info`) are never shown to students; the rest are shown as short plain sentences. */
const ORDER: { severity: Severity; heading: string }[] = [
  { severity: 'error', heading: 'Problems' },
  { severity: 'warning', heading: 'Warnings' },
  { severity: 'unknown', heading: 'To check' },
  { severity: 'approval_required', heading: 'Needs approval' },
];

interface IssueListProps {
  issues: Issue[];
  onSelect?: (issue: Issue) => void;
  emptyMessage?: string;
  /** Group by severity under headings (default) or render a flat list. */
  grouped?: boolean;
  headingLevel?: 3 | 4;
}

/** Issues whose server message is policy text, said to a student in plain words instead (by code). Anything not listed uses the cleaned server message. */
const STUDENT_WORDS: Record<string, string> = {
  ADDITIONAL_LEARNING_POLICY_UNKNOWN: 'Courses marked as additional learning (honours or minor) are not counted in your CPI here yet.',
};

/** An issue as a student reads it. */
export function studentMessage(entry: Issue): string {
  return STUDENT_WORDS[entry.code] ?? plainMessage(entry.message);
}

export function visibleIssues(issues: Issue[]): Issue[] {
  return issues.filter((i) => i.severity !== 'info');
}

export function IssueList({ issues: all, onSelect, emptyMessage = 'Nothing to check.', grouped = true, headingLevel = 3 }: IssueListProps) {
  const issues = visibleIssues(all);
  if (issues.length === 0) return <p className="muted">{emptyMessage}</p>;
  const H = `h${headingLevel}` as 'h3' | 'h4';
  const item = (entry: Issue, index: number) => (
    <li key={`${entry.code}-${index}`} data-severity={entry.severity}>
      <div className="issue-head">
        <SeverityBadge severity={entry.severity} />
      </div>
      <p>{studentMessage(entry)}</p>
      {onSelect && entry.entity_refs.length > 0 ? (
        <button type="button" className="btn btn-small" aria-label={`Show affected items: ${studentMessage(entry)}`} onClick={() => onSelect(entry)}>
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
