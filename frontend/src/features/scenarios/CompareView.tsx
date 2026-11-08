import type { ReactNode } from 'react';
import type { InternshipCase, InternshipEvaluation, Issue, Scenario, ScenarioComparison, ScenarioEvaluation } from '../../api/types';
import { compareTerms, formatCredits, formatTerm } from '../../lib/format';
import { describeChange, durationLabel, examOverlapText, exclusiveToInclusive, formatDate, itemCode, orUnavailable, type PlanItem } from './model';
import { DiffBlock } from './DiffBlock';
import { ProblemList, problemCount } from './ProblemList';
import { problems, problemText } from './scenarioIssues';

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

const REQUIREMENT_STATUS: Record<string, string> = { satisfied: 'done', pending: 'still needed', conditional: 'done if you pass your planned courses', needs_review: 'to be checked' };
const statusText = (s: string) => REQUIREMENT_STATUS[s] ?? 'to be checked';

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

/** Each distinct problem once, in plain words, with the courses it affects (never one line per course or per meeting). */
function issuesMatching(evaluation: ScenarioEvaluation | null, items: PlanItem[], test: (i: Issue) => boolean): ReactNode {
  if (!evaluation) return '—';
  const found = problems(evaluation.issues, items, test);
  return found.length === 0 ? 'None' : list(found.map(problemText), 'None');
}

function cpi(evaluation: ScenarioEvaluation | null, hypothetical: boolean): ReactNode {
  const value = evaluation?.performance?.cumulative;
  if (!value) return 'Unavailable';
  const label = hypothetical ? ' (hypothetical)' : '';
  if (value.display_value) return `${value.display_value}${label}`;
  return (
    <>
      —{label}
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
  // Internship rows (time away, exposure credits) mean something only when a scenario in the table has an internship.
  const hasInternship = current.some((c) => c.scenario?.internship && c.scenario.internship.duration_choice !== 'none');

  type Row = { key: string; label: string; baseline: ReactNode; cell: (c: ScenarioComparison) => ReactNode };
  const allRows: (Row & { internship?: boolean })[] = [
    { key: 'away', internship: true, label: 'Terms away (internship)', baseline: 'No internship', cell: (c) => termsAway(c.scenario?.internship) },
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
    { key: 'workload', label: 'Credits per term', baseline: workload(baseline), cell: (c) => workload(c.scenario) },
    { key: 'earned', internship: true, label: 'Internship credits earned', baseline: credit(null, 'earned'), cell: (c) => credit(c.scenario?.internship, 'earned') },
    { key: 'approved', internship: true, label: 'Internship credits approved', baseline: credit(null, 'approved'), cell: (c) => credit(c.scenario?.internship, 'approved') },
    { key: 'proposed', internship: true, label: 'Internship credits proposed (waiting for approval)', baseline: credit(null, 'proposed'), cell: (c) => credit(c.scenario?.internship, 'proposed') },
    {
      key: 'deficits',
      label: 'Requirements that change',
      baseline: list(
        (current[0]?.deltas?.requirements ?? []).map((r) => `${r.label ?? r.id}: ${statusText(r.baseline.status)}, ${orUnavailable(r.baseline.remaining_credits, formatCredits)} credits left`),
        'No requirement changes',
      ),
      cell: (c) =>
        c.deltas
          ? list(
              c.deltas.requirements.map((r) => `${r.label ?? r.id}: ${statusText(r.scenario.status)}, ${orUnavailable(r.scenario.remaining_credits, formatCredits)} credits left (before: ${statusText(r.baseline.status)}, ${orUnavailable(r.baseline.remaining_credits, formatCredits)})`),
              'No requirement changed',
            )
          : '—',
    },
    {
      key: 'prereq',
      label: 'Recommended earlier courses',
      baseline: issuesMatching(baseline, items, (i) => i.code.startsWith('PREREQUISITE')),
      cell: (c) => issuesMatching(c.scenario, items, (i) => i.code.startsWith('PREREQUISITE')),
    },
    {
      key: 'clash',
      label: 'Timetable clashes',
      baseline: issuesMatching(baseline, items, (i) => i.code === 'TIMETABLE_CONFLICT'),
      cell: (c) => issuesMatching(c.scenario, items, (i) => i.code === 'TIMETABLE_CONFLICT'),
    },
    { key: 'cpi', label: 'CPI', baseline: cpi(baseline, false), cell: (c) => cpi(c.scenario, Boolean(c.scenario?.performance?.hypothetical)) },
    {
      key: 'completion',
      label: 'Completion term',
      baseline: orUnavailable(baseline?.validation?.completion_term ?? baseline?.completion_term, formatTerm),
      cell: (c) => orUnavailable(c.scenario?.validation?.completion_term ?? c.scenario?.completion_term, formatTerm),
    },
  ];
  const rows = allRows.filter((r) => hasInternship || !r.internship);

  return (
    <div aria-busy={stale || undefined} data-stale={stale || undefined}>
      {staleOnes.map((c) => (
        <div key={c.scenario_id} className="callout" data-tone="warning" role="alert">
          <strong>{label(c.scenario_id)}: baseline changed.</strong> {c.issues[0]?.message ?? 'The saved record or plan changed after this scenario was created.'}{' '}
          It was not evaluated; rebase it on the current record and plan, then compare again.
        </div>
      ))}
      {current.map((c) => (
        <DiffBlock key={c.scenario_id} comparison={c} scenario={scenarios.find((s) => s.id === c.scenario_id)} label={label(c.scenario_id)} items={items} />
      ))}
      {current.length > 0 ? (
        <div className="table-wrap">
          <table className="data stack-mobile compare-table">
            <caption>Baseline vs scenario</caption>
            <thead>
              <tr>
                <th scope="col">Measure</th>
                <th scope="col">Baseline</th>
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
        c.deltas && problemCount(c.deltas.new_issues, items) > 0 ? (
          <details key={c.scenario_id}>
            <summary>{`New problems in ${label(c.scenario_id)} (${problemCount(c.deltas.new_issues, items)})`}</summary>
            <ProblemList issues={c.deltas.new_issues} items={items} />
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
    { key: 'days', label: 'Actual duration', cell: (c) => (c.duration_choice === 'none' ? 'None' : orUnavailable(c.actual_days, (v) => `${v} days`)) },
    {
      key: 'expected',
      label: 'Calendar-month end for this duration',
      cell: (c) => (c.duration_choice === 'none' ? 'None' : c.expected_end_date_exclusive ? formatDate(exclusiveToInclusive(c.expected_end_date_exclusive)) : 'Unavailable'),
    },
    { key: 'away', label: 'Terms away', cell: (c) => termsAway(c) },
    { key: 'affected', label: 'Affected courses', cell: (c) => codes(c.affected_courses) },
    { key: 'downstream', label: 'Downstream courses', cell: (c) => codes(c.downstream_courses) },
    { key: 'unchecked', label: 'Could not be checked', cell: (c) => codes(c.unchecked_courses) },
    { key: 'earned', label: 'Earned credits', cell: (c) => orUnavailable(c.credits?.earned, formatCredits) },
    { key: 'approved', label: 'Approved credits', cell: (c) => orUnavailable(c.approved_credits ?? c.credits?.approved, formatCredits) },
    { key: 'proposed', label: 'Proposed credits (pending approval)', cell: (c) => orUnavailable(c.credits?.proposed, formatCredits) },
    { key: 'assumptions', label: 'Completion assumptions', cell: (c) => list(c.completion_assumptions ?? [], 'None stated') },
    { key: 'issues', label: 'Problems', cell: (c) => list(problems(c.issues, items).map(problemText), 'None') },
  ];
  return (
    <div className="table-wrap">
      <table className="data stack-mobile compare-table">
        <caption>Internship cases on the same baseline</caption>
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
