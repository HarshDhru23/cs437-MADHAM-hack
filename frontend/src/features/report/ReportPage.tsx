/**
 * /report/:plan_id[?scenario=<id>] — a printable view of the server's analysis
 * for one saved plan (A11, CP-30). Every academic number is a server value,
 * formatted only; this page never totals, allocates or decides a status.
 */
import { useMemo, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { accountEndpoints, endpoints } from '../../api/endpoints';
import { useAnalysis, useCurriculum, useRecord } from '../../api/hooks';
import { useResource } from '../../api/resources';
import type { AcademicPlan, Allocation, AuditResult, RequirementResult, Scenario } from '../../api/types';
import { useSession } from '../../app/session';
import { usePublishView } from '../../app/viewContext';
import { IssueList } from '../../components/IssueList';
import { SourcePanel } from '../../components/SourcePanel';
import { ErrorPanel, StatePanel } from '../../components/StatePanel';
import { RequirementStatusBadge } from '../../components/StatusBadge';
import { compareTerms, formatCredits, formatTerm, formatTimestamp, humanize } from '../../lib/format';
import { indexDefinitions, requirementLabel } from '../requirements/RequirementTree';
import './report.css';

type View = 'actual' | 'current' | 'projected';

const VIEWS: { view: View; title: string; meaning: string; ledger: keyof AuditResult }[] = [
  { view: 'actual', title: 'Actual completed history', meaning: 'Only accepted, completed attempts from your record.', ledger: 'ledger' },
  {
    view: 'current',
    title: 'Completed + confirmed current enrolment',
    meaning: 'Actual history plus courses you confirmed as current enrolment, counted as if they are passed. They are not completed yet.',
    ledger: 'current_ledger',
  },
  {
    view: 'projected',
    title: 'Projected with this plan',
    meaning: 'Adds every planned course as if it is passed. A projection is not completed history and not a promise of completion.',
    ledger: 'projected_ledger',
  },
];

function flatten(nodes: RequirementResult[], depth = 0): { node: RequirementResult; depth: number }[] {
  return nodes.flatMap((node) => [{ node, depth }, ...flatten(node.children ?? [], depth + 1)]);
}

function RequirementTable({
  caption,
  results,
  ledger,
  label,
  codeOf,
}: {
  caption: string;
  results: RequirementResult[];
  ledger: Allocation[];
  label: (r: RequirementResult) => string;
  codeOf: (id: string) => string;
}) {
  const rows = flatten(results);
  return (
    <div className="table-wrap">
      <table className="data report-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Requirement</th>
            <th scope="col">Status</th>
            <th scope="col" className="num">
              Counted
            </th>
            <th scope="col" className="num">
              Required
            </th>
            <th scope="col" className="num">
              Remaining
            </th>
            <th scope="col">Counted courses (allocations)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ node, depth }) => {
            const ids = node.allocation_ids ?? [];
            const allocations = (ledger ?? []).filter((a) => ids.includes(a.id));
            return (
              <tr key={`${node.id}-${depth}`}>
                <th scope="row" style={{ paddingLeft: `${0.75 + depth * 1.25}rem` }}>
                  {depth > 0 ? <span aria-hidden="true">└ </span> : null}
                  {label(node)}
                </th>
                <td>
                  <RequirementStatusBadge status={node.status} />
                </td>
                <td className="num">{formatCredits(node.counted_credits)}</td>
                <td className="num">{formatCredits(node.required_credits)}</td>
                <td className="num">{formatCredits(node.remaining_credits)}</td>
                <td>
                  {allocations.length === 0 ? (
                    <span className="muted">None</span>
                  ) : (
                    <ul className="plain-list">
                      {allocations.map((a) => (
                        <li key={a.id}>
                          <span className="mono">{codeOf(a.attempt_id)}</span> · {formatCredits(a.credits)} credits · {a.counting_context}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function describeChange(change: Record<string, unknown>, codeOf: (id: string) => string): ReactNode {
  const op = typeof change.op === 'string' ? change.op : 'change';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(change)) {
    if (key === 'op') continue;
    if (key === 'item_id' && typeof value === 'string') parts.push(`course ${codeOf(value)}`);
    else if (key === 'term_id' && typeof value === 'string') parts.push(`term ${formatTerm(value)}`);
    else if (key === 'credits' && typeof value === 'string') parts.push(`${formatCredits(value)} credits`);
    else if (key === 'course' && value && typeof value === 'object') {
      const c = value as { normalized_code?: string; credits?: string };
      parts.push(`replacement ${c.normalized_code ?? 'unknown course'}${c.credits ? ` (${formatCredits(c.credits)} credits)` : ''}`);
    } else parts.push(`${humanize(key).toLowerCase()} ${typeof value === 'string' ? value : JSON.stringify(value)}`);
  }
  const hypothetical = op === 'fail' || op === 'grade' ? ' (hypothetical; never applied to your record)' : '';
  return `${humanize(op)}: ${parts.join(', ') || 'no details'}${hypothetical}`;
}

const ENUM_FIELDS = new Set(['duration_choice', 'placement_mode', 'preset']);

function ScenarioAssumptions({ scenarioId, planId, codeOf }: { scenarioId: string | null; planId: string; codeOf: (id: string) => string }) {
  const session = useSession();
  const scenario = useResource<Scenario>(scenarioId && session.user ? `scenario:${session.user.id}:${scenarioId}` : null, (signal) =>
    accountEndpoints.scenario(session.api, scenarioId!, { signal }),
  );
  let body: ReactNode;
  if (!scenarioId) body = <p>None. This report shows the saved plan without any what-if scenario.</p>;
  else if (scenario.loading) body = <StatePanel kind="loading" title="Loading scenario…" />;
  else if (scenario.error)
    body =
      scenario.error.kind === 'not_found' ? (
        <StatePanel kind="error" title="Scenario not found" detail="It may have been deleted, or it belongs to another account. No assumptions are shown." />
      ) : (
        <ErrorPanel error={scenario.error} onRetry={scenario.reload} />
      );
  else if (scenario.data) {
    const s = scenario.data;
    const internship = s.internship;
    body = (
      <>
        <p>
          Scenario <strong>{s.label || 'Untitled scenario'}</strong>, made against record revision {s.baseline_record_revision}, plan revision{' '}
          {s.baseline_plan_revision} and rules <span className="mono">{s.rule_version}</span>. The requirement tables above show the saved plan, not this
          scenario.
        </p>
        {s.plan_id !== planId ? (
          <p className="callout" data-tone="warning">
            This scenario belongs to a different plan.
          </p>
        ) : null}
        <h3>Changes</h3>
        {s.changes.length === 0 ? (
          <p className="muted">No course changes.</p>
        ) : (
          <ul>
            {s.changes.map((c, i) => (
              <li key={i}>{describeChange(c, codeOf)}</li>
            ))}
          </ul>
        )}
        <h3>Internship</h3>
        {internship ? (
          <ul>
            {Object.entries(internship).map(([k, v]) => (
              <li key={k}>
                {humanize(k)}: {typeof v === 'string' ? (ENUM_FIELDS.has(k) ? humanize(v) : v) : v === null ? 'not set' : JSON.stringify(v)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No internship in this scenario.</p>
        )}
        <p>Awards considered: {s.award_ids.length ? s.award_ids.join(', ') : 'none'}.</p>
      </>
    );
  }
  return (
    <section aria-labelledby="scenario-heading">
      <h2 id="scenario-heading">Scenario assumptions</h2>
      {body}
    </section>
  );
}

function PlanSemesters({ plan, workload }: { plan: AcademicPlan; workload: Record<string, { selected_credits: string; placeholder_credits: string }> | null }) {
  const terms = [...plan.semesters].sort((a, b) => compareTerms(a.term_id, b.term_id));
  return (
    <section aria-labelledby="semesters-heading">
      <h2 id="semesters-heading">Planned semesters</h2>
      {terms.length === 0 ? <p className="muted">This plan has no semesters.</p> : null}
      {terms.map((s) => {
        const load = workload?.[s.term_id];
        return (
          <div key={s.term_id} className="table-wrap report-semester">
            <table className="data">
              <caption>
                {formatTerm(s.term_id)}
                {load ? (
                  <span className="muted">
                    {' '}
                    — selected {formatCredits(load.selected_credits)} credits; placeholders {formatCredits(load.placeholder_credits)} credits (server)
                  </span>
                ) : null}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Course or placeholder</th>
                  <th scope="col" className="num">
                    Credits
                  </th>
                  <th scope="col">Notes</th>
                </tr>
              </thead>
              <tbody>
                {s.courses.length === 0 && s.placeholders.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="muted">
                      Nothing planned.
                    </td>
                  </tr>
                ) : null}
                {s.courses.map((c) => (
                  <tr key={c.id}>
                    <th scope="row" className="mono">
                      {c.normalized_code}
                    </th>
                    <td className="num">{formatCredits(c.credits)}</td>
                    <td>{[c.intended_allocation ? `Intended for ${c.intended_allocation}` : '', ...(c.assumptions ?? [])].filter(Boolean).join('; ') || '—'}</td>
                  </tr>
                ))}
                {s.placeholders.map((p) => (
                  <tr key={p.id}>
                    <th scope="row">Placeholder: {p.label || p.requirement_id}</th>
                    <td className="num">{formatCredits(p.desired_credits)}</td>
                    <td>Unresolved: no course chosen for requirement {p.requirement_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </section>
  );
}

export function ReportPage() {
  const { plan_id: planId = '' } = useParams();
  const [params] = useSearchParams();
  const scenarioId = params.get('scenario');
  const session = useSession();
  const record = useRecord();
  const curriculum = useCurriculum();
  const plan = useResource<AcademicPlan>(session.user ? `plan:${session.user.id}:${planId}` : null, (signal) => endpoints.plan(session.api, planId, { signal }));
  const analysis = useAnalysis(record.data, plan.data, Boolean(plan.data));
  const definitions = useMemo(() => indexDefinitions(curriculum.data), [curriculum.data]);
  const codes = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of record.data?.attempts ?? []) map.set(a.id, a.normalized_code);
    for (const s of plan.data?.semesters ?? []) for (const c of s.courses) map.set(c.id, c.normalized_code);
    return map;
  }, [record.data, plan.data]);
  const codeOf = (id: string) => codes.get(id) ?? id;
  usePublishView({
    ruleVersion: analysis.data?.rule_version ?? record.data?.profile.curriculum_version ?? null,
    reviewStatus: curriculum.data?.review_status ?? null,
    dataMode: 'projected',
    recordRevision: record.data?.revision ?? null,
  });

  if (record.loading || plan.loading) return <StatePanel kind="loading" title="Loading report…" />;
  if (plan.error)
    return plan.error.kind === 'not_found' ? (
      <section className="panel">
        <h1>Printable report</h1>
        <StatePanel kind="error" title="Plan not found" detail="It may have been deleted, or it belongs to another account." action={<Link to="/plan">Your plans</Link>} />
      </section>
    ) : (
      <ErrorPanel error={plan.error} onRetry={plan.reload} />
    );
  if (record.error) return <ErrorPanel error={record.error} onRetry={record.reload} />;
  if (!plan.data || !record.data) return null;

  const p = plan.data;
  const c = curriculum.data;
  const result = analysis.data;
  const audit = result?.audit ?? null;
  const label = (r: RequirementResult) => requirementLabel(definitions.get(r.id), r);
  const planIssues = result?.validation?.issues ?? [];

  return (
    <article className="report-sheet" aria-labelledby="report-title">
      <header>
        <h1 id="report-title">Printable report</h1>
        <p>
          Plan <strong>{p.label ?? 'Untitled plan'}</strong> for <span className="mono">{session.user?.username}</span>. Record revision {record.data.revision},
          plan revision {p.revision}. Prepared {formatTimestamp(new Date().toISOString())}.
        </p>
        <p className="callout" data-tone="warning" role="note">
          <strong>Not an official institute approval.</strong> This is a personal planning report made by CoursePath from your own data. It is not a
          transcript, not an IIT Gandhinagar degree audit, and it does not approve any course, equivalence, credit or plan.
        </p>
        <div className="panel-row report-actions">
          <button type="button" className="btn btn-primary" onClick={() => window.print()}>
            Print
          </button>
          <Link className="btn" to={`/plan/${encodeURIComponent(p.id)}`}>
            Back to the plan
          </Link>
        </div>
      </header>

      <section aria-labelledby="rules-heading">
        <h2 id="rules-heading">Rules and sources</h2>
        {curriculum.loading ? <StatePanel kind="loading" title="Loading rules…" /> : null}
        {curriculum.error ? <ErrorPanel error={curriculum.error} onRetry={curriculum.reload} /> : null}
        {c ? (
          <>
            <dl className="report-facts">
              <div>
                <dt>Cohort</dt>
                <dd>{c.cohort}</dd>
              </div>
              <div>
                <dt>Rule version</dt>
                <dd className="mono">{result?.rule_version ?? c.version}</dd>
              </div>
              <div>
                <dt>Review status</dt>
                <dd>{c.review_status}</dd>
              </div>
              <div>
                <dt>Overall result (server)</dt>
                <dd>{audit ? (audit.complete ? 'Complete' : 'Not complete') : 'Not available yet'}</dd>
              </div>
            </dl>
            <SourcePanel title="Sources" refs={c.sources.map((s) => s.id)} catalog={c.sources} />
            <h3>Missing sources</h3>
            {c.missing_sources.length === 0 ? (
              <p className="muted">None listed by the server.</p>
            ) : (
              <ul>
                {c.missing_sources.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            )}
          </>
        ) : null}
      </section>

      <section aria-labelledby="views-heading">
        <h2 id="views-heading">Actual, current and projected</h2>
        <dl>
          {VIEWS.map((v) => (
            <div key={v.view}>
              <dt>
                <strong>{v.title}</strong>
              </dt>
              <dd>{v.meaning}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="status-heading">
        <h2 id="status-heading">Requirement status</h2>
        {analysis.loading ? <StatePanel kind="loading" title="Evaluating your record and plan on the server…" /> : null}
        {analysis.error ? <ErrorPanel error={analysis.error} onRetry={analysis.reload} /> : null}
        {audit
          ? VIEWS.map((v) => (
              <RequirementTable key={v.view} caption={v.title} results={audit[v.view] ?? []} ledger={(audit[v.ledger] as Allocation[] | undefined) ?? []} label={label} codeOf={codeOf} />
            ))
          : null}
        {audit && (audit.excluded_attempts ?? []).length > 0 ? (
          <>
            <h3>Attempts not counted</h3>
            <ul>
              {audit.excluded_attempts.map((e) => (
                <li key={`${e.attempt_id}-${e.reason}`}>
                  <span className="mono">{codeOf(e.attempt_id)}</span> — {humanize(e.reason)}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>

      <PlanSemesters plan={p} workload={result?.validation?.workload ?? null} />

      <ScenarioAssumptions scenarioId={scenarioId} planId={p.id} codeOf={codeOf} />

      <section aria-labelledby="issues-heading">
        <h2 id="issues-heading">Unresolved issues</h2>
        {result ? (
          <>
            <IssueList issues={analysis.issues} emptyMessage="The server reported no record or rule issues." />
            <h3>Plan validation</h3>
            <IssueList issues={planIssues} grouped={false} emptyMessage="The server reported no plan issues." />
          </>
        ) : (
          <p className="muted">Shown once the server analysis has loaded.</p>
        )}
      </section>

      <footer className="muted">
        Values come from the CoursePath server’s analysis of record revision {record.data.revision} and plan revision {p.revision}
        {result ? ` under rules ${result.rule_version}` : ''}. Not an official institute approval.
      </footer>
    </article>
  );
}
