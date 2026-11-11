import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { endpoints } from '../../api/endpoints';
import { useCatalogue, useCurriculum, usePlans, useRecord } from '../../api/hooks';
import { useResource, useResourceCache } from '../../api/resources';
import type { AcademicPlan, AcademicRecord, PlannedSemester, PlanPayload, PlanValidation, RequirementDefinition } from '../../api/types';
import { useSaveQueue } from '../../api/useSaveQueue';
import { PLAN_TABS, SubNav } from '../../app/AppShell';
import { useSession } from '../../app/session';
import { usePublishView } from '../../app/viewContext';
import { ConflictPanel } from '../../components/ConflictPanel';
import { CoursePicker, type PickedCourse } from '../../components/CoursePicker';
import { Dialog } from '../../components/Dialog';
import { SaveStatusIndicator } from '../../components/SaveStatusIndicator';
import { ErrorPanel, StatePanel } from '../../components/StatePanel';
import { Badge, SeverityBadge } from '../../components/StatusBadge';
import { compareTerms, formatCredits, formatTerm } from '../../lib/format';
import { newId } from '../../lib/ids';
import { latestCompletedTerm, moveTargets, nextRegularTerm } from '../../lib/terms';
import { isDecimalString } from '../../lib/validation';
import { requirementLabel } from '../requirements/RequirementTree';
import type { SectionChoice } from './SectionPicker';
import { useCoursePlans } from './CoursePlan';
import { GeneratePlanPanel } from './GeneratePlanPanel';
import { PlanStatusBadge } from './PlanStatusNote';
import { useDeletePlan, UnsavedChangesError } from './deletePlan';
import { meterLevel, meterWidth, sumCredits } from './loadLevel';
import { plainIssues, type PlainIssue } from './plainIssues';
import { PlanLoadStrip, type LoadCell } from './PlanLoadStrip';
import { isNamedOnline, isOnline, nextOnlineId, OnlineCourseForm, onlinePlaceholder } from './OnlineCourseForm';
import { moreCredits, PlanProgress } from './PlanProgress';
import { usePlanCheck } from './usePlanCheck';
import { studentIssues } from './savedPlanIssues';
import { TermTimetablePanel } from './TermTimetablePanel';
import './plan.css';

function planPayload(p: AcademicPlan | PlanPayload): PlanPayload {
  return { ...(p.label !== undefined ? { label: p.label } : {}), semesters: p.semesters };
}

/** /plan — list plans or create the first one. */
export function PlanIndexPage() {
  const plans = usePlans();
  const record = useRecord();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const wantsGenerate = params.get('generate') === '1'; // opened from the command bar: generate once, then drop the parameter
  const dropGenerate = useCallback(
    () =>
      setParams(
        (now) => {
          const next = new URLSearchParams(now);
          next.delete('generate');
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  const removal = useDeletePlan({ onDeleted: () => undefined });
  const justDeleted = (location.state as { deleted?: string } | null)?.deleted ?? null; // set when a plan was deleted from its own page
  usePublishView({ dataMode: 'projected', recordRevision: record.data?.revision ?? null });

  return (
    <div>
      <SubNav label="Plan" items={PLAN_TABS} />
      <h1>Plans</h1>
      {record.data ? <GeneratePlanPanel record={record.data} autoStart={wantsGenerate} onAutoStarted={dropGenerate} /> : null}
      {plans.loading || record.loading ? <StatePanel kind="loading" title="Loading your plans…" /> : null}
      {plans.error ? <ErrorPanel error={plans.error} onRetry={plans.reload} /> : null}
      {justDeleted && !removal.showsMessage ? (
        <p className="callout" data-tone="success" role="status">
          Deleted “{justDeleted}”.
        </p>
      ) : null}
      {removal.notice}
      {removal.confirmation}
      {plans.data && plans.data.length > 0 ? (
        <ul className="issue-list" aria-label="Your saved plans">
          {plans.data.map((p) => {
            const name = p.label ?? 'Untitled plan';
            return (
              <li key={p.id}>
                <Link to={`/plan/${encodeURIComponent(p.id)}`}>{name}</Link> <PlanStatusBadge status={p.status} /> <span className="muted num">· {p.semesters.length} semesters</span>{' '}
                <button
                  type="button"
                  className="btn btn-small btn-danger"
                  aria-label={`Delete plan ${name}`}
                  disabled={removal.busyId !== null}
                  onClick={() => removal.ask({ id: p.id, label: name, revision: p.revision })}
                >
                  {removal.busyId === p.id ? 'Deleting…' : 'Delete plan'}
                </button>
              </li>
            );
          })}
        </ul>
      ) : plans.data ? (
        <p>You have no saved plans yet. Generate one above, change it, and save it.</p>
      ) : null}
    </div>
  );
}

/** /plan/:plan_id — semester table planner. */
export function PlanPage() {
  const { plan_id: planId = '' } = useParams();
  const session = useSession();
  const record = useRecord();
  const loaded = useResource(session.user ? `plan:${session.user.id}:${planId}` : null, (signal) => endpoints.plan(session.api, planId, { signal }));
  const curriculum = useCurriculum();
  usePublishView({ ruleVersion: record.data?.profile.curriculum_version ?? null, reviewStatus: curriculum.data?.review_status ?? null, dataMode: 'projected', recordRevision: record.data?.revision ?? null });
  if (loaded.loading || record.loading) return <StatePanel kind="loading" title="Loading plan…" />;
  if (loaded.error || !loaded.data)
    return loaded.error ? (
      loaded.error.kind === 'not_found' ? (
        <StatePanel kind="error" title="Plan not found" detail="It may have been deleted, or it belongs to another account." action={<Link to="/plan">Your plans</Link>} />
      ) : (
        <ErrorPanel error={loaded.error} onRetry={loaded.reload} />
      )
    ) : null;
  return <Planner key={loaded.data.id} initial={loaded.data} record={record.data ?? null} recordRevision={record.data?.revision ?? null} latestCompleted={latestCompletedTerm(record.data?.attempts ?? [])} />;
}

type Dialogs = { kind: 'course'; term: string } | { kind: 'placeholder'; term: string } | { kind: 'online'; term: string } | { kind: 'resolve'; term: string; placeholderId: string } | null;

function Planner({ initial, record, recordRevision, latestCompleted }: { initial: AcademicPlan; record: AcademicRecord | null; recordRevision: number | null; latestCompleted: string | null }) {
  const session = useSession();
  const cache = useResourceCache();
  const catalogue = useCatalogue();
  const curriculum = useCurriculum();
  const navigate = useNavigate();
  const ackRevision = useRef(initial.revision); // the newest revision the server has acknowledged for this plan
  const [validation, setValidation] = useState<{ revision: number; data: PlanValidation } | null>(null);
  const [validationError, setValidationError] = useState<ApiError | null>(null);
  const [undo, setUndo] = useState<PlanPayload[]>([]);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [highlight, setHighlight] = useState<Set<string>>(new Set());
  const [announce, setAnnounce] = useState('');

  const queue = useSaveQueue<PlanPayload>(`plan:${initial.id}`, { value: planPayload(initial), revision: initial.revision }, async (draft, revision, signal) => {
    const result = await endpoints.patchPlan(session.api, initial.id, { ...draft, expected_revision: revision }, { signal });
    setValidation({ revision: result.data.revision, data: result.data.validation });
    ackRevision.current = result.data.revision;
    // Keep the cached copy of this plan current: coming back to it later must start from the saved revision, never an older one (that would 409 on the next edit).
    if (session.user) cache.set(`plan:${session.user.id}:${initial.id}`, { data: { id: result.data.id, revision: result.data.revision, ...planPayload(result.data) }, issues: [] });
    cache.invalidate('analysis:');
    cache.invalidate('plans:');
    return { revision: result.data.revision, value: planPayload(result.data) };
  }, session.user?.id ?? null);
  const plan = queue.value ?? planPayload(initial);
  const revision = queue.state?.revision ?? initial.revision;
  const latest = useRef({ status: queue.state?.status ?? 'idle', conflictRevision: queue.state?.conflictRevision ?? null });
  latest.current = { status: queue.state?.status ?? 'idle', conflictRevision: queue.state?.conflictRevision ?? null };
  useEffect(() => {
    ackRevision.current = revision;
  }, [revision]);

  // Deleting from the plan's own page: send a waiting edit first so the delete uses the newest revision; after a conflict use the server's revision.
  const removal = useDeletePlan({
    onDeleted: (target) => navigate('/plan', { state: { deleted: target.label } }),
    prepare: async () => {
      const { status, conflictRevision } = latest.current;
      if (status === 'conflict' && conflictRevision !== null) return conflictRevision;
      if (status === 'pending' || status === 'saving') {
        const before = ackRevision.current;
        await queue.flush();
        if (ackRevision.current === before) throw new UnsavedChangesError();
      }
      return ackRevision.current;
    },
  });

  // Initial server validation of the persisted plan (no mutation).
  const validatedOnce = useRef(false);
  useEffect(() => {
    if (validatedOnce.current || recordRevision === null) return;
    validatedOnce.current = true;
    const controller = new AbortController();
    endpoints
      .validatePlan(session.api, initial.id, { record_revision: recordRevision, plan_revision: initial.revision }, { signal: controller.signal })
      .then((r) => setValidation((v) => v ?? { revision: initial.revision, data: r.data }))
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.kind !== 'aborted') setValidationError(e);
      });
    return () => controller.abort();
  }, [session.api, initial.id, initial.revision, recordRevision]);

  const edit = useCallback(
    (next: PlanPayload, message: string) => {
      setUndo((u) => [...u.slice(-19), plan]);
      queue.edit(next);
      setAnnounce(message);
    },
    [plan, queue],
  );

  const updateSemester = (term: string, fn: (s: PlannedSemester) => PlannedSemester) => ({ ...plan, semesters: plan.semesters.map((s) => (s.term_id === term ? fn(s) : s)) });

  const terms = useMemo(() => [...plan.semesters].sort((a, b) => compareTerms(a.term_id, b.term_id)), [plan.semesters]);
  // What is left for graduation and how much room each semester has, from the server, after every change (the same check the draft plan uses).
  const progress = usePlanCheck(recordRevision ?? 0, recordRevision === null ? null : plan.semesters);
  const currentTerm = latestCompleted ? nextRegularTerm(latestCompleted) : null;
  // CR-75: "checking" belongs to a save or check that is on its way. When the save is stuck (offline, an error or a conflict) nothing is being
  // checked, so the problems already known stay on screen, marked as out of date, instead of vanishing behind a "Checking…" that never ends.
  const draftNotSaved = queue.state?.draft != null;
  const saveOnItsWay = draftNotSaved && (queue.state?.status === 'pending' || queue.state?.status === 'saving');
  const stale = validation !== null && (validation.revision !== revision || saveOnItsWay);
  const outOfDate = validation !== null && !stale && draftNotSaved;
  const issues = validation?.data.issues ?? [];
  const codeFor = (id: string) => plan.semesters.flatMap((s) => s.courses).find((c) => c.id === id)?.normalized_code;
  const shownIssues = useMemo(() => plainIssues(stale ? [] : studentIssues(issues), codeFor), [stale, issues, plan.semesters]); // eslint-disable-line react-hooks/exhaustive-deps
  const titles = useMemo(() => new Map((catalogue.data?.courses ?? []).map((c) => [c.normalized_code, c.title ?? ''])), [catalogue.data]);
  const requirementOptions = useMemo(() => flattenRequirements(curriculum.data?.requirements ?? []), [curriculum.data]);
  // A placeholder holds credits for one requirement a student works on (Open electives, the HSS electives), never for a whole group such as Institute core.
  const placeholderOptions = useMemo(() => {
    const leaves = requirementOptions.filter((r) => (r.children ?? []).length === 0 && r.type !== 'noncredit');
    return leaves.length > 0 ? leaves : requirementOptions;
  }, [requirementOptions]);

  const move = (fromTerm: string, itemId: string, toTerm: string) => {
    const item = plan.semesters.find((s) => s.term_id === fromTerm)?.courses.find((c) => c.id === itemId);
    if (!item || fromTerm === toTerm || !moveTargets(fromTerm, [toTerm]).includes(toTerm)) return;   // D-50: odd to odd, even to even
    // The section and variant the student chose belong to the term the course leaves; the new term's own are chosen again (D-51).
    const { offering_id: _offering, section_ids: _sections, ...moved } = item; // eslint-disable-line @typescript-eslint/no-unused-vars
    const next = { ...plan, semesters: plan.semesters.map((s) => (s.term_id === fromTerm ? { ...s, courses: s.courses.filter((c) => c.id !== itemId) } : s.term_id === toTerm ? { ...s, courses: [...s.courses, moved] } : s)) };
    edit(next, `Moved ${item.normalized_code} to ${formatTerm(toTerm)}. Check validation for downstream effects.`);
  };

  const extend = () => {
    const last = terms.at(-1)?.term_id;
    const next = last ? nextRegularTerm(last) : null;
    if (!next) return;
    edit({ ...plan, semesters: [...plan.semesters, { term_id: next, courses: [], placeholders: [] }] }, `Added ${formatTerm(next)}.`);
  };

  // A summer break can hold online courses (at most 10 credits). One can be added for every academic year whose second semester is in the plan.
  const summerChoices = useMemo(() => {
    const have = new Set(plan.semesters.map((s) => s.term_id));
    return plan.semesters
      .filter((s) => s.term_id.endsWith('-II'))
      .map((s) => `${s.term_id.slice(0, 7)}-SUMMER`)
      .filter((t) => !have.has(t))
      .sort(compareTerms);
  }, [plan.semesters]);
  const addSummer = (term: string) => {
    if (!term || plan.semesters.some((s) => s.term_id === term)) return;
    edit({ ...plan, semesters: [...plan.semesters, { term_id: term, courses: [], placeholders: [] }] }, `Added ${formatTerm(term)}.`);
  };

  const pick = (term: string, picked: PickedCourse, extra: { replacePlaceholder?: string; intended?: string } = {}) => {
    const course = {
      id: newId('planned'),
      normalized_code: picked.normalized_code,
      credits: picked.credits,
      ...(picked.course_version_id ? { course_version_id: picked.course_version_id } : {}),
      ...(extra.intended ? { intended_allocation: extra.intended } : {}),
    };
    edit(
      updateSemester(term, (s) => ({ ...s, courses: [...s.courses, course], placeholders: extra.replacePlaceholder ? s.placeholders.filter((p) => p.id !== extra.replacePlaceholder) : s.placeholders })),
      `Added ${picked.normalized_code} to ${formatTerm(term)}.`,
    );
    setDialog(null);
  };

  // A08: a section/variant choice is an ordinary plan edit (save queue, expected_revision, 409 panel).
  const chooseSections = (term: string, itemId: string, choice: SectionChoice) => {
    const code = plan.semesters.find((s) => s.term_id === term)?.courses.find((c) => c.id === itemId)?.normalized_code ?? 'course';
    edit(
      updateSemester(term, (s) => ({ ...s, courses: s.courses.map((c) => (c.id === itemId ? { ...c, offering_id: choice.offering_id, section_ids: choice.section_ids } : c)) })),
      `Saved section choice for ${code} in ${formatTerm(term)}.`,
    );
  };

  const reloadFromServer = async () => {
    const fresh = await endpoints.plan(session.api, initial.id);
    queue.reload(planPayload(fresh.data), fresh.data.revision);
    setUndo([]);
    if (recordRevision !== null) {
      const v = await endpoints.validatePlan(session.api, initial.id, { record_revision: recordRevision, plan_revision: fresh.data.revision });
      setValidation({ revision: fresh.data.revision, data: v.data });
    }
  };

  const status = queue.state?.status ?? 'idle';
  const undoLast = () => {
    const previous = undo.at(-1);
    if (!previous) return;
    setUndo((u) => u.slice(0, -1));
    queue.edit(previous);
    setAnnounce('Undid the last change.');
  };

  // One cell per semester for the load strip. The numbers are the ones the semester cards show (the server's validation of the saved plan),
  // else the server's check of the plan as it stands.
  const shown = stale || outOfDate ? null : (validation?.data ?? null);
  const plannedOf = (term: string): string | undefined => {
    const w = shown?.workload[term];
    return w ? (w.target_credits ?? w.selected_credits) : progress.check?.load[term]?.planned_credits;
  };
  const limitOf = (term: string) => progress.check?.load[term]?.limit_credits ?? (term.endsWith('SUMMER') ? '10' : '28');
  const cells: LoadCell[] = terms.flatMap((s) => {
    const planned = plannedOf(s.term_id);
    return planned === undefined ? [] : [{ term: s.term_id, planned, limit: limitOf(s.term_id) }];
  });
  const planTotal = cells.length === terms.length && progress.check ? sumCredits(cells.map((c) => c.planned)) : undefined;

  return (
    <div className="pb-page">
      <SubNav label="Plan" items={PLAN_TABS} />
      {record ? <GeneratePlanPanel record={record} /> : null}
      <div className="pb-pagehead">
        <h1>{plan.label ?? 'Plan'}</h1>
        <div className="panel-row">
          <SaveStatusIndicator label="Plan save status" status={status} revision={revision} savedAt={queue.state?.savedAt} />
          <button type="button" className="btn" onClick={undoLast} disabled={undo.length === 0 || status === 'conflict'}>
            Undo last change
          </button>
          <Link className="btn" to={`/report/${encodeURIComponent(initial.id)}`}>
            Printable report
          </Link>
          <button
            type="button"
            className="btn btn-danger"
            aria-label={`Delete plan ${plan.label ?? 'Plan'}`}
            disabled={removal.busyId !== null}
            onClick={() => removal.ask({ id: initial.id, label: plan.label ?? 'Plan', revision })}
          >
            {removal.busyId === initial.id ? 'Deleting…' : 'Delete plan'}
          </button>
        </div>
      </div>
      {removal.notice}
      {removal.confirmation}
      <p className="muted">
        <Link to="/scenarios">What-if scenarios</Link>
      </p>
      <p className="visually-hidden" aria-live="polite">
        {announce}
      </p>

      {status === 'conflict' && queue.state ? (
        <ConflictPanel
          conflictRevision={queue.state.conflictRevision}
          draftSummary={<PlanSummary plan={plan} />}
          onCompare={async () => <PlanSummary plan={planPayload((await endpoints.plan(session.api, initial.id)).data)} />}
          onReload={reloadFromServer}
          onKeepMine={async () => {
            const fresh = await endpoints.plan(session.api, initial.id);
            queue.keepMineOver(fresh.data.revision);
          }}
        />
      ) : null}
      {status === 'error' || status === 'offline' ? (
        <div className="callout" data-tone="warning" role="alert">
          {status === 'offline' ? 'You appear to be offline. Your changes are kept in this tab but are not saved to your account yet.' : (queue.state?.error?.message ?? 'Save failed.')}{' '}
          <button type="button" className="btn btn-small" onClick={() => queue.retry()}>
            Retry save
          </button>
        </div>
      ) : null}

      <PlanLoadStrip cells={cells} />
      {progress.conflict ? (
        <div className="callout" data-tone="danger" role="alert">
          <p>
            <strong>Your record was saved elsewhere</strong> since this page loaded, so the credits left below may be out of date. Reload your record to update them.
          </p>
          <button type="button" className="btn" onClick={() => cache.invalidate('record:')}>
            Reload my record
          </button>
        </div>
      ) : progress.error ? (
        <div className="callout" data-tone="warning" role="alert">
          <p>{progress.error.message} The credits left below may be out of date.</p>
          <button type="button" className="btn" onClick={progress.retry}>
            Try again
          </button>
        </div>
      ) : null}
      <PlanProgress check={progress.check} pending={progress.pending} outOfDate={progress.conflict || progress.error !== null} showOnlineWarnings plannedTotal={planTotal} />

      <p className="muted">A course can move to another odd semester, or to another even semester: it is offered in the same kind of semester each year.</p>
      <div className="pb-board">
        {terms.map((s) => (
          <SemesterTable
            key={s.term_id}
            semester={s}
            allTerms={terms.map((t) => t.term_id)}
            isCurrent={s.term_id === currentTerm}
            validation={shown}
            roomLeft={progress.check?.load[s.term_id]?.available_credits ?? null}
            limit={limitOf(s.term_id)}
            issues={outOfDate ? [] : shownIssues} /* a row never carries a problem found for an older version of the plan */
            highlight={highlight}
            requirementName={(id) => requirementLabel(requirementOptions.find((r) => r.id === id), undefined)}
            titleOf={(code) => titles.get(code) ?? ''}
            onMove={(itemId, to) => move(s.term_id, itemId, to)}
            onRemoveCourse={(itemId, code) => edit(updateSemester(s.term_id, (x) => ({ ...x, courses: x.courses.filter((c) => c.id !== itemId) })), `Removed ${code}.`)}
            onRemovePlaceholder={(id, label) => edit(updateSemester(s.term_id, (x) => ({ ...x, placeholders: x.placeholders.filter((p) => p.id !== id) })), `Removed placeholder ${label}.`)}
            onAddCourse={() => setDialog({ kind: 'course', term: s.term_id })}
            onAddPlaceholder={() => setDialog({ kind: 'placeholder', term: s.term_id })}
            onAddOnline={() => setDialog({ kind: 'online', term: s.term_id })}
            onResolve={(placeholderId) => setDialog({ kind: 'resolve', term: s.term_id, placeholderId })}
          />
        ))}
      </div>
      <div className="panel-row">
        <button type="button" className="btn" onClick={extend}>
          Extend plan by one term
        </button>
        {summerChoices.length > 0 ? (
          <div className="field" style={{ maxWidth: '22rem' }}>
            <label htmlFor="add-summer-break">Add a summer break</label>
            <select id="add-summer-break" value="" onChange={(e) => addSummer(e.target.value)}>
              <option value="">Choose a summer break</option>
              {summerChoices.map((t) => (
                <option key={t} value={t}>
                  {formatTerm(t)}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      <section className="panel pb-validation" aria-label="Plan validation">
        <h2>Validation</h2>
        {stale ? (
          <p className="muted" role="status">
            Checking your latest changes…
          </p>
        ) : null}
        {outOfDate ? (
          <p className="muted" role="status">
            These checks describe the last version that was saved. Your latest changes are not saved yet, so they have not been checked.
          </p>
        ) : null}
        {validationError ? <ErrorPanel error={validationError} /> : null}
        {!validation && !validationError ? <StatePanel kind="loading" title="Checking your plan…" /> : null}
        {validation && !stale ? (
          <PlanProblems
            issues={shownIssues}
            onSelect={(i) => {
              setHighlight(new Set(i.entityRefs));
              const first = i.entityRefs[0];
              const target = first ? document.querySelector<HTMLElement>(`[data-item="${CSS.escape(first)}"]`) : null;
              target?.scrollIntoView?.({ block: 'center' });
            }}
          />
        ) : null}
      </section>

      <div className="pb-timetables">
        {terms.map((s) => (
          <TermTimetablePanel key={s.term_id} semester={s} validation={shown} issues={stale || outOfDate ? [] : issues} onChooseSections={(id, choice) => chooseSections(s.term_id, id, choice)} />
        ))}
      </div>

      <Dialog open={dialog?.kind === 'course'} title={`Add course to ${dialog ? formatTerm(dialog.term) : ''}`} onClose={() => setDialog(null)} variant="drawer">
        {dialog?.kind === 'course' ? <CoursePicker term={dialog.term} courses={catalogue.data?.courses ?? []} coverage={catalogue.data?.coverage ?? 'unknown'} onPick={(c) => pick(dialog.term, c)} /> : null}
      </Dialog>
      {dialog?.kind === 'resolve'
        ? (() => {
            const ph = plan.semesters.find((s) => s.term_id === dialog.term)?.placeholders.find((p) => p.id === dialog.placeholderId);
            const label = ph?.label ?? 'placeholder';
            return (
              <Dialog open title={`Choose a course for ${label}`} onClose={() => setDialog(null)} variant="drawer">
                <p className="muted">The chosen course replaces the placeholder.</p>
                <CoursePicker
                  term={dialog.term}
                  courses={catalogue.data?.courses ?? []}
                  coverage={catalogue.data?.coverage ?? 'unknown'}
                  submitLabel="Use this course"
                  onPick={(c) => pick(dialog.term, c, { replacePlaceholder: dialog.placeholderId, intended: ph?.requirement_id })}
                />
              </Dialog>
            );
          })()
        : null}
      {dialog?.kind === 'online' ? (
        <Dialog open title={`Add online course to ${formatTerm(dialog.term)}`} onClose={() => setDialog(null)}>
          <OnlineCourseForm
            term={dialog.term}
            requirements={progress.check?.requirements}
            room={progress.check?.load[dialog.term]?.available_credits}
            onCancel={() => setDialog(null)}
            onAdd={(choice) => {
              const id = nextOnlineId(dialog.term, plan.semesters);
              edit(updateSemester(dialog.term, (s) => ({ ...s, placeholders: [...s.placeholders, onlinePlaceholder(id, choice)] })), `Added online course ${choice.label} to ${formatTerm(dialog.term)}.`);
              setDialog(null);
            }}
          />
        </Dialog>
      ) : null}
      {dialog?.kind === 'placeholder' ? (
        <PlaceholderDialog
          term={dialog.term}
          options={placeholderOptions}
          onClose={() => setDialog(null)}
          onAdd={(ph) => {
            edit(updateSemester(dialog.term, (s) => ({ ...s, placeholders: [...s.placeholders, ph] })), `Added placeholder ${ph.label ?? ''}.`);
            setDialog(null);
          }}
        />
      ) : null}
    </div>
  );
}

function flattenRequirements(defs: RequirementDefinition[], depth = 0): (RequirementDefinition & { depth: number })[] {
  return defs.flatMap((d) => [{ ...d, depth }, ...flattenRequirements(d.children ?? [], depth + 1)]);
}

function PlanProblems({ issues, onSelect }: { issues: PlainIssue[]; onSelect: (issue: PlainIssue) => void }) {
  if (issues.length === 0) return <p>No problems found with your plan.</p>;
  const groups: [string, PlainIssue[]][] = [
    ['Errors', issues.filter((i) => i.severity === 'error')],
    ['Needs approval', issues.filter((i) => i.severity === 'approval_required')],
    ['Warnings', issues.filter((i) => i.severity === 'warning')],
  ];
  return (
    <>
      {groups
        .filter(([, list]) => list.length > 0)
        .map(([title, list]) => (
          <div key={title}>
            <h3>{`${title} (${list.length})`}</h3>
            <ul className="issue-list">
              {list.map((i) => (
                <li key={i.key} data-severity={i.severity}>
                  <SeverityBadge severity={i.severity} /> {i.message}
                  {i.entityRefs.length > 0 ? (
                    <>
                      {' '}
                      <button type="button" className="btn btn-small btn-quiet" aria-label={`Show affected items: ${i.message}`} onClick={() => onSelect(i)}>
                        Show affected items
                      </button>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
    </>
  );
}

function PlanSummary({ plan }: { plan: PlanPayload }) {
  return (
    <ul>
      {[...plan.semesters].sort((a, b) => compareTerms(a.term_id, b.term_id)).map((s) => (
        <li key={s.term_id}>
          {formatTerm(s.term_id)}: {s.courses.map((c) => c.normalized_code).join(', ') || 'no courses'}
          {s.placeholders.length ? ` + ${s.placeholders.length} placeholder(s)` : ''}
        </li>
      ))}
    </ul>
  );
}

function SemesterTable({
  semester,
  allTerms,
  isCurrent,
  validation,
  roomLeft,
  limit,
  issues,
  highlight,
  requirementName,
  titleOf,
  onMove,
  onRemoveCourse,
  onRemovePlaceholder,
  onAddCourse,
  onAddPlaceholder,
  onAddOnline,
  onResolve,
}: {
  semester: PlannedSemester;
  allTerms: string[];
  isCurrent: boolean;
  /** Null while loading or while the plan has unvalidated edits. */
  validation: PlanValidation | null;
  /** Credits that still fit in this semester under the 28-credit limit (server number), or null before the first answer. */
  roomLeft: string | null;
  /** The most credits this semester can hold: 28, or 10 for a summer break. */
  limit: string;
  issues: PlainIssue[];
  highlight: Set<string>;
  requirementName: (id: string) => string;
  titleOf: (code: string) => string;
  onMove: (itemId: string, to: string) => void;
  onRemoveCourse: (itemId: string, code: string) => void;
  onRemovePlaceholder: (id: string, label: string) => void;
  onAddCourse: () => void;
  onAddPlaceholder: () => void;
  onAddOnline: () => void;
  onResolve: (placeholderId: string) => void;
}) {
  const headingId = useId();
  const label = formatTerm(semester.term_id);
  const coursePlan = useCoursePlans(semester.term_id, validation?.per_course);
  const workload = validation?.workload[semester.term_id];
  const planned = workload ? (workload.target_credits ?? workload.selected_credits) : undefined;
  const termIssues = issues.filter((i) => i.entityRefs.includes(semester.term_id));
  const itemIssues = (id: string) => issues.filter((i) => i.entityRefs.includes(id));
  return (
    <section className="pb-col" aria-labelledby={headingId} data-current={isCurrent ? 'true' : undefined}>
      <div className="pb-colhead">
        <div className="pb-colhead-row">
          <h2 id={headingId}>{label}</h2>
          {isCurrent ? <span className="pb-tag">Current term</span> : null}
          {planned !== undefined ? (
            <span className="pb-used" aria-hidden="true">
              {`${formatCredits(planned)} / ${formatCredits(limit)}`}
            </span>
          ) : null}
        </div>
        <div className="pb-meter" aria-hidden="true" data-level={meterLevel(planned, limit)}>
          <i style={{ width: `${meterWidth(planned, limit)}%` }} />
        </div>
      </div>
      {workload ? (
        <p className="pb-load">
          {`${semester.term_id.endsWith('SUMMER') ? 'Summer' : 'Semester'} total: ${formatCredits(workload.target_credits ?? workload.selected_credits)} / ${formatCredits(limit)} credits`}
          {termIssues.some((i) => /-credit limit/.test(i.message)) ? <strong className="field-error">{` Over the ${formatCredits(limit)}-credit limit`}</strong> : null}
          {roomLeft !== null ? <span>{Number(roomLeft) > 0 ? ` — ${moreCredits(roomLeft)} can be added` : ' — no more credits can be added'}</span> : null}
          {workload.online_credits && Number(workload.online_credits) > 0 ? <span>{` — plus ${formatCredits(workload.online_credits)} online credits, outside this limit`}</span> : null}
        </p>
      ) : null}
      {termIssues.length > 0 ? (
        <ul className="pb-problems">
          {termIssues.map((i) => (
            <li key={i.key} data-severity={i.severity}>
              {i.message}
            </li>
          ))}
        </ul>
      ) : null}
      {semester.courses.length === 0 && semester.placeholders.length === 0 ? (
        <p className="pb-empty">No courses planned for this term.</p>
      ) : (
        <table className="pb-chips pb-saved">
          <caption>Planned items for {label}</caption>
          <thead>
            <tr>
              <th scope="col">Course</th>
              <th scope="col" className="num">
                Credits
              </th>
              <th scope="col">Counts toward</th>
              <th scope="col">Problems</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {semester.courses.map((c) => {
              const moveId = `${headingId}-move-${c.id}`;
              return (
                <tr key={c.id} data-item={c.id} data-highlight={highlight.has(c.id) ? 'true' : undefined}>
                  <th scope="row" data-label="Course" className="pb-code">
                    <span className="mono">{c.normalized_code}</span>
                    {titleOf(c.normalized_code) ? <div className="muted">{titleOf(c.normalized_code)}</div> : null}
                    <div className="pb-courseplan">{coursePlan(c)}</div>
                  </th>
                  <td className="num pb-cr" data-label="Credits">
                    {formatCredits(c.credits)}
                  </td>
                  <td data-label="Counts toward" className="pb-for">
                    {c.intended_allocation ? requirementName(c.intended_allocation) : ''}
                  </td>
                  <td data-label="Problems" className="pb-prob">
                    {itemIssues(c.id).map((i) => (
                      <div key={i.key}>
                        <SeverityBadge severity={i.severity} /> {i.message}
                      </div>
                    ))}
                  </td>
                  <td data-label="Actions" className="pb-act">
                    <label htmlFor={moveId} className="visually-hidden">
                      Move {c.normalized_code} to
                    </label>
                    <select id={moveId} defaultValue={semester.term_id}>
                      {moveTargets(semester.term_id, allTerms).map((t) => (
                        <option key={t} value={t}>
                          {formatTerm(t)}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn btn-small"
                      aria-label={`Move ${c.normalized_code}`}
                      onClick={() => {
                        const el = document.getElementById(moveId) as HTMLSelectElement | null;
                        if (el) onMove(c.id, el.value);
                      }}
                    >
                      Move
                    </button>
                    <button type="button" className="btn btn-small btn-danger" aria-label={`Remove ${c.normalized_code}`} onClick={() => onRemoveCourse(c.id, c.normalized_code)}>
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
            {semester.placeholders.map((p) => {
              const name = p.label ?? requirementName(p.requirement_id);
              const online = isOnline(p);
              const named = isNamedOnline(p); // the student named it: the course is chosen already
              return (
                <tr key={p.id} className="pb-ph" data-item={p.id} data-online={online ? 'true' : undefined} data-highlight={highlight.has(p.id) ? 'true' : undefined}>
                  <th scope="row" data-label="Placeholder" className="pb-code">
                    {name}
                    <div>
                      <Badge tone="neutral">{named ? 'Online course' : online ? 'Online course, not chosen yet' : 'Course not chosen yet'}</Badge>
                    </div>
                  </th>
                  <td className="num pb-cr" data-label="Credits">
                    {formatCredits(p.desired_credits)}
                  </td>
                  <td data-label="Counts toward" className="pb-for">
                    {requirementName(p.requirement_id)}
                  </td>
                  <td data-label="Problems" className="pb-prob">
                    {itemIssues(p.id).map((i) => (
                      <div key={i.key}>
                        <SeverityBadge severity={i.severity} /> {i.message}
                      </div>
                    ))}
                  </td>
                  <td data-label="Actions" className="pb-act">
                    {named ? null : (
                      <button type="button" className="btn btn-small" aria-label={`Choose a course for ${name}`} onClick={() => onResolve(p.id)}>
                        Choose a course
                      </button>
                    )}
                    <button type="button" className="btn btn-small btn-danger" aria-label={`Remove placeholder ${name}`} onClick={() => onRemovePlaceholder(p.id, name)}>
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="pb-add">
        <button type="button" className="btn" aria-label={`Add course to ${label}`} onClick={onAddCourse}>
          Add course
        </button>
        <button type="button" className="btn" aria-label={`Add placeholder to ${label}`} onClick={onAddPlaceholder}>
          Add placeholder
        </button>
        <button type="button" className="btn" aria-label={`Add online course to ${label}`} onClick={onAddOnline}>
          Add online course
        </button>
      </div>
    </section>
  );
}

function PlaceholderDialog({
  term,
  options,
  onClose,
  onAdd,
}: {
  term: string;
  options: (RequirementDefinition & { depth: number })[];
  onClose: () => void;
  onAdd: (p: { id: string; requirement_id: string; desired_credits: string; label?: string }) => void;
}) {
  const id = useId();
  const [chosen, setChosen] = useState('');
  const requirement = chosen || (options[0]?.id ?? ''); // the list may arrive after the dialog opens
  const setRequirement = setChosen;
  const [credits, setCredits] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!requirement) return setError('Choose the requirement this placeholder is meant to fill.');
    if (!isDecimalString(credits.trim())) return setError('Enter target credits as a number, for example 4 (no leading zeros, at most 4 decimal places).');
    if (Number(credits.trim()) <= 0) return setError('Target credits must be more than 0.');
    setError(null);
    onAdd({ id: newId('placeholder'), requirement_id: requirement, desired_credits: credits.trim(), ...(label.trim() ? { label: label.trim() } : {}) });
  };
  return (
    <Dialog open title={`Add placeholder to ${formatTerm(term)}`} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <p className="muted">A placeholder holds credits for a requirement until you choose a course.</p>
        <div className="field">
          <label htmlFor={`${id}-req`}>Requirement</label>
          <select id={`${id}-req`} value={requirement} onChange={(e) => setRequirement(e.target.value)}>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {'— '.repeat(o.depth)}
                {requirementLabel(o, undefined)}
              </option>
            ))}
          </select>
        </div>
        <div className="inline-fields">
          <div className="field">
            <label htmlFor={`${id}-cr`}>Target credits</label>
            <input id={`${id}-cr`} type="text" inputMode="decimal" value={credits} onChange={(e) => setCredits(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={`${id}-label`}>Label</label>
            <input id={`${id}-label`} type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. HSS elective" />
          </div>
        </div>
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="panel-row">
          <button type="submit" className="btn btn-primary">
            Add placeholder
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}
