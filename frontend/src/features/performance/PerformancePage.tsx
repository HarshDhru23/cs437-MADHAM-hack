import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAnalysis, useRecord } from '../../api/hooks';
import type { CourseAttempt, Issue, PerformanceValue } from '../../api/types';
import { RECORD_TABS, SubNav } from '../../app/AppShell';
import { usePublishView } from '../../app/viewContext';
import { IssueList } from '../../components/IssueList';
import { ErrorPanel, StatePanel } from '../../components/StatePanel';
import { Badge } from '../../components/StatusBadge';
import { formatCredits, formatTerm, humanize } from '../../lib/format';

/** Server-computed CPI/SPI only. The browser never applies a grade formula. */
export function PerformancePage() {
  const record = useRecord();
  const hasHistory = Boolean(record.data && record.data.attempts.length > 0);
  const analysis = useAnalysis(hasHistory ? record.data : null, null);
  const [open, setOpen] = useState<string | null>(null);
  const attempts = useMemo(() => new Map((record.data?.attempts ?? []).map((a) => [a.id, a])), [record.data]);
  usePublishView({ ruleVersion: analysis.data?.rule_version ?? null, dataMode: 'actual', recordRevision: record.data?.revision ?? null });

  const header = (
    <>
      <SubNav label="My record" items={RECORD_TABS} />
      <h1>Performance (CPI and SPI)</h1>
    </>
  );
  if (record.loading || (hasHistory && analysis.loading)) return <>{header}<StatePanel kind="loading" title="Loading performance from the server…" /></>;
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
  const performanceIssues = allIssues.filter((i) => /ROUNDING|GRADING|POLICY|REPEAT|PERFORMANCE/.test(i.code));
  const cumulative = perf.cumulative;
  const reason = (value: PerformanceValue) => unavailableReason(value, performanceIssues);
  // Values printed by the latest imported document, shown as-is beside the server's own values.
  const imported = perf.source_reported_controls?.at(-1) ?? null;
  const printed = (key: string) => {
    const value = imported?.controls[key];
    return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
  };
  const reportedCpi = cumulative.source_reported_value ?? printed('cpi');
  const reportedPoints = printed('grade_points');
  const reportedCredits = printed('performance_credits');

  return (
    <div>
      {header}
      <section className="panel" aria-label="Cumulative CPI">
        <div className="panel-row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Cumulative CPI</h2>
          <div className="panel-row">
            {cumulative.hypothetical ? (
              <Badge tone="scenario" symbol="⚑">
                Scenario — hypothetical grades
              </Badge>
            ) : (
              <Badge tone="neutral">Actual record</Badge>
            )}
            {cumulative.complete ? <Badge tone="success" symbol="✓">Policy complete</Badge> : <Badge tone="unknown" symbol="?">Policy incomplete</Badge>}
          </div>
        </div>
        <dl className="summary-grid">
          <div>
            <dt>CPI (server)</dt>
            <dd>
              {cumulative.display_value ?? 'Unavailable'}
              {cumulative.display_value === null ? <small>{reason(cumulative)}</small> : null}
            </dd>
          </div>
          <div>
            <dt>Grade points</dt>
            <dd>{formatCredits(cumulative.grade_points)}</dd>
          </div>
          <div>
            <dt>Performance credits (denominator)</dt>
            <dd>{formatCredits(cumulative.performance_credits)}</dd>
          </div>
          <div>
            <dt>Source-reported CPI</dt>
            <dd>
              {reportedCpi ?? <small>Not reported by your source</small>}
              {cumulative.source_reported_value === null && reportedCpi !== null && imported ? (
                <small>As printed in the document imported at record revision {imported.record_revision_at_import}; not recalculated.</small>
              ) : null}
            </dd>
          </div>
          {reportedPoints !== null || reportedCredits !== null ? (
            <div>
              <dt>Source-reported points / performance credits</dt>
              <dd>
                {reportedPoints ?? 'Not reported'} / {reportedCredits ?? 'Not reported'}
              </dd>
            </div>
          ) : null}
        </dl>
        {cumulative.display_value === null && cumulative.unrounded_value ? (
          <p className="muted">
            Exact unrounded server value: <span className="mono">{cumulative.unrounded_value}</span>. It is not rounded here because no reviewed rounding policy is
            available.
          </p>
        ) : null}
        <p className="muted">
          Performance credits count only graded attempts included by the policy (P and zero-credit attempts are excluded); they are not the total of all
          credits. Policy: <span className="mono">{cumulative.policy_id ?? 'not stated'}</span>.
        </p>
        <AttemptDetails value={cumulative} attempts={attempts} label="Attempts counted in CPI" />
      </section>

      <section className="panel" aria-label="Per-term SPI">
        <h2>Per-term SPI</h2>
        <div className="table-wrap">
          <table className="data stack-mobile">
            <caption>Term SPI</caption>
            <thead>
              <tr>
                <th scope="col">Term</th>
                <th scope="col" className="num">SPI (server)</th>
                <th scope="col" className="num">Grade points</th>
                <th scope="col" className="num">Performance credits</th>
                <th scope="col">Source-reported</th>
                <th scope="col">Details</th>
              </tr>
            </thead>
            <tbody>
              {perf.terms.map((t) => (
                <Fragment key={t.term_id}>
                  <tr>
                    <th scope="row" data-label="Term">
                      {formatTerm(t.term_id)}
                      {t.hypothetical ? <> <Badge tone="scenario">Scenario</Badge></> : null}
                    </th>
                    <td className="num" data-label="SPI (server)">
                      {t.display_value ?? (
                        <>
                          Unavailable <span className="muted">— {reason(t)}</span>
                        </>
                      )}
                    </td>
                    <td className="num" data-label="Grade points">{formatCredits(t.grade_points)}</td>
                    <td className="num" data-label="Performance credits">{formatCredits(t.performance_credits)}</td>
                    <td data-label="Source-reported">{t.source_reported_value ?? <span className="muted">Not reported</span>}</td>
                    <td data-label="Details">
                      <button type="button" className="btn btn-small" aria-expanded={open === t.term_id} aria-label={`Attempts for ${formatTerm(t.term_id)}`} onClick={() => setOpen(open === t.term_id ? null : t.term_id)}>
                        Attempts
                      </button>
                    </td>
                  </tr>
                  {open === t.term_id ? (
                    <tr>
                      <td colSpan={6}>
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

      <section className="panel" aria-label="Performance policy issues">
        <h2>Policy and source issues</h2>
        <IssueList issues={performanceIssues} emptyMessage="No performance policy issues reported." />
      </section>
    </div>
  );
}

function unavailableReason(value: PerformanceValue, issues: Issue[]): string {
  if (value.performance_credits === '0' || value.unrounded_value === null) return 'No graded performance credits in this period.';
  const rounding = issues.find((i) => i.code === 'ROUNDING_POLICY_UNKNOWN') ?? value.issues.find((i) => i.code === 'ROUNDING_POLICY_UNKNOWN');
  if (rounding) return rounding.message;
  const first = value.issues[0] ?? issues[0];
  return first ? first.message : 'The server did not provide a display value.';
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
