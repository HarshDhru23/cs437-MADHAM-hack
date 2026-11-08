import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAnalysis, useCatalogue, useCurriculum, usePlans, useRecord } from '../../api/hooks';
import type { Issue } from '../../api/types';
import { usePublishView, type DataMode } from '../../app/viewContext';
import { useSession } from '../../app/session';
import { IssueList, visibleIssues } from '../../components/IssueList';
import { ErrorPanel, StatePanel } from '../../components/StatePanel';
import { formatCredits, formatTerm, humanize } from '../../lib/format';
import { DegreeRing, type RingGroup } from './DegreeRing';
import { indexDefinitions, requirementLabel, RequirementTree, shownGroups, type CountedSource } from './RequirementTree';
import './requirements.css';

type View = 'actual' | 'current' | 'projected';

const VIEW_LABEL: Record<View, string> = {
  actual: 'Completed',
  current: 'Completed + current courses',
  projected: 'With my plan',
};

export function RequirementsPage() {
  const session = useSession();
  const curriculum = useCurriculum();
  const catalogue = useCatalogue();
  const record = useRecord();
  const plans = usePlans();
  const [view, setView] = useState<View>('actual');
  const [planId, setPlanId] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);

  const hasHistory = Boolean(record.data && (record.data.attempts.length > 0 || record.data.current_enrolment.length > 0));
  const selectedPlan = plans.data?.find((p) => p.id === planId) ?? plans.data?.[0] ?? null;
  const analysis = useAnalysis(hasHistory ? record.data : null, selectedPlan, !plans.loading);
  const definitions = useMemo(() => indexDefinitions(curriculum.data), [curriculum.data]);

  // Where each counted course came from, so the list can say "grade A", "in progress" or "planned".
  const sources = useMemo(() => {
    const map = new Map<string, CountedSource>();
    for (const a of record.data?.attempts ?? []) map.set(a.id, { code: a.normalized_code, title: a.title, grade: a.grade, kind: 'done' });
    for (const e of record.data?.current_enrolment ?? []) map.set(e.id, { code: e.normalized_code, kind: 'current' });
    for (const s of selectedPlan?.semesters ?? []) for (const c of s.courses) map.set(c.id, { code: c.normalized_code, kind: 'planned' });
    return map;
  }, [record.data, selectedPlan]);

  const audit = analysis.data?.audit ?? null;
  const personal = Boolean(session.user && hasHistory && audit);
  const results = audit ? audit[view] : null;
  const ledger = audit ? (view === 'actual' ? audit.ledger : view === 'current' ? audit.current_ledger : audit.projected_ledger) : [];
  const dataMode: DataMode = personal ? view : 'public';
  usePublishView({ ruleVersion: null, reviewStatus: null, dataMode, recordRevision: null });

  if (curriculum.loading) return <StatePanel kind="loading" title="Loading requirements…" />;
  if (curriculum.error || !curriculum.data) return curriculum.error ? <ErrorPanel error={curriculum.error} onRetry={curriculum.reload} /> : null;
  const c = curriculum.data;

  const toCheck: Issue[] = personal ? visibleIssues(analysis.issues.length ? analysis.issues : (audit?.issues ?? [])) : [];
  // Zero-credit requirements: PE is part of the requirement tree, the viva is listed separately.
  const noncredit = [
    ...c.requirements.filter((r) => r.type === 'noncredit').map((r) => ({ id: r.id, label: r.label, semesters: r.minimum_courses ?? null })),
    ...(c.noncredit_obligations ?? []).filter((o) => !c.requirements.some((r) => r.id === o.id)).map((o) => ({ id: o.id, label: o.label, semesters: o.required_semesters ?? null })),
  ];
  const degree = audit?.degree?.[view] ?? null;
  const total = degree?.total_credits ?? c.total_credits;

  // One arc per group that carries credits, in the order of the list below. The sizes are the credits each group asks for (from the rules);
  // what fills them is what the server counted. Without a record the arcs stay empty.
  const ringGroups: RingGroup[] = shownGroups(definitions, personal ? undefined : c.requirements, personal && results ? results : undefined)
    .map(({ id, result, def }) => ({
      id,
      label: requirementLabel(def, result),
      required: String(def.minimum_credits ?? result?.required_credits ?? '0'),
      counted: result ? (result.counted_credits ?? '0') : null,
      done: result?.status === 'satisfied',
    }))
    .filter((g) => Number(g.required) > 0);

  return (
    <div>
      <h1>Graduation requirements</h1>
      <p className="muted">
        B.Tech CSE, 2024 entry{total ? ` · ${formatCredits(total)} credits to graduate` : ''}. Select a group to see its courses.
      </p>

      {!session.user ? (
        <div className="panel panel-row">
          <p style={{ margin: 0 }}>Browse the full requirements first. When you are ready, add your transcript or IMS grades to see your own progress.</p>
          <Link className="btn btn-primary" to="/record/import">
            Add my record
          </Link>
        </div>
      ) : !record.loading && !hasHistory ? (
        <div className="panel panel-row">
          <p style={{ margin: 0 }}>Your account has no record yet.</p>
          <Link className="btn btn-primary" to="/record/import">
            Add my record
          </Link>
        </div>
      ) : null}

      {session.user && hasHistory ? (
        <fieldset className="seg-wrap" style={{ border: 0, padding: 0, margin: '0 0 var(--space-4)' }}>
          <legend className="visually-hidden">What do you want to see?</legend>
          <div className="seg" role="radiogroup" aria-label="Audit view">
            {(Object.keys(VIEW_LABEL) as View[]).map((v) => (
              <label key={v} data-checked={view === v ? 'true' : undefined} data-disabled={v === 'projected' && !selectedPlan ? 'true' : undefined}>
                <input type="radio" name="audit-view" value={v} checked={view === v} onChange={() => setView(v)} disabled={v === 'projected' && !selectedPlan} />
                {VIEW_LABEL[v]}
              </label>
            ))}
          </div>
          {view === 'projected' && plans.data && plans.data.length > 1 ? (
            <div className="field" style={{ maxWidth: '24rem' }}>
              <label htmlFor="proj-plan">Plan</label>
              <select id="proj-plan" value={selectedPlan?.id ?? ''} onChange={(e) => setPlanId(e.target.value)}>
                {plans.data.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label ?? 'Untitled plan'}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {!selectedPlan ? (
            <p className="muted" style={{ margin: 0 }}>
              To see your requirements with a plan, <Link to="/plan">create a plan</Link>.
            </p>
          ) : null}
        </fieldset>
      ) : null}

      {analysis.loading && hasHistory ? <StatePanel kind="loading" title="Checking your record…" /> : null}
      {analysis.error ? <ErrorPanel error={analysis.error} onRetry={analysis.reload} /> : null}

      {personal && audit ? (
        <section aria-label="Overview" className="panel req-hud">
          <DegreeRing groups={ringGroups} total={degree?.total_credits ?? null} counted={degree?.counted_credits ?? null} highlightId={active} onHighlight={setActive} />
          <div className="req-hud-side">
            <Verdict view={view} complete={audit.complete} remaining={degree?.remaining_credits ?? null} />
            {degree ? (
              <dl className="req-tiles">
                <div>
                  <dt>Credits counted</dt>
                  <dd>
                    <span className="num">
                      {formatCredits(degree.counted_credits)} of {formatCredits(degree.total_credits)}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Credits remaining</dt>
                  <dd className="num">{formatCredits(degree.remaining_credits)}</dd>
                </div>
              </dl>
            ) : null}
          </div>
        </section>
      ) : (
        <section aria-label="Degree ring" className="panel req-hud">
          <DegreeRing groups={ringGroups} total={total ?? null} counted={null} highlightId={active} onHighlight={setActive} />
          <p className="muted" style={{ margin: 0 }}>
            Each segment is one requirement group, as long as the credits it asks for. Add your record and the segments fill as your credits are counted.
          </p>
        </section>
      )}

      {toCheck.length > 0 ? (
        <section aria-label="Things to check" className="panel">
          <h2>Things to check</h2>
          <IssueList issues={toCheck} />
        </section>
      ) : null}

      <section aria-labelledby="req-heading">
        <h2 id="req-heading">{personal ? `Requirements — ${VIEW_LABEL[view]}` : 'All requirements'}</h2>
        {personal && results ? (
          <RequirementTree label="Requirements" definitions={definitions} results={results} ledger={ledger} sources={sources} catalogue={catalogue.data?.courses ?? []} activeId={active} onActive={setActive} />
        ) : (
          <RequirementTree label="Requirements" definitions={definitions} defs={c.requirements} catalogue={catalogue.data?.courses ?? []} activeId={active} onActive={setActive} />
        )}
      </section>

      <section aria-label="Other requirements" className="panel">
        <h2>Other requirements</h2>
        <p className="muted">These carry no credits, but you still need them to graduate.</p>
        <ul className="req-other">
          {noncredit.map((o) => {
            const mine = results?.find((r) => r.id === o.id);
            return (
              <li key={o.id}>
                <strong>{o.id === 'pe' ? 'Physical education' : o.id === 'viva' ? 'Comprehensive viva' : (o.label ?? humanize(o.id))}</strong>
                {o.id === 'pe' && o.semesters ? ` — one PE course in each of ${o.semesters} semesters` : ''}
                {o.id === 'viva' ? ' — a pass (P) recorded in every semester you are enrolled' : ''}
                {mine && mine.required_courses != null && o.id === 'pe' ? ` (${mine.counted_courses ?? 0} of ${mine.required_courses} done)` : ''}
              </li>
            );
          })}
        </ul>
        {(() => {
          const viva = results?.find((r) => r.id === 'viva');
          return viva?.missing_terms && viva.missing_terms.length > 0 ? <p>No viva pass recorded yet for: {viva.missing_terms.map(formatTerm).join(', ')}.</p> : null;
        })()}
      </section>
    </div>
  );
}

function Verdict({ view, complete, remaining }: { view: View; complete: boolean; remaining: string | null }) {
  const left = remaining !== null && Number(remaining) > 0 ? formatCredits(remaining) : null;
  let text: string;
  let done: boolean;
  if (view === 'projected') {
    done = remaining !== null && Number(remaining) === 0;
    text = done ? 'Your plan covers every requirement' : left ? `Your plan leaves ${left} credits uncovered` : 'Your plan does not cover every requirement yet';
  } else if (view === 'current') {
    done = remaining !== null && Number(remaining) === 0;
    text = done ? 'Your current courses complete every requirement' : left ? `Not yet eligible to graduate — ${left} credits to go after your current courses` : 'Not yet eligible to graduate';
  } else {
    done = complete;
    text = complete ? 'Graduation requirements complete' : left ? `Not yet eligible to graduate — ${left} credits to go` : 'Not yet eligible to graduate';
  }
  return (
    <div className="build-status" data-tone={done ? 'success' : 'warning'} role="status">
      <strong>{done ? '✓ ' : ''}{text}</strong>
    </div>
  );
}
