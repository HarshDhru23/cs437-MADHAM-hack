import type { ReactNode } from 'react';
import type { InternshipCase, InternshipEvaluation, Issue, Scenario, ScenarioComparison, ScenarioEvaluation } from '../../api/types';
import { IssueList } from '../../components/IssueList';
import { EvidenceBadge } from '../../components/StatusBadge';
import { compareTerms, formatCredits, formatTerm, humanize } from '../../lib/format';
import { describeChange, durationLabel, examOverlapText, exclusiveToInclusive, formatDate, itemCode, orUnavailable, type PlanItem } from './model';

interface CompareViewProps {
  comparisons: ScenarioComparison[];
  cases: InternshipCase[];
  scenarios: Scenario[];
  items: PlanItem[];
  stale: boolean;
}

const list = (values: ReactNode[], empty: string): ReactNode =>
  values.length === 0 ? <span className="muted">{empty}</span> : values.length === 1 ? values[0] : (
    <ul className="cell-list">
      {values.map((v, i) => (
        <li key={i}>{v}</li>
      ))}
    </ul>
  );

const REQUIREMENT_STATUS: Record<string, string> = { satisfied: 'Satisfied', pending: 'Pending', conditional: 'Conditional', needs_review: 'Needs review' };
const statusText = (s: string) => REQUIREMENT_STATUS[s] ?? `Unrecognised status (${s})`;

function termsAway(stay: InternshipEvaluation | null | undefined): ReactNode {
  if (!stay) return 'No internship';
  if (stay.duration_choice === 'none') return 'None (no internship)';
  if (stay.overlapping_terms.length > 0)
    return list(
      stay.overlapping_terms.map((t) => `${formatTerm(t.term_id)}: ${orUnavailable(t.overlap_days, (v) => `${v} days`)}${examOverlapText(t.exam_overlap)}`),
      'None',
    );
  if ((stay.issues ?? []).some((i) => i.code === 'CALENDAR_MISSING')) return 'Unavailable (no academic calendar)';
  if (!stay.start_date || !stay.end_date_exclusive) return 'Unavailable (no exact dates)';
  return 'None found';
}

function workload(evaluation: ScenarioEvaluation | null): ReactNode {
  const w = evaluation?.validation?.workload;
  if (!w) return 'Unavailable';
  const terms = Object.keys(w).sort(compareTerms);
  return list(
    terms.map((t) => `${formatTerm(t)}: ${orUnavailable(w[t]?.target_credits, formatCredits)}`),
    'No planned terms',
  );
}

function issuesMatching(evaluation: ScenarioEvaluation | null, test: (i: Issue) => boolean): ReactNode {
  if (!evaluation) return 'Unavailable';
  const found = evaluation.issues.filter(test);
  return found.length === 0 ? 'None reported' : list(found.map((i) => `${i.code}: ${i.message}`), 'None reported');
}

function cpi(evaluation: ScenarioEvaluation | null, hypothetical: boolean): ReactNode {
  const value = evaluation?.performance?.cumulative;
  if (!value) return 'Unavailable';
  const label = hypothetical ? ' (hypothetical)' : '';
  if (value.display_value) return `${value.display_value}${label}`;
  return (
    <>
      Unavailable{label}
      {value.unrounded_value ? <small className="muted"> — unrounded server value {value.unrounded_value}; no official rounding policy</small> : null}
    </>
  );
}

function credit(stay: InternshipEvaluation | null | undefined, key: 'earned' | 'approved' | 'proposed'): string {
  if (!stay) return 'No internship';
  return orUnavailable(stay.credits?.[key], formatCredits);
}

/** Baseline vs scenario table, and the server's internship cases. Every value comes from the server. */
export function CompareView({ comparisons, cases, scenarios, items, stale }: CompareViewProps) {
  const label = (id: string) => scenarios.find((s) => s.id === id)?.label || 'Untitled scenario';
  const current = comparisons.filter((c) => !c.stale && c.scenario);
  const staleOnes = comparisons.filter((c) => c.stale);
  const baseline = current[0]?.baseline ?? null;
  const codes = (ids: string[]) => ids.map((id) => itemCode(items, id));

  type Row = { key: string; label: string; baseline: ReactNode; cell: (c: ScenarioComparison) => ReactNode };
  const rows: Row[] = [
    { key: 'away', label: 'Terms away (internship)', baseline: 'No internship', cell: (c) => termsAway(c.scenario?.internship) },
    {
      key: 'affected',
      label: 'Affected courses',
      baseline: 'No hypothetical changes',
      cell: (c) => {
        const s = scenarios.find((x) => x.id === c.scenario_id);
        const stay = c.scenario?.internship;
        return list(
          [
            ...(s?.changes ?? []).map((ch) => describeChange(ch, items)),
            ...(stay?.affected_courses.length ? [`Overlap the internship: ${codes(stay.affected_courses).join(', ')}`] : []),
            ...(stay?.downstream_courses.length ? [`Rely on overlapped courses: ${codes(stay.downstream_courses).join(', ')}`] : []),
            ...(c.deltas?.downstream_affected.length ? [`Recommended preparation now missing: ${codes(c.deltas.downstream_affected).join(', ')}`] : []),
          ],
          'None',
        );
      },
    },
    { key: 'workload', label: 'Workload (target credits per term, server)', baseline: workload(baseline), cell: (c) => workload(c.scenario) },
    { key: 'earned', label: 'Exposure credits earned (actual)', baseline: credit(null, 'earned'), cell: (c) => credit(c.scenario?.internship, 'earned') },
    { key: 'approved', label: 'Exposure credits approved', baseline: credit(null, 'approved'), cell: (c) => credit(c.scenario?.internship, 'approved') },
    { key: 'proposed', label: 'Exposure credits proposed (pending approval)', baseline: credit(null, 'proposed'), cell: (c) => credit(c.scenario?.internship, 'proposed') },
    {
      key: 'deficits',
      label: 'Requirement deficits that change',
      baseline: list(
        (current[0]?.deltas?.requirements ?? []).map((r) => `${r.label ?? r.id}: ${statusText(r.baseline.status)}, ${orUnavailable(r.baseline.remaining_credits, formatCredits)} credits remaining`),
        'Baseline values appear beside each changed requirement',
      ),
      cell: (c) =>
        c.deltas
          ? list(
              c.deltas.requirements.map((r) => `${r.label ?? r.id}: ${statusText(r.scenario.status)}, ${orUnavailable(r.scenario.remaining_credits, formatCredits)} credits remaining (baseline ${statusText(r.baseline.status)}, ${orUnavailable(r.baseline.remaining_credits, formatCredits)})`),
              'No requirement changed',
            )
          : 'Unavailable',
    },
    {
      key: 'prereq',
      label: 'Recommended-preparation (prerequisite) issues',
      baseline: issuesMatching(baseline, (i) => i.code.startsWith('PREREQUISITE')),
      cell: (c) => issuesMatching(c.scenario, (i) => i.code.startsWith('PREREQUISITE')),
    },
    {
      key: 'clash',
      label: 'Timetable clash check',
      baseline: baseline ? <EvidenceBadge value={baseline.validation?.meeting_check_status} /> : 'Unavailable',
      cell: (c) => (c.scenario ? <EvidenceBadge value={c.scenario.validation?.meeting_check_status} /> : 'Unavailable'),
    },
    {
      key: 'clashes',
      label: 'Clash issues',
      baseline: issuesMatching(baseline, (i) => i.code === 'TIMETABLE_CONFLICT'),
      cell: (c) => issuesMatching(c.scenario, (i) => i.code === 'TIMETABLE_CONFLICT'),
    },
    { key: 'cpi', label: 'CPI (server)', baseline: cpi(baseline, false), cell: (c) => cpi(c.scenario, Boolean(c.scenario?.performance?.hypothetical)) },
    {
      key: 'completion',
      label: 'Completion term',
      baseline: orUnavailable(baseline?.validation?.completion_term ?? baseline?.completion_term, formatTerm),
      cell: (c) => orUnavailable(c.scenario?.validation?.completion_term ?? c.scenario?.completion_term, formatTerm),
    },
  ];

  return (
    <div aria-busy={stale || undefined} data-stale={stale || undefined}>
      {staleOnes.map((c) => (
        <div key={c.scenario_id} className="callout" data-tone="warning" role="alert">
          <strong>{label(c.scenario_id)}: baseline changed.</strong> {c.issues[0]?.message ?? 'The saved record, plan or rules changed after this scenario was created.'}{' '}
          It was not evaluated; rebase it on the current record and plan, then compare again.
        </div>
      ))}
      {current.length > 0 ? (
        <div className="table-wrap">
          <table className="data stack-mobile compare-table">
            <caption>Baseline vs scenario (server evaluation)</caption>
            <thead>
              <tr>
                <th scope="col">Measure</th>
                <th scope="col">Baseline (record r{current[0]!.baseline_record_revision}, plan r{current[0]!.baseline_plan_revision})</th>
                {current.map((c) => (
                  <th key={c.scenario_id} scope="col">
                    {label(c.scenario_id)} (hypothetical)
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <th scope="row">{r.label}</th>
                  <td data-label="Baseline">{r.baseline}</td>
                  {current.map((c) => (
                    <td key={c.scenario_id} data-label={label(c.scenario_id)}>
                      {r.cell(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {current.map((c) =>
        c.deltas && c.deltas.new_issues.length > 0 ? (
          <details key={c.scenario_id}>
            <summary>{`New issues in ${label(c.scenario_id)} (${c.deltas.new_issues.length})`}</summary>
            <IssueList issues={c.deltas.new_issues} headingLevel={4} />
          </details>
        ) : null,
      )}
      {cases.length > 0 ? <InternshipCasesTable cases={cases} label={label} items={items} /> : null}
    </div>
  );
}

function InternshipCasesTable({ cases, label, items }: { cases: InternshipCase[]; label: (id: string) => string; items: PlanItem[] }) {
  const codes = (ids: string[]) => (ids.length ? ids.map((id) => itemCode(items, id)).join(', ') : 'None');
  const rows: { key: string; label: string; cell: (c: InternshipCase) => ReactNode }[] = [
    {
      key: 'dates',
      label: 'Dates (last day inclusive)',
      cell: (c) => (c.start_date && c.end_date_exclusive ? `${formatDate(c.start_date)} to ${formatDate(exclusiveToInclusive(c.end_date_exclusive))}` : c.duration_choice === 'none' ? 'None' : 'Unavailable'),
    },
    { key: 'days', label: 'Actual duration (server)', cell: (c) => (c.duration_choice === 'none' ? 'None' : orUnavailable(c.actual_days, (v) => `${v} days`)) },
    {
      key: 'expected',
      label: 'Calendar-month end for this duration',
      cell: (c) => (c.duration_choice === 'none' ? 'None' : c.expected_end_date_exclusive ? formatDate(exclusiveToInclusive(c.expected_end_date_exclusive)) : 'Unavailable'),
    },
    { key: 'away', label: 'Terms away', cell: (c) => termsAway(c) },
    { key: 'affected', label: 'Affected courses', cell: (c) => codes(c.affected_courses) },
    { key: 'downstream', label: 'Downstream courses', cell: (c) => codes(c.downstream_courses) },
    { key: 'unchecked', label: 'Not checked', cell: (c) => codes(c.unchecked_courses) },
    { key: 'earned', label: 'Earned credits', cell: (c) => orUnavailable(c.credits?.earned, formatCredits) },
    { key: 'approved', label: 'Approved credits', cell: (c) => orUnavailable(c.approved_credits ?? c.credits?.approved, formatCredits) },
    { key: 'proposed', label: 'Proposed credits (pending approval)', cell: (c) => orUnavailable(c.credits?.proposed, formatCredits) },
    { key: 'assumptions', label: 'Completion assumptions', cell: (c) => list(c.completion_assumptions ?? [], 'None stated') },
    { key: 'issues', label: 'Issues', cell: (c) => list((c.issues ?? []).map((i) => humanize(i.code)), 'None reported') },
  ];
  return (
    <div className="table-wrap">
      <table className="data stack-mobile compare-table">
        <caption>Internship cases on the same baseline (server)</caption>
        <thead>
          <tr>
            <th scope="col">Measure</th>
            {cases.map((c) => (
              <th key={c.scenario_id} scope="col">
                {durationLabel(c.duration_choice)} — {label(c.scenario_id)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <th scope="row">{r.label}</th>
              {cases.map((c) => (
                <td key={c.scenario_id} data-label={`${durationLabel(c.duration_choice)} — ${label(c.scenario_id)}`}>
                  {r.cell(c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
