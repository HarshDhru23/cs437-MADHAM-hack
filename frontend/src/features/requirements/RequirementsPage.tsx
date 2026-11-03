import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAnalysis, useCurriculum, usePlans, useRecord } from '../../api/hooks';
import type { Issue, RequirementResult } from '../../api/types';
import { usePublishView, type DataMode } from '../../app/viewContext';
import { useSession } from '../../app/session';
import { Drawer } from '../../components/ConfirmDialog';
import { IssueList } from '../../components/IssueList';
import { SourcePanel } from '../../components/SourcePanel';
import { ErrorPanel, StatePanel } from '../../components/StatePanel';
import { DecisionBadge } from '../../components/StatusBadge';
import { formatCredits, humanize } from '../../lib/format';
import { describeRule, indexDefinitions, requirementLabel, RequirementTree } from './RequirementTree';

/** Readable text for the completion policies the reviewed rules use; anything else is shown humanized. */
const COMPLETION_POLICY: Record<string, string> = {
  pass_each_active_semester: 'A P is required in every active semester (D-16)',
};

type View = 'actual' | 'current' | 'projected';

const VIEW_LABEL: Record<View, string> = {
  actual: 'Actual completed',
  current: 'Completed + current enrolment',
  projected: 'Projected plan',
};

function findResult(nodes: RequirementResult[], id: string): RequirementResult | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    const child = findResult(n.children ?? [], id);
    if (child) return child;
  }
  return undefined;
}

export function RequirementsPage() {
  const session = useSession();
  const curriculum = useCurriculum();
  const record = useRecord();
  const plans = usePlans();
  const [view, setView] = useState<View>('actual');
  const [planId, setPlanId] = useState<string | null>(null);
  const [why, setWhy] = useState<string | null>(null);

  const hasHistory = Boolean(record.data && (record.data.attempts.length > 0 || record.data.current_enrolment.length > 0));
  const selectedPlan = plans.data?.find((p) => p.id === planId) ?? plans.data?.[0] ?? null;
  const analysis = useAnalysis(hasHistory ? record.data : null, selectedPlan, !plans.loading);
  const definitions = useMemo(() => indexDefinitions(curriculum.data), [curriculum.data]);
  const attempts = useMemo(() => new Map((record.data?.attempts ?? []).map((a) => [a.id, a])), [record.data]);

  const audit = analysis.data?.audit ?? null;
  const personal = Boolean(session.user && hasHistory && audit);
  const results = audit ? audit[view] : null;
  const ledger = audit ? (view === 'actual' ? audit.ledger : view === 'current' ? audit.current_ledger : audit.projected_ledger) : [];
  const dataMode: DataMode = personal ? view : 'public';
  usePublishView({
    ruleVersion: analysis.data?.rule_version ?? curriculum.data?.version ?? null,
    reviewStatus: curriculum.data?.review_status ?? null,
    dataMode,
    recordRevision: personal ? (record.data?.revision ?? null) : null,
  });

  if (curriculum.loading) return <StatePanel kind="loading" title="Loading requirements…" />;
  if (curriculum.error || !curriculum.data) return curriculum.error ? <ErrorPanel error={curriculum.error} onRetry={curriculum.reload} /> : null;
  const c = curriculum.data;

  const allIssues: Issue[] = [...curriculum.issues, ...(personal ? (analysis.issues.length ? analysis.issues : (audit?.issues ?? [])) : [])];
  const whyDef = why ? definitions.get(why) : undefined;
  const whyResult = why && results ? findResult(results, why) : undefined;
  const whyLedger = whyResult ? ledger.filter((a) => whyResult.allocation_ids.includes(a.id)) : [];
  const latestControls = record.data?.reported_controls.at(-1)?.controls ?? null;
  const remainingTop = results ? results.filter((r) => r.status !== 'satisfied').length : null;
  const unresolved = allIssues.filter((i) => i.severity === 'unknown' || i.severity === 'approval_required').length;

  return (
    <div>
      <h1>CSE 2024 graduation requirements</h1>
      <p className="muted">
        Rule set <span className="mono">{c.version}</span> for {c.cohort}. Total in these rules: <span className="num">{formatCredits(c.total_credits)}</span> credits.
      </p>

      {c.review_status !== 'reviewed' ? (
        <div className="callout" data-tone="warning">
          <strong>These rules are a draft (review status: {c.review_status}).</strong> CoursePath cannot give an official completion verdict until reviewed sources are
          added. Missing sources:
          <ul>
            {c.missing_sources.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {!session.user ? (
        <div className="panel panel-row">
          <p style={{ margin: 0 }}>Browse the full requirements first. When you are ready, add your transcript or IMS grades to see your own progress.</p>
          <Link className="btn btn-primary" to="/record/import">
            Add my record
          </Link>
        </div>
      ) : !record.loading && !hasHistory ? (
        <div className="panel panel-row">
          <p style={{ margin: 0 }}>Your account has no accepted record yet.</p>
          <Link className="btn btn-primary" to="/record/import">
            Add my record
          </Link>
        </div>
      ) : null}

      {session.user && hasHistory ? (
        <fieldset className="panel">
          <legend>
            <strong>Which state are you inspecting?</strong>
          </legend>
          <div className="panel-row" role="radiogroup" aria-label="Audit view">
            {(Object.keys(VIEW_LABEL) as View[]).map((v) => (
              <label key={v} className="btn" style={{ fontWeight: view === v ? 700 : 400 }}>
                <input type="radio" name="audit-view" value={v} checked={view === v} onChange={() => setView(v)} disabled={v === 'projected' && !selectedPlan} />
                {VIEW_LABEL[v]}
              </label>
            ))}
          </div>
          {view === 'projected' ? (
            plans.data && plans.data.length > 1 ? (
              <div className="field" style={{ maxWidth: '24rem', marginTop: '0.75rem' }}>
                <label htmlFor="proj-plan">Plan used for projection</label>
                <select id="proj-plan" value={selectedPlan?.id ?? ''} onChange={(e) => setPlanId(e.target.value)}>
                  {plans.data.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label ?? p.id} (revision {p.revision})
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="muted">Projection assumes every planned course is passed; it is not completed history.</p>
            )
          ) : null}
          {!selectedPlan ? (
            <p className="muted">
              Projected view needs a saved plan. <Link to="/plan">Create a plan</Link>.
            </p>
          ) : null}
        </fieldset>
      ) : null}

      {analysis.loading && hasHistory ? <StatePanel kind="loading" title="Evaluating your record on the server…" /> : null}
      {analysis.error ? <ErrorPanel error={analysis.error} onRetry={analysis.reload} /> : null}

      {personal && audit ? (
        <section aria-label="Overview" className="panel">
          <h2>Overview — {VIEW_LABEL[view]}</h2>
          <dl className="summary-grid">
            <div>
              <dt>Degree-allocated credits</dt>
              <dd>
                Unavailable
                <small>The server has not reported a degree total for these draft rules.</small>
              </dd>
            </div>
            <div>
              <dt>Top-level requirements not satisfied</dt>
              <dd>
                {remainingTop} <small>of {results?.length ?? 0}, as reported by the server</small>
              </dd>
            </div>
            <div>
              <dt>Unresolved decisions</dt>
              <dd>{unresolved}</dd>
            </div>
            <div>
              <dt>Overall verdict</dt>
              <dd>
                {audit.complete ? 'Complete (server)' : 'Not complete'}
                <small>{audit.complete ? '' : 'Missing evidence prevents an unconditional result.'}</small>
              </dd>
            </div>
          </dl>
          {latestControls ? (
            <>
              <h3>Source-reported totals (from your imported document)</h3>
              <dl className="summary-grid">
                {Object.entries(latestControls).map(([k, v]) => (
                  <div key={k}>
                    <dt>{humanize(k)}</dt>
                    <dd>{typeof v === 'string' || typeof v === 'number' ? String(v) : 'Unknown'}</dd>
                  </div>
                ))}
              </dl>
              <p className="muted">Reported totals are shown as printed by the source; they are not the same as degree-allocated credits.</p>
            </>
          ) : null}
        </section>
      ) : null}

      <section aria-label="Unresolved decisions and issues" className="panel">
        <h2>Unresolved decisions and issues</h2>
        <IssueList issues={allIssues} emptyMessage="The server reported no issues." />
      </section>

      <section aria-labelledby="req-heading">
        <h2 id="req-heading">{personal ? `Requirements — ${VIEW_LABEL[view]}` : 'All requirements by basket'}</h2>
        {personal && results ? (
          <RequirementTree label="Requirements" definitions={definitions} results={results} ledger={ledger} attempts={attempts} onWhy={setWhy} />
        ) : (
          <RequirementTree label="Requirements" definitions={definitions} defs={c.requirements} onWhy={setWhy} />
        )}
      </section>

      {personal && audit && audit.excluded_attempts.length > 0 ? (
        <section aria-label="Attempts not counted" className="panel">
          <h2>Attempts not counted</h2>
          <p className="muted">Failed, in-progress or unclassified attempts stay in your record but are not counted as earned toward these requirements.</p>
          <ul>
            {audit.excluded_attempts.map((e) => {
              const at = attempts.get(e.attempt_id);
              return (
                <li key={`${e.attempt_id}-${e.reason}`}>
                  <span className="mono">{at?.normalized_code ?? e.attempt_id}</span> {at ? `${at.title} (grade ${at.grade || 'blank'})` : ''} — {humanize(e.reason)}{' '}
                  <span className="issue-code">{e.reason}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section aria-label="Non-credit obligations" className="panel">
        <h2>Non-credit obligations</h2>
        <p className="muted">Zero credits do not mean these are complete; the audit shows which semesters still lack a recorded result.</p>
        <ul>
          {(c.noncredit_obligations ?? []).map((o) => (
            <li key={o.id}>
              <strong>{o.label ?? (o.id === 'pe' ? 'Physical education (PE)' : o.id === 'viva' ? 'Comprehensive viva' : humanize(o.id))}</strong>
              {o.required_semesters ? ` — required in ${o.required_semesters} semesters` : ''}
              {o.required_each_active_semester ? ' — required in every active semester' : ''}
              {o.recorded_grades ? ` (recorded grades: ${o.recorded_grades.join('/')})` : ''}.{' '}
              {o.completion_policy
                ? `Completion policy: ${COMPLETION_POLICY[o.completion_policy] ?? humanize(o.completion_policy)}.`
                : 'Completion policy not yet reviewed; semester states unavailable.'}{' '}
              {o.decision ? <DecisionBadge decision={o.decision} /> : null}
              {o.source_locator ? <span className="muted"> Source: {o.source_locator}</span> : null}
            </li>
          ))}
        </ul>
      </section>

      <Drawer open={why !== null} title={`Why? ${requirementLabel(whyDef, whyResult)}`} onClose={() => setWhy(null)}>
        <p>{describeRule(whyDef)}</p>
        {whyDef?.decision ? (
          <p>
            <DecisionBadge decision={whyDef.decision} />
          </p>
        ) : null}
        {whyDef?.source_locator ? <p>Where in the source: {whyDef.source_locator}</p> : null}
        {whyResult ? (
          <p>
            Server status: <strong>{humanize(whyResult.status)}</strong>. Counted {formatCredits(whyResult.counted_credits)} of {formatCredits(whyResult.required_credits)} credits;
            remaining {formatCredits(whyResult.remaining_credits)}.
          </p>
        ) : null}
        {whyLedger.length > 0 ? (
          <ul>
            {whyLedger.map((a) => (
              <li key={a.id}>
                {attempts.get(a.attempt_id)?.normalized_code ?? a.attempt_id}: {a.explanation}
              </li>
            ))}
          </ul>
        ) : null}
        <SourcePanel title="Rule sources" refs={whyResult?.source_refs ?? whyDef?.source_refs ?? []} catalog={c.sources} />
      </Drawer>
    </div>
  );
}
