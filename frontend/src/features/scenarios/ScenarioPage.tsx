import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { accountEndpoints, endpoints, scenarioEndpoints } from '../../api/endpoints';
import { useResource, useResourceCache } from '../../api/resources';
import type { AcademicPlan, InternshipInput, Scenario, ScenarioApplyResult, ScenarioChange, ScenarioCompareResult, ScenarioConflictData } from '../../api/types';
import { PLAN_TABS, SubNav } from '../../app/AppShell';
import { useSession } from '../../app/session';
import { usePublishView } from '../../app/viewContext';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ConflictPanel } from '../../components/ConflictPanel';
import { IssueList } from '../../components/IssueList';
import { ErrorPanel, StatePanel } from '../../components/StatePanel';
import { formatTimestamp } from '../../lib/format';
import { ChangesEditor } from './ChangesEditor';
import { CompareView } from './CompareView';
import { InternshipEditor } from './InternshipEditor';
import { InternshipPanels } from './InternshipPanels';
import { describeChange, durationLabel, planItems, splitChanges, type PlanItem } from './model';
import { useScenarios } from './ScenariosPage';
import './scenarios.css';

const asError = (e: unknown) => (e instanceof ApiError ? e : new ApiError('server', 0, String(e), []));

/** /scenarios/:scenario_id — one hypothetical scenario, its comparison and an explicit plan-only apply. */
export function ScenarioPage() {
  const { scenario_id: scenarioId = '' } = useParams();
  const session = useSession();
  const loaded = useResource(session.user ? `scenario:${session.user.id}:${scenarioId}` : null, (signal) => accountEndpoints.scenario(session.api, scenarioId, { signal }));
  usePublishView({ ruleVersion: loaded.data?.rule_version ?? null, dataMode: 'scenario', recordRevision: loaded.data?.baseline_record_revision ?? null });
  if (loaded.loading) return <StatePanel kind="loading" title="Loading scenario…" />;
  if (loaded.error || !loaded.data)
    return loaded.error?.kind === 'not_found' ? (
      <StatePanel kind="error" title="Scenario not found" detail="It may have been deleted, or it belongs to another account." action={<Link to="/scenarios">Your scenarios</Link>} />
    ) : loaded.error ? (
      <ErrorPanel error={loaded.error} onRetry={loaded.reload} />
    ) : null;
  return <Workspace key={loaded.data.id} initial={loaded.data} />;
}

interface Draft {
  label: string;
  changes: ScenarioChange[];
  internship: InternshipInput | null;
}

const draftOf = (s: Scenario): Draft => ({ label: s.label, changes: s.changes, internship: s.internship });
const same = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);

type ApplyConflict = { rebase: boolean; message: string; currentRevision: number | null };

function Workspace({ initial }: { initial: Scenario }) {
  const session = useSession();
  const cache = useResourceCache();
  const navigate = useNavigate();
  const headingId = useId();
  const userId = session.user?.id ?? '';
  const plan = useResource<AcademicPlan>(userId ? `plan:${userId}:${initial.plan_id}` : null, (signal) => endpoints.plan(session.api, initial.plan_id, { signal }));
  const siblings = useScenarios();
  const [saved, setSaved] = useState<Scenario>(initial);
  const [draft, setDraft] = useState<Draft>(draftOf(initial));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<ApiError | null>(null);
  const [conflict, setConflict] = useState<number | null | false>(false);
  const [announce, setAnnounce] = useState('');
  const [extra, setExtra] = useState<string[]>([]);
  const [compare, setCompare] = useState<{ revision: number; ids: string[]; data: ScenarioCompareResult; issues: ScenarioCompareResult['comparisons'][number]['issues'] } | null>(null);
  const [comparing, setComparing] = useState(false);
  const [compareError, setCompareError] = useState<ApiError | null>(null);
  const [dialog, setDialog] = useState<'apply' | 'delete' | null>(null);
  const [applied, setApplied] = useState<ScenarioApplyResult | null>(null);
  const [applyConflict, setApplyConflict] = useState<ApplyConflict | null>(null);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const items: PlanItem[] = useMemo(() => planItems(plan.data), [plan.data]);
  const dirty = !same(draft, draftOf(saved));
  const allScenarios = siblings.data?.scenarios ?? [saved];
  const peers = allScenarios.filter((s) => s.plan_id === saved.plan_id && s.id !== saved.id);
  const compareIds = useMemo(() => [saved.id, ...extra.filter((id) => peers.some((p) => p.id === id))].slice(0, 6), [saved.id, extra, peers]);

  const runCompare = useCallback(
    async (revision: number, ids: string[]) => {
      setComparing(true);
      setCompareError(null);
      try {
        const result = await scenarioEndpoints.compare(session.api, ids);
        setCompare({ revision, ids, data: result.data, issues: result.issues });
      } catch (e) {
        const error = asError(e);
        if (error.kind !== 'aborted') setCompareError(error);
      } finally {
        setComparing(false);
      }
    },
    [session.api],
  );

  // Comparing is read-only: evaluate the saved scenario whenever its saved revision or the chosen columns change.
  const idsKey = compareIds.join(',');
  const lastRun = useRef('');
  useEffect(() => {
    const key = `${saved.revision}|${saved.baseline_plan_revision}|${saved.baseline_record_revision}|${idsKey}`;
    if (lastRun.current === key) return;
    lastRun.current = key;
    void runCompare(saved.revision, idsKey.split(','));
  }, [saved.revision, saved.baseline_plan_revision, saved.baseline_record_revision, idsKey, runCompare]);

  const own = compare?.data.comparisons.find((c) => c.scenario_id === saved.id) ?? null;
  const ownCase = compare?.data.internship_cases.find((c) => c.scenario_id === saved.id) ?? null;
  const baselineStale = Boolean(own?.stale);
  const resultsStale = dirty || comparing || (compare !== null && compare.revision !== saved.revision);

  const edit = (patch: Partial<Draft>, message: string) => {
    setDraft((d) => ({ ...d, ...patch }));
    setAnnounce(message);
  };

  const adopt = (fresh: Scenario) => {
    setSaved(fresh);
    cache.invalidate('scenarios:');
  };

  const save = async (over?: number) => {
    setSaving(true);
    setSaveError(null);
    try {
      const result = await scenarioEndpoints.patch(session.api, saved.id, {
        expected_revision: over ?? saved.revision,
        label: draft.label,
        changes: draft.changes,
        internship: draft.internship,
      });
      setConflict(false);
      adopt(result.data);
      setDraft(draftOf(result.data));
      setAnnounce(`Scenario saved (revision ${result.data.revision}). Re-evaluating on the server.`);
    } catch (e) {
      const error = asError(e);
      if (error.kind === 'conflict') setConflict(error.currentRevision);
      else setSaveError(error);
    } finally {
      setSaving(false);
    }
  };

  const reloadScenario = async (keepDraft: boolean) => {
    const fresh = await accountEndpoints.scenario(session.api, saved.id);
    adopt(fresh.data);
    if (!keepDraft) setDraft(draftOf(fresh.data));
    return fresh.data;
  };

  const rebase = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const result = await scenarioEndpoints.patch(session.api, saved.id, { expected_revision: saved.revision, rebase: true });
      setApplyConflict(null);
      setApplied(null);
      adopt(result.data);
      if (!dirty) setDraft(draftOf(result.data));
      cache.invalidate(`plan:${userId}:${saved.plan_id}`);
      setAnnounce('Scenario rebased on the current record and plan. Re-evaluating.');
    } catch (e) {
      const error = asError(e);
      if (error.kind === 'conflict') setConflict(error.currentRevision);
      else setActionError(error);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setDialog(null);
    setBusy(true);
    setActionError(null);
    setApplyConflict(null);
    try {
      const result = await scenarioEndpoints.applyPlan(session.api, saved.id, {
        expected_plan_revision: saved.baseline_plan_revision,
        expected_scenario_revision: saved.revision,
      });
      setApplied(result.data);
      cache.invalidate('plan');
      cache.invalidate('analysis:');
      setAnnounce(`Plan updated to revision ${result.data.plan.revision}. Your accepted record was not changed.`);
      void runCompare(saved.revision, compareIds);
    } catch (e) {
      const error = asError(e);
      if (error.kind === 'conflict') {
        const data = (error.data ?? {}) as ScenarioConflictData;
        const rebaseNeeded = data.action === 'rebase' || error.issues.some((i) => i.code === 'SCENARIO_STALE');
        setApplyConflict({ rebase: rebaseNeeded, message: error.message, currentRevision: error.currentRevision });
      } else setActionError(error);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setDialog(null);
    setBusy(true);
    setActionError(null);
    try {
      await scenarioEndpoints.remove(session.api, saved.id, saved.revision);
      cache.invalidate('scenarios:');
      cache.invalidate(`scenario:${userId}:${saved.id}`);
      navigate('/scenarios', { state: { notice: `Scenario “${saved.label || 'Untitled scenario'}” deleted. Your baseline plan and accepted record are unchanged.` } });
    } catch (e) {
      const error = asError(e);
      if (error.kind === 'conflict') setConflict(error.currentRevision);
      else setActionError(error);
      setBusy(false);
    }
  };

  const { planEdits, hypothetical } = splitChanges(saved.changes);
  const planLabel = plan.data?.label || 'your plan';

  return (
    <div>
      <SubNav label="Plan" items={PLAN_TABS} />
      <section className="callout scenario-banner" data-tone="scenario" aria-labelledby={headingId}>
        <p className="scenario-banner-title" id={headingId}>
          <strong>Scenario (hypothetical)</strong>
        </p>
        <p>Nothing in this scenario changes your accepted record. Plan edits happen only if you apply them.</p>
        <dl className="facts">
          <div>
            <dt>Baseline record revision</dt>
            <dd>{saved.baseline_record_revision}</dd>
          </div>
          <div>
            <dt>Baseline plan</dt>
            <dd>
              {planLabel}, revision {saved.baseline_plan_revision}
            </dd>
          </div>
          <div>
            <dt>Rules</dt>
            <dd>{saved.rule_version}</dd>
          </div>
          <div>
            <dt>Baseline date</dt>
            <dd>{saved.baseline_captured_at ? formatTimestamp(saved.baseline_captured_at) : 'Not recorded by the server'}</dd>
          </div>
        </dl>
        <Link className="btn" to={`/plan/${encodeURIComponent(saved.plan_id)}`}>
          Return to baseline
        </Link>
      </section>

      <h1>{saved.label || 'Untitled scenario'}</h1>
      <p className="visually-hidden" aria-live="polite">
        {announce}
      </p>

      {baselineStale || applyConflict?.rebase ? (
        <div className="callout" data-tone="warning" role="alert">
          <p>
            <strong>The baseline changed.</strong> Your saved record, plan or rules changed after this scenario was created, so it cannot be compared or applied.
            Rebasing moves the baseline to the current record and plan and keeps your hypothetical changes.
          </p>
          <button type="button" className="btn btn-primary" onClick={rebase} disabled={busy || saving}>
            Rebase on current record and plan
          </button>
        </div>
      ) : null}

      {conflict !== false ? (
        <ConflictPanel
          conflictRevision={conflict}
          draftSummary={<DraftSummary draft={draft} items={items} />}
          onCompare={async () => <DraftSummary draft={draftOf(await reloadScenario(true))} items={items} />}
          onReload={async () => {
            await reloadScenario(false);
            setConflict(false);
          }}
          onKeepMine={async () => {
            const fresh = await reloadScenario(true);
            await save(fresh.revision);
          }}
        />
      ) : null}
      {saveError ? <ErrorPanel error={saveError} /> : null}
      {actionError ? <ErrorPanel error={actionError} /> : null}

      <div className="panel">
        <div className="field">
          <label htmlFor={`${headingId}-name`}>Scenario name</label>
          <input id={`${headingId}-name`} type="text" maxLength={200} value={draft.label} onChange={(e) => edit({ label: e.target.value }, 'Name changed.')} />
        </div>
        <div className="panel-row">
          <button type="button" className="btn btn-primary" onClick={() => save()} disabled={!dirty || saving || conflict !== false}>
            {saving ? 'Saving…' : 'Save scenario'}
          </button>
          <button type="button" className="btn" onClick={() => setDraft(draftOf(saved))} disabled={!dirty || saving}>
            Discard unsaved changes
          </button>
          <span role="status" aria-label="Scenario save status">
            {saving ? 'Saving…' : dirty ? 'Unsaved changes' : `Saved (revision ${saved.revision})`}
          </span>
        </div>
      </div>

      {plan.error ? <ErrorPanel error={plan.error} onRetry={plan.reload} /> : null}
      {plan.loading ? <StatePanel kind="loading" title="Loading the baseline plan…" /> : null}
      <ChangesEditor plan={plan.data} items={items} changes={draft.changes} onChange={(changes, message) => edit({ changes }, message)} />
      <InternshipEditor value={draft.internship} onChange={(internship, message) => edit({ internship }, message)} modules={own?.scenario?.internship?.modules ?? null} />

      <section className="panel" aria-labelledby={`${headingId}-cmp`}>
        <h2 id={`${headingId}-cmp`}>Comparison</h2>
        {peers.length > 0 ? (
          <fieldset className="choice-group">
            <legend>Also compare (same baseline plan)</legend>
            {peers.map((p) => (
              <label key={p.id} className="choice">
                <input
                  type="checkbox"
                  checked={extra.includes(p.id)}
                  disabled={!extra.includes(p.id) && compareIds.length >= 6}
                  onChange={(e) => setExtra((x) => (e.target.checked ? [...x, p.id] : x.filter((id) => id !== p.id)))}
                />
                {p.label || 'Untitled scenario'} ({p.internship ? durationLabel(p.internship.duration_choice) : 'no internship choice'})
              </label>
            ))}
          </fieldset>
        ) : null}
        <p role="status" className={resultsStale ? 'stale-note' : 'muted'}>
          {comparing
            ? 'Re-evaluating on the server… the results below are out of date.'
            : dirty
              ? `You have unsaved changes. The results below are for saved revision ${saved.revision}; save to re-evaluate.`
              : compare
                ? `Evaluated by the server for saved revision ${compare.revision}.`
                : 'Not evaluated yet.'}
        </p>
        {compareError ? <ErrorPanel error={compareError} onRetry={() => void runCompare(saved.revision, compareIds)} /> : null}
        {!compare && comparing ? <StatePanel kind="loading" title="Comparing on the server…" /> : null}
        {compare ? (
          <>
            <CompareView comparisons={compare.data.comparisons} cases={compare.data.internship_cases} scenarios={allScenarios} items={items} stale={resultsStale} />
            <details>
              <summary>{`All issues from the server (${compare.issues.length})`}</summary>
              <IssueList issues={compare.issues} headingLevel={4} />
            </details>
          </>
        ) : null}
      </section>

      {own?.scenario?.internship ? <InternshipPanels evaluation={own.scenario.internship} assumptions={ownCase?.completion_assumptions} items={items} stale={resultsStale} /> : null}

      <section className="panel" aria-labelledby={`${headingId}-apply`}>
        <h2 id={`${headingId}-apply`}>Apply or delete</h2>
        <p>
          Applying writes only drop, postpone and replace edits to your saved plan. Hypothetical grades, failures, caps and internship choices stay in the scenario.
          Your accepted record is never changed.
        </p>
        {applyConflict ? (
          <div className="callout" data-tone="danger" role="alert">
            <p>
              <strong>Not applied.</strong> {applyConflict.message}
              {applyConflict.currentRevision !== null ? ` (server revision ${applyConflict.currentRevision})` : ''}. Nothing was written and nothing is retried
              automatically.
            </p>
            {!applyConflict.rebase ? (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={async () => {
                  setApplyConflict(null);
                  cache.invalidate(`plan:${userId}:${saved.plan_id}`);
                  const fresh = await reloadScenario(dirty);
                  void runCompare(fresh.revision, compareIds);
                }}
              >
                Reload and compare
              </button>
            ) : null}
          </div>
        ) : null}
        {applied ? (
          <div className="callout" role="status">
            <p>
              <strong>Plan updated to revision {applied.plan.revision}.</strong> Your accepted record was not changed.
            </p>
            {applied.not_applied.length > 0 ? (
              <>
                <p>Not applied (stays hypothetical):</p>
                <ul>
                  {applied.not_applied.map((n, i) => (
                    <li key={i}>
                      {n.op === 'internship' ? 'Internship choice' : `${n.op}${n.item_id ? ` — ${items.find((x) => x.id === n.item_id)?.code ?? n.item_id}` : ''}`}: {n.reason}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            <p>
              This scenario’s baseline is now out of date; rebase it to keep exploring. <Link to={`/plan/${encodeURIComponent(saved.plan_id)}`}>Open the updated plan</Link>
            </p>
          </div>
        ) : null}
        <div className="panel-row">
          <button type="button" className="btn btn-primary" onClick={() => setDialog('apply')} disabled={busy || dirty || baselineStale || planEdits.length === 0}>
            Apply to plan…
          </button>
          <button type="button" className="btn btn-danger" onClick={() => setDialog('delete')} disabled={busy}>
            Delete scenario…
          </button>
        </div>
        {dirty ? <p className="muted">Save the scenario before applying it.</p> : planEdits.length === 0 ? <p className="muted">This scenario has no plan edits to apply.</p> : null}
      </section>

      <ConfirmDialog open={dialog === 'apply'} title="Apply plan edits" confirmLabel="Apply to plan" onConfirm={apply} onCancel={() => setDialog(null)}>
        <p>
          These edits will be written to {planLabel} (revision {saved.baseline_plan_revision}). Your accepted record is never changed.
        </p>
        <h3>Plan edits to write</h3>
        <ul aria-label="Plan edits to write">
          {planEdits.map((c, i) => (
            <li key={i}>{describeChange(c, items)}</li>
          ))}
        </ul>
        <h3>Not applied (stay hypothetical)</h3>
        {hypothetical.length === 0 && !saved.internship ? (
          <p className="muted">None.</p>
        ) : (
          <ul aria-label="Not applied">
            {hypothetical.map((c, i) => (
              <li key={i}>{describeChange(c, items)}</li>
            ))}
            {saved.internship ? <li>Internship choice: {durationLabel(saved.internship.duration_choice)}</li> : null}
          </ul>
        )}
      </ConfirmDialog>
      <ConfirmDialog open={dialog === 'delete'} title="Delete scenario" confirmLabel="Delete scenario" danger onConfirm={remove} onCancel={() => setDialog(null)}>
        <p>
          Delete “{saved.label || 'Untitled scenario'}”? Its hypothetical changes are discarded. Your baseline plan and accepted record are not changed.
        </p>
      </ConfirmDialog>
    </div>
  );
}

function DraftSummary({ draft, items }: { draft: Draft; items: PlanItem[] }) {
  return (
    <ul>
      <li>Name: {draft.label || 'Untitled scenario'}</li>
      {draft.changes.map((c, i) => (
        <li key={i}>{describeChange(c, items)}</li>
      ))}
      <li>Internship: {draft.internship ? durationLabel(draft.internship.duration_choice) : 'not chosen'}</li>
    </ul>
  );
}
