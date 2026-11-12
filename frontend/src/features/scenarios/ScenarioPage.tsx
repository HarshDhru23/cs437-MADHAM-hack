import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { accountEndpoints, calendarEndpoints, endpoints, scenarioEndpoints } from '../../api/endpoints';
import { useResource, useResourceCache } from '../../api/resources';
import type { AcademicPlan, Scenario, ScenarioApplyResult, ScenarioChange, ScenarioCompareResult, ScenarioConflictData } from '../../api/types';
import { PLAN_TABS, SubNav } from '../../app/AppShell';
import { useSession } from '../../app/session';
import { usePublishView } from '../../app/viewContext';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ConflictPanel } from '../../components/ConflictPanel';
import { ErrorPanel, StatePanel } from '../../components/StatePanel';
import { plainMessage } from '../../lib/format';
import { ChangesEditor } from './ChangesEditor';
import { CompareView } from './CompareView';
import { HeadlineFigures } from './HeadlineFigures';
import { InternshipEditor } from './InternshipEditor';
import { InternshipPanels } from './InternshipPanels';
import { keptDrafts, resetKeptScenarioDrafts, type KeptDraft } from './keptDrafts';
import { ProblemList, problemCount } from './ProblemList';
import { describeChange, describeSkipped, durationLabel, fitChanges, planItems, PLAN_OPS, splitChanges, type PlanItem, type RefusedChange } from './model';
import { useScenarios } from './ScenariosPage';
import './scenarios.css';

const asError = (e: unknown) => (e instanceof ApiError ? e : new ApiError('server', 0, String(e), []));

/** /scenarios/:scenario_id — one hypothetical scenario, its comparison and an explicit plan-only apply. */
export function ScenarioPage() {
  const { scenario_id: scenarioId = '' } = useParams();
  const session = useSession();
  const loaded = useResource(session.user ? `scenario:${session.user.id}:${scenarioId}` : null, (signal) => accountEndpoints.scenario(session.api, scenarioId, { signal }));
  usePublishView({ dataMode: 'scenario' });
  if (loaded.loading) return <StatePanel kind="loading" title="Loading scenario…" />;
  if (loaded.error || !loaded.data)
    return loaded.error?.kind === 'not_found' ? (
      <StatePanel kind="error" title="Scenario not found" detail="It may have been deleted, or it belongs to another account." action={<Link to="/scenarios">Your scenarios</Link>} />
    ) : loaded.error ? (
      <ErrorPanel error={loaded.error} onRetry={loaded.reload} />
    ) : null;
  return <Workspace key={loaded.data.id} initial={loaded.data} />;
}

type Draft = KeptDraft;

const draftOf = (s: Scenario): Draft => ({ label: s.label, changes: s.changes, internship: s.internship });
const same = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);

export { resetKeptScenarioDrafts };   // tests import it from here

type ApplyConflict = { rebase: boolean; message: string; currentRevision: number | null };
/** Which request a 409 answered, so "Keep my version" repeats that request. */
type ConflictFrom = 'save' | 'delete' | 'rebase';

function Workspace({ initial }: { initial: Scenario }) {
  const session = useSession();
  const cache = useResourceCache();
  const navigate = useNavigate();
  const headingId = useId();
  const userId = session.user?.id ?? '';
  const plan = useResource<AcademicPlan>(userId ? `plan:${userId}:${initial.plan_id}` : null, (signal) => endpoints.plan(session.api, initial.plan_id, { signal }));
  const siblings = useScenarios();
  const calendar = useResource('calendar', (signal) => calendarEndpoints.calendar(session.api, { signal }));
  const [saved, setSaved] = useState<Scenario>(initial);
  const [draft, setDraft] = useState<Draft>(() => {
    const kept = keptDrafts.get(`${userId}:${initial.id}`);
    return kept && kept.revision === initial.revision ? kept.draft : draftOf(initial);
  });
  const savingNow = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<ApiError | null>(null);
  const [conflict, setConflict] = useState<number | null | false>(false);
  const [conflictFrom, setConflictFrom] = useState<ConflictFrom>('save');
  const [rebaseRefused, setRebaseRefused] = useState<{ fits: ScenarioChange[]; refused: RefusedChange[] } | null>(null);
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
  const [foldOpen, setFoldOpen] = useState(true);

  const items: PlanItem[] = useMemo(() => planItems(plan.data), [plan.data]);
  // Every planned item seen so far, so a change on a course the plan has since dropped still has a name.
  const known = useRef(new Map<string, PlanItem>());
  const namedItems = useMemo(() => {
    for (const i of items) known.current.set(i.id, i);
    return [...known.current.values()];
  }, [items]);
  const dirty = !same(draft, draftOf(saved));
  // Keep unsaved edits if the student leaves this page, and warn before a reload or closing the tab loses them.
  useEffect(() => {
    const key = `${userId}:${saved.id}`;
    if (dirty) keptDrafts.set(key, { draft, revision: saved.revision });
    else keptDrafts.delete(key);
  }, [dirty, draft, saved.id, saved.revision, userId]);
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
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
  const headline = own && !own.stale && own.scenario ? own : null;
  const baselineStale = Boolean(own?.stale);
  const resultsStale = dirty || comparing || (compare !== null && compare.revision !== saved.revision);

  const edit = (patch: Partial<Draft>, message: string) => {
    setDraft((d) => ({ ...d, ...patch }));
    setAnnounce(message);
  };

  const conflicted = (error: ApiError, from: ConflictFrom) => {
    setConflictFrom(from);
    setConflict(error.currentRevision);
  };

  const adopt = (fresh: Scenario) => {
    setSaved(fresh);
    // The cached copy must always carry the newest revision: coming back to this scenario later must not start from an older one (the next save would conflict).
    if (userId) cache.set(`scenario:${userId}:${fresh.id}`, { data: fresh, issues: [] });
    cache.invalidate('scenarios:');
  };

  const save = async (over?: number) => {
    if (savingNow.current) return; // a double click never sends two saves
    savingNow.current = true;
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
      setAnnounce('Scenario saved. Checking it again.');
    } catch (e) {
      const error = asError(e);
      if (error.kind === 'conflict') conflicted(error, 'save');
      else setSaveError(error);
    } finally {
      savingNow.current = false;
      setSaving(false);
    }
  };

  const reloadScenario = async (keepDraft: boolean) => {
    const fresh = await accountEndpoints.scenario(session.api, saved.id);
    adopt(fresh.data);
    if (!keepDraft) setDraft(draftOf(fresh.data));
    return fresh.data;
  };

  /** Changes that still fit the current saved plan, and the ones the server would refuse on rebase. */
  const fitCurrentPlan = async () => {
    const current = await endpoints.plan(session.api, saved.plan_id);
    // Edits an apply just wrote are in the plan now; keeping them would refuse the rebase or repeat them.
    const pending = applied ? saved.changes.filter((c) => !PLAN_OPS.includes(c.op)) : saved.changes;
    return fitChanges(pending, planItems(current.data));
  };

  /** PATCH with rebase: true. `confirmed` is the change list the student accepted after some no longer matched. */
  const rebase = async (confirmed?: ScenarioChange[], over?: number) => {
    setBusy(true);
    setActionError(null);
    try {
      let changes = confirmed;
      if (!changes) {
        const fit = await fitCurrentPlan();
        if (fit.refused.length > 0) {
          setRebaseRefused(fit);
          return;
        }
        changes = fit.fits;
      }
      const result = await scenarioEndpoints.patch(session.api, saved.id, {
        expected_revision: over ?? saved.revision,
        rebase: true,
        ...(JSON.stringify(changes) === JSON.stringify(saved.changes) ? {} : { changes }),
      });
      setRebaseRefused(null);
      setConflict(false);
      setApplyConflict(null);
      setApplied(null);
      adopt(result.data);
      if (!dirty) setDraft(draftOf(result.data));
      cache.invalidate(`plan:${userId}:${saved.plan_id}`);
      setAnnounce('Scenario rebased on the current record and plan. Re-evaluating.');
    } catch (e) {
      const error = asError(e);
      if (error.kind === 'conflict') conflicted(error, 'rebase');
      else if (error.status === 400) {
        // The plan moved again between the check and the PATCH: name what no longer matches.
        const fit = await fitCurrentPlan().catch(() => null);
        if (fit && fit.refused.length > 0) setRebaseRefused(fit);
        else setActionError(error);
      } else setActionError(error);
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
      setAnnounce('Plan updated. Your record was not changed.');
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

  /** The scenario is gone: forget its cached copy and kept edits, refresh the list and go back to it. */
  const left = (notice: string) => {
    keptDrafts.delete(`${userId}:${saved.id}`);
    cache.invalidate('scenarios:');
    cache.invalidate(`scenario:${userId}:${saved.id}`);
    navigate('/scenarios', { state: { notice } });
  };

  const remove = async (over?: number) => {
    setDialog(null);
    setBusy(true);
    setActionError(null);
    try {
      await scenarioEndpoints.remove(session.api, saved.id, over ?? saved.revision);
      left(`Scenario “${saved.label || 'Untitled scenario'}” deleted. Your baseline plan and accepted record are unchanged.`);
    } catch (e) {
      const error = asError(e);
      if (error.kind === 'conflict') conflicted(error, 'delete');
      else if (error.kind === 'not_found') left(`Scenario “${saved.label || 'Untitled scenario'}” was already deleted.`); // gone elsewhere: nothing left to delete
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
        <p>
          What-if: <strong>{saved.label || 'Untitled scenario'}</strong>. Your record and plans stay unchanged until you apply it.
        </p>
        <span className="scenario-banner-plan">
          Based on plan <strong>{planLabel}</strong>
        </span>
        <Link className="btn btn-small" to={`/plan/${encodeURIComponent(saved.plan_id)}`}>
          Return to baseline
        </Link>
      </section>

      <div className="panel-row">
        <h1>{saved.label || 'Untitled scenario'}</h1>
        <button type="button" className="btn btn-danger" onClick={() => setDialog('delete')} disabled={busy}>
          Delete scenario
        </button>
      </div>
      <p className="visually-hidden" aria-live="polite">
        {announce}
      </p>

      {baselineStale || applyConflict?.rebase ? (
        <div className="callout" data-tone="warning" role="alert">
          <p>
            <strong>The baseline changed.</strong> Your saved record, plan or rules changed after this scenario was created, so it cannot be compared or applied.
            Rebasing moves the baseline to the current record and plan and keeps your hypothetical changes.
          </p>
          <button type="button" className="btn btn-primary" onClick={() => void rebase()} disabled={busy || saving || rebaseRefused !== null}>
            Rebase on current record and plan
          </button>
        </div>
      ) : null}

      {rebaseRefused ? (
        <div className="callout" data-tone="warning" role="alert" aria-label="Changes that no longer match the plan">
          <p>
            <strong>Some changes no longer match the current plan.</strong> These changes cannot be kept:
          </p>
          <ul>
            {rebaseRefused.refused.map((r) => (
              <li key={r.index}>
                {describeChange(r.change, namedItems)}: {r.reason}
              </li>
            ))}
          </ul>
          <p>Rebase without them, or cancel and edit the scenario first.</p>
          <div className="panel-row">
            <button type="button" className="btn btn-primary" onClick={() => void rebase(rebaseRefused.fits)} disabled={busy || saving}>
              Rebase without these changes
            </button>
            <button type="button" className="btn" onClick={() => setRebaseRefused(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {conflict !== false ? (
        <ConflictPanel
          conflictRevision={conflict}
          draftSummary={
            conflictFrom === 'delete' ? (
              <p>Delete this scenario.</p>
            ) : conflictFrom === 'rebase' ? (
              <p>Rebase this scenario on the current record and plan.</p>
            ) : (
              <DraftSummary draft={draft} items={items} />
            )
          }
          onCompare={async () => <DraftSummary draft={draftOf(await reloadScenario(true))} items={items} />}
          onReload={async () => {
            await reloadScenario(false);
            setConflict(false);
          }}
          onKeepMine={async () => {
            // Repeat the request that conflicted over the newer revision: a delete stays a delete.
            const fresh = await reloadScenario(true);
            if (conflictFrom === 'delete') await remove(fresh.revision);
            else if (conflictFrom === 'rebase') await rebase(undefined, fresh.revision);
            else await save(fresh.revision);
          }}
        />
      ) : null}
      {saveError ? <ProblemPanel error={saveError} verb="saved" onRetry={() => void save()} /> : null}
      {actionError ? <ProblemPanel error={actionError} verb="changed" /> : null}

      <ol className="scn-steps" aria-label="Scenario steps">
        <li className="scn-step">
          <h2>What would you change?</h2>
      <div className="panel scn-name">
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
            {saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'Saved'}
          </span>
        </div>
      </div>

      {plan.error ? <ErrorPanel error={plan.error} onRetry={plan.reload} /> : null}
      {plan.loading ? <StatePanel kind="loading" title="Loading the baseline plan…" /> : null}
      <ChangesEditor plan={plan.data} items={items} named={namedItems} changes={draft.changes} onChange={(changes, message) => edit({ changes }, message)} />
      <InternshipEditor
        value={draft.internship}
        onChange={(internship, message) => edit({ internship }, message)}
        modules={own?.scenario?.internship?.modules ?? null}
        presets={calendar.data?.internship_presets ?? null}
      />

        </li>
        <li className="scn-step">
          <h2>What happens</h2>
      <div className="scn-compare">
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
            ? 'Checking again… the results below are out of date.'
            : dirty
              ? 'You have unsaved changes. The results below are for the saved version; save to check again.'
              : compare
                ? 'Results are up to date.'
                : 'Not evaluated yet.'}
        </p>
        {compareError ? <ErrorPanel error={compareError} onRetry={() => void runCompare(saved.revision, compareIds)} /> : null}
        {!compare && comparing ? <StatePanel kind="loading" title="Comparing…" /> : null}
        {headline ? <HeadlineFigures comparison={headline} stale={resultsStale} /> : null}
        {compare ? (
          <details className="scn-fold" open={foldOpen} onToggle={(e) => setFoldOpen((e.currentTarget as HTMLDetailsElement).open)}>
            <summary>Full comparison</summary>
            <CompareView comparisons={compare.data.comparisons} cases={compare.data.internship_cases} scenarios={allScenarios} items={items} stale={resultsStale} />
            {problemCount(compare.issues, items) > 0 ? (
              <details>
                <summary>{`Things to check (${problemCount(compare.issues, items)})`}</summary>
                <ProblemList issues={compare.issues} items={items} />
              </details>
            ) : null}
            {own?.scenario?.internship ? <InternshipPanels evaluation={own.scenario.internship} assumptions={ownCase?.completion_assumptions} items={items} stale={resultsStale} /> : null}
          </details>
        ) : null}
      </div>

        </li>
        <li className="scn-step">
          <h2>Keep it or drop it</h2>
      <div className="scn-apply">
        <p className="muted">Only drop, postpone and replace changes are written to your plan. Your record is never changed.</p>
        {applyConflict ? (
          <div className="callout" data-tone="danger" role="alert">
            <p>
              <strong>Not applied.</strong> {applyConflict.message.replace(/\.$/, '')}
              . Nothing was changed and nothing is retried
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
              <strong>Plan updated.</strong> Your record was not changed.
            </p>
            {applied.not_applied.length > 0 ? (
              <>
                <p>These stay in the scenario and were not written to your plan:</p>
                <ul>
                  {applied.not_applied.map((n, i) => (
                    <li key={i}>{describeSkipped(n, saved.changes, namedItems)}</li>
                  ))}
                </ul>
                {[...new Set(applied.not_applied.map((n) => n.reason))].map((reason) => (
                  <p key={reason} className="muted">
                    {reason}
                  </p>
                ))}
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
      </div>
        </li>
      </ol>

      <ConfirmDialog open={dialog === 'apply'} title="Apply plan edits" confirmLabel="Apply to plan" onConfirm={apply} onCancel={() => setDialog(null)}>
        <p>
          These edits will be written to {planLabel}. Your record is never changed.
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
      <ConfirmDialog open={dialog === 'delete'} title="Delete scenario" confirmLabel="Delete scenario" danger onConfirm={() => remove()} onCancel={() => setDialog(null)}>
        <p>
          Delete “{saved.label || 'Untitled scenario'}”? Its hypothetical changes are discarded. Your baseline plan and accepted record are not changed.
        </p>
      </ConfirmDialog>
    </div>
  );
}

/** A failed save or action in student words: what happened, that the changes are still here, and what to do. */
function ProblemPanel({ error, verb, onRetry }: { error: ApiError; verb: 'saved' | 'changed'; onRetry?: () => void }) {
  if (error.kind === 'not_found')
    return (
      <StatePanel
        kind="error"
        title="This scenario no longer exists"
        detail="It was deleted in another tab or on another device, so nothing was saved."
        action={<Link to="/scenarios">Your scenarios</Link>}
      />
    );
  const title = error.kind === 'network' ? 'CoursePath could not be reached' : error.kind === 'auth' ? 'Sign in to continue' : `The scenario could not be ${verb}`;
  const detail =
    error.kind === 'network'
      ? 'Your changes are still here and have not been saved. Check your connection and try again.'
      : error.kind === 'auth'
        ? 'Your session ended. Sign in again; your changes in this tab are kept until you leave the page.'
        : plainMessage(error.message) || 'Try again in a moment. Your changes are still here.';
  return (
    <StatePanel
      kind="error"
      title={title}
      detail={detail}
      action={
        onRetry && error.kind !== 'auth' ? (
          <button type="button" className="btn" onClick={onRetry}>
            Try again
          </button>
        ) : undefined
      }
    />
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
