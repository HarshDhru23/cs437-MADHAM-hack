import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAnalysis, useRecord } from '../../api/hooks';
import type { CourseAttempt, Issue, PerformanceValue } from '../../api/types';
import { RECORD_TABS, SubNav } from '../../app/AppShell';
import { usePublishView } from '../../app/viewContext';
import { IssueList, studentMessage, visibleIssues } from '../../components/IssueList';
import { ErrorPanel, StatePanel } from '../../components/StatePanel';
import { Badge } from '../../components/StatusBadge';
import { formatCredits, formatTerm, humanize } from '../../lib/format';
import { SpiSparkline } from './SpiSparkline';
import './performance.css';

/** A value that could not be calculated shows a dash, never 0. */
const amount = (value: string | null | undefined) => (value === null || value === undefined ? '—' : formatCredits(value));

/** CPI and SPI as calculated for the student's record. The browser never applies a grade formula. */
export function PerformancePage() {
  const record = useRecord();
  const hasHistory = Boolean(record.data && record.data.attempts.length > 0);
  const analysis = useAnalysis(hasHistory ? record.data : null, null);
  const [open, setOpen] = useState<string | null>(null);
  const attempts = useMemo(() => new Map((record.data?.attempts ?? []).map((a) => [a.id, a])), [record.data]);
  usePublishView({ dataMode: 'actual' });

  const header = (
    <>
      <SubNav label="My record" items={RECORD_TABS} />
      <h1>Performance (CPI and SPI)</h1>
    </>
  );
  if (record.loading || (hasHistory && analysis.loading)) return <>{header}<StatePanel kind="loading" title="Loading performance…" /></>;
  if (record.error) return <>{header}<ErrorPanel error={record.error} onRetry={record.reload} /></>;
  if (!hasHistory)
    return (
      <>
        {header}
        <StatePanel kind="empty" title="No graded attempts yet" detail="Import your transcript or IMS grades to see CPI and SPI." action={<Link to="/record/import">Import</Link>} />
      </>
    );
  if (analysis.error || !analysis.data) return <>{header}{analysis.error ? <ErrorPanel error={analysis.error} onRetry={analysis.reload} /> : null}</>;

  const perf = analysis.data.performance;
  const allIssues: Issue[] = analysis.issues.length > 0 ? analysis.issues : (perf.issues ?? []);
  const performanceIssues = visibleIssues(allIssues.filter((i) => /ROUNDING|GRADING|POLICY|REPEAT|PERFORMANCE/.test(i.code)));
  const cumulative = perf.cumulative;
  const reason = (value: PerformanceValue) => unavailableReason(value, performanceIssues);

  return (
    <div>
      {header}
      <section className="panel" aria-label="Cumulative CPI">
        <div className="panel-row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Cumulative CPI</h2>
          {cumulative.hypothetical ? (
            <Badge tone="scenario" symbol="⚑">
              Scenario — hypothetical grades
            </Badge>
          ) : null}
        </div>
        <dl className="perf-tiles">
          <div className="perf-cpi">
            <dt>CPI</dt>
            <dd>
              {cumulative.display_value ?? '—'}
              {cumulative.display_value === null ? <small>{reason(cumulative)}</small> : null}
            </dd>
          </div>
          <div>
            <dt>Grade points</dt>
            <dd>{amount(cumulative.grade_points)}</dd>
          </div>
          <div>
            <dt>Graded credits</dt>
            <dd>{amount(cumulative.performance_credits)}</dd>
          </div>
        </dl>
        <p className="muted">Only graded courses count towards CPI. Pass (P) grades and zero-credit courses are left out, so graded credits are fewer than your total credits.</p>
        <AttemptDetails value={cumulative} attempts={attempts} label="Attempts counted in CPI" />
      </section>

      <section className="panel perf-table" aria-label="Per-term SPI">
        <h2>Per-term SPI</h2>
        <SpiSparkline terms={perf.terms} />
        <div className="table-wrap">
          <table className="data stack-mobile">
            <caption>Term SPI</caption>
            <thead>
              <tr>
                <th scope="col">Term</th>
                <th scope="col" className="num">SPI</th>
                <th scope="col" className="num">Grade points</th>
                <th scope="col" className="num">Graded credits</th>
                <th scope="col">Details</th>
              </tr>
            </thead>
            <tbody>
              {perf.terms.map((t) => (
                <Fragment key={t.term_id}>
                  <tr>
                    <th scope="row" data-label="Term">
                      {formatTerm(t.term_id)}
                    </th>
                    <td className="num" data-label="SPI">
                      {t.display_value ?? (
                        <>
                          — <span className="muted">{reason(t)}</span>
                        </>
                      )}
                    </td>
                    <td className="num" data-label="Grade points">{amount(t.grade_points)}</td>
                    <td className="num" data-label="Graded credits">{amount(t.performance_credits)}</td>
                    <td data-label="Details">
                      <button type="button" className="btn btn-small" aria-expanded={open === t.term_id} aria-label={`Attempts for ${formatTerm(t.term_id)}`} onClick={() => setOpen(open === t.term_id ? null : t.term_id)}>
                        Attempts
                      </button>
                    </td>
                  </tr>
                  {open === t.term_id ? (
                    <tr>
                      <td colSpan={5}>
                        <section aria-label={`Attempts in ${formatTerm(t.term_id)}`}>
                          <AttemptDetails value={t} attempts={attempts} label={`Attempts in ${formatTerm(t.term_id)}`} />
                        </section>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {performanceIssues.length > 0 ? (
        <section className="panel" aria-label="Performance notes">
          <h2>Things to check</h2>
          <IssueList issues={performanceIssues} />
        </section>
      ) : null}
    </div>
  );
}

function unavailableReason(value: PerformanceValue, issues: Issue[]): string {
  if (value.performance_credits === '0' || value.unrounded_value === null) return 'No graded credits in this period.';
  const first = visibleIssues(value.issues)[0] ?? visibleIssues(issues)[0];
  return first ? studentMessage(first) : 'Not available.';
}

function AttemptDetails({ value, attempts, label }: { value: PerformanceValue; attempts: Map<string, CourseAttempt>; label: string }) {
  return (
    <details>
      <summary>{label}</summary>
      <h4>Included</h4>
      {value.contributing_attempts.length === 0 ? (
        <p className="muted">None.</p>
      ) : (
        <ul>
          {value.contributing_attempts.map((c) => (
            <li key={c.attempt_id}>
              <span className="mono">{attempts.get(c.attempt_id)?.normalized_code ?? c.attempt_id}</span> · grade {c.grade} · {formatCredits(c.credits)} credits ·{' '}
              {formatCredits(c.grade_points)} points
            </li>
          ))}
        </ul>
      )}
      <h4>Excluded</h4>
      {value.excluded_attempts.length === 0 ? (
        <p className="muted">None.</p>
      ) : (
        <ul>
          {value.excluded_attempts.map((e) => (
            <li key={e.attempt_id}>
              <span className="mono">{attempts.get(e.attempt_id)?.normalized_code ?? e.attempt_id}</span> — {humanize(e.reason)}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
