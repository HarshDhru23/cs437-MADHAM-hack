import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { endpoints } from '../../api/endpoints';
import { useCatalogue, useCurriculum, usePlans, useRecord } from '../../api/hooks';
import { useResource, useResourceCache } from '../../api/resources';
import type { AcademicPlan, Issue, PlannedSemester, PlanPayload, PlanValidation, RequirementDefinition } from '../../api/types';
import { useSaveQueue } from '../../api/useSaveQueue';
import { PLAN_TABS, SubNav } from '../../app/AppShell';
import { useSession } from '../../app/session';
import { usePublishView } from '../../app/viewContext';
import { ConflictPanel } from '../../components/ConflictPanel';
import { CoursePicker, type PickedCourse } from '../../components/CoursePicker';
import { Dialog } from '../../components/Dialog';
import { IssueList } from '../../components/IssueList';
import { SaveStatusIndicator } from '../../components/SaveStatusIndicator';
import { ErrorPanel, StatePanel } from '../../components/StatePanel';
import { Badge, EvidenceBadge, SeverityBadge } from '../../components/StatusBadge';
import { compareTerms, formatCredits, formatTerm } from '../../lib/format';
import { newId } from '../../lib/ids';
import { latestCompletedTerm, nextRegularTerm, regularTermsThrough } from '../../lib/terms';
import { isDecimalString } from '../../lib/validation';
import { requirementLabel } from '../requirements/RequirementTree';

const DEFAULT_LAST_SEMESTER = 8;

function planPayload(p: AcademicPlan | PlanPayload): PlanPayload {
  return { ...(p.label !== undefined ? { label: p.label } : {}), semesters: p.semesters };
}

/** /plan — list plans or create the first one. */
export function PlanIndexPage() {
  const session = useSession();
  const plans = usePlans();
  const record = useRecord();
  const cache = useResourceCache();
  const navigate = useNavigate();
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);
  usePublishView({ dataMode: 'projected', recordRevision: record.data?.revision ?? null });

  const create = async () => {
    if (!record.data) return;
    const latest = latestCompletedTerm(record.data.attempts);
    const start = (latest && nextRegularTerm(latest)) ?? `${record.data.profile.admission_year}-${String((record.data.profile.admission_year + 1) % 100).padStart(2, '0')}-I`;
    const terms = regularTermsThrough(start, record.data.profile.admission_year, DEFAULT_LAST_SEMESTER);
    const payload: PlanPayload = { label: 'My plan', semesters: (terms.length ? terms : [start]).map((term_id) => ({ term_id, courses: [], placeholders: [] })) };
    setPending(true);
    setError(null);
    try {
      const result = await endpoints.createPlan(session.api, payload);
      cache.invalidate('plans:');
      navigate(`/plan/${encodeURIComponent(result.data.id)}`);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError('server', 0, String(e), []));
    } finally {
      setPending(false);
    }
  };

  return (
    <div>
      <SubNav label="Plan" items={PLAN_TABS} />
      <h1>Plans</h1>
      {plans.loading || record.loading ? <StatePanel kind="loading" title="Loading your plans…" /> : null}
      {plans.error ? <ErrorPanel error={plans.error} onRetry={plans.reload} /> : null}
      {error ? <ErrorPanel error={error} /> : null}
      {plans.data && plans.data.length > 0 ? (
        <ul className="issue-list">
          {plans.data.map((p) => (
            <li key={p.id}>
              <Link to={`/plan/${encodeURIComponent(p.id)}`}>{p.label ?? 'Untitled plan'}</Link> <span className="muted num">· revision {p.revision} · {p.semesters.length} terms</span>
            </li>
          ))}
        </ul>
      ) : plans.data ? (
        <p>You have no saved plans yet. A new plan lists every remaining semester through semester 8; you can extend it.</p>
      ) : null}
      {plans.data ? (
        <button type="button" className="btn btn-primary" onClick={create} disabled={pending || !record.data}>
          {pending ? 'Creating…' : plans.data.length > 0 ? 'Create another plan' : 'Create a plan'}
        </button>
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
  return <Planner key={loaded.data.id} initial={loaded.data} recordRevision={record.data?.revision ?? null} latestCompleted={latestCompletedTerm(record.data?.attempts ?? [])} />;
}

type Dialogs = { kind: 'course'; term: string } | { kind: 'placeholder'; term: string } | { kind: 'resolve'; term: string; placeholderId: string } | null;

function Planner({ initial, recordRevision, latestCompleted }: { initial: AcademicPlan; recordRevision: number | null; latestCompleted: string | null }) {
  const session = useSession();
  const cache = useResourceCache();
  const catalogue = useCatalogue();
  const curriculum = useCurriculum();
  const [validation, setValidation] = useState<{ revision: number; data: PlanValidation } | null>(null);
  const [validationError, setValidationError] = useState<ApiError | null>(null);
  const [undo, setUndo] = useState<PlanPayload[]>([]);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [highlight, setHighlight] = useState<Set<string>>(new Set());
  const [announce, setAnnounce] = useState('');

  const queue = useSaveQueue<PlanPayload>(`plan:${initial.id}`, { value: planPayload(initial), revision: initial.revision }, async (draft, revision, signal) => {
    const result = await endpoints.patchPlan(session.api, initial.id, { ...draft, expected_revision: revision }, { signal });
    setValidation({ revision: result.data.revision, data: result.data.validation });
    cache.invalidate('analysis:');
    cache.invalidate('plans:');
    return { revision: result.data.revision, value: planPayload(result.data) };
  }, session.user?.id ?? null);
  const plan = queue.value ?? planPayload(initial);
  const revision = queue.state?.revision ?? initial.revision;

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
  const currentTerm = latestCompleted ? nextRegularTerm(latestCompleted) : null;
  const stale = validation !== null && (validation.revision !== revision || queue.state?.draft != null);
  const issues = validation?.data.issues ?? [];
  const requirementOptions = useMemo(() => flattenRequirements(curriculum.data?.requirements ?? []), [curriculum.data]);

  const move = (fromTerm: string, itemId: string, toTerm: string) => {
    const item = plan.semesters.find((s) => s.term_id === fromTerm)?.courses.find((c) => c.id === itemId);
    if (!item || fromTerm === toTerm) return;
    const next = { ...plan, semesters: plan.semesters.map((s) => (s.term_id === fromTerm ? { ...s, courses: s.courses.filter((c) => c.id !== itemId) } : s.term_id === toTerm ? { ...s, courses: [...s.courses, item] } : s)) };
    edit(next, `Moved ${item.normalized_code} to ${formatTerm(toTerm)}. Check validation for downstream effects.`);
  };

  const extend = () => {
    const last = terms.at(-1)?.term_id;
    const next = last ? nextRegularTerm(last) : null;
    if (!next) return;
    edit({ ...plan, semesters: [...plan.semesters, { term_id: next, courses: [], placeholders: [] }] }, `Added ${formatTerm(next)}.`);
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

  return (
    <div>
      <SubNav label="Plan" items={PLAN_TABS} />
      <div className="panel-row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>{plan.label ?? 'Plan'}</h1>
        <div className="panel-row">
          <SaveStatusIndicator label="Plan save status" status={status} revision={revision} savedAt={queue.state?.savedAt} />
          <button type="button" className="btn" onClick={undoLast} disabled={undo.length === 0 || status === 'conflict'}>
            Undo last change
          </button>
          <Link className="btn" to={`/report/${encodeURIComponent(initial.id)}`}>
            Printable report
          </Link>
        </div>
      </div>
      <p className="muted">
        A projected plan is not completed history. Course choices are yours; CoursePath never reschedules courses automatically. Credits come from the server
        after each save.
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
      {catalogue.issues.length > 0 ? <IssueList issues={catalogue.issues} grouped={false} /> : null}

      <div className="grid-2">
        <div>
          {terms.map((s) => (
            <SemesterTable
              key={s.term_id}
              semester={s}
              allTerms={terms.map((t) => t.term_id)}
              isCurrent={s.term_id === currentTerm}
              isFuture={currentTerm !== null && compareTerms(s.term_id, currentTerm) > 0}
              validation={stale ? null : (validation?.data ?? null)}
              issues={stale ? [] : issues}
              highlight={highlight}
              requirementName={(id) => requirementLabel(requirementOptions.find((r) => r.id === id), undefined)}
              onMove={(itemId, to) => move(s.term_id, itemId, to)}
              onRemoveCourse={(itemId, code) => edit(updateSemester(s.term_id, (x) => ({ ...x, courses: x.courses.filter((c) => c.id !== itemId) })), `Removed ${code}.`)}
              onRemovePlaceholder={(id, label) => edit(updateSemester(s.term_id, (x) => ({ ...x, placeholders: x.placeholders.filter((p) => p.id !== id) })), `Removed placeholder ${label}.`)}
              onAddCourse={() => setDialog({ kind: 'course', term: s.term_id })}
              onAddPlaceholder={() => setDialog({ kind: 'placeholder', term: s.term_id })}
              onResolve={(placeholderId) => setDialog({ kind: 'resolve', term: s.term_id, placeholderId })}
            />
          ))}
          <button type="button" className="btn" onClick={extend}>
            Extend plan by one term
          </button>
        </div>
        <section className="panel" aria-label="Plan validation">
          <h2>Validation</h2>
          {stale ? (
            <p className="muted" role="status">
              Your latest changes are not validated yet; the results below are for saved revision {validation?.revision}. Planned rows show “Not checked” until the
              server validates the new revision.
            </p>
          ) : null}
          {validationError ? <ErrorPanel error={validationError} /> : null}
          {!validation && !validationError ? <StatePanel kind="loading" title="Validating on the server…" /> : null}
          {validation ? (
            <>
              <p>
                Timetable check: <EvidenceBadge value={validation.data.meeting_check_status} />. Completion term:{' '}
                {validation.data.completion_term ? formatTerm(validation.data.completion_term) : 'not established (evidence incomplete)'}.
              </p>
              <IssueList
                issues={issues}
                onSelect={(i) => {
                  setHighlight(new Set(i.entity_refs));
                  const first = i.entity_refs[0];
                  const target = first ? document.querySelector<HTMLElement>(`[data-item="${CSS.escape(first)}"]`) : null;
                  target?.scrollIntoView?.({ block: 'center' });
                }}
                emptyMessage="The server reported no plan issues."
              />
            </>
          ) : null}
          <p className="muted">Load guidance and limits come from the server. CoursePath cannot approve an overload or change official rules.</p>
        </section>
      </div>

      <Dialog open={dialog?.kind === 'course'} title={`Add course to ${dialog ? formatTerm(dialog.term) : ''}`} onClose={() => setDialog(null)} variant="drawer">
        {dialog?.kind === 'course' ? <CoursePicker courses={catalogue.data?.courses ?? []} coverage={catalogue.data?.coverage ?? 'unknown'} onPick={(c) => pick(dialog.term, c)} /> : null}
      </Dialog>
      {dialog?.kind === 'resolve'
        ? (() => {
            const ph = plan.semesters.find((s) => s.term_id === dialog.term)?.placeholders.find((p) => p.id === dialog.placeholderId);
            const label = ph?.label ?? 'placeholder';
            return (
              <Dialog open title={`Choose a course for ${label}`} onClose={() => setDialog(null)} variant="drawer">
                <p className="muted">The chosen course replaces the placeholder. The server decides whether it counts toward {ph ? requirementLabel(requirementOptions.find((r) => r.id === ph.requirement_id), undefined) : 'the requirement'}.</p>
                <CoursePicker
                  courses={catalogue.data?.courses ?? []}
                  coverage={catalogue.data?.coverage ?? 'unknown'}
                  submitLabel="Use this course"
                  onPick={(c) => pick(dialog.term, c, { replacePlaceholder: dialog.placeholderId, intended: ph?.requirement_id })}
                />
              </Dialog>
            );
          })()
        : null}
      {dialog?.kind === 'placeholder' ? (
        <PlaceholderDialog
          term={dialog.term}
          options={requirementOptions}
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
  isFuture,
  validation,
  issues,
  highlight,
  requirementName,
  onMove,
  onRemoveCourse,
  onRemovePlaceholder,
  onAddCourse,
  onAddPlaceholder,
  onResolve,
}: {
  semester: PlannedSemester;
  allTerms: string[];
  isCurrent: boolean;
  isFuture: boolean;
  /** Null while loading or while the plan has unvalidated edits: every check then reads "Not checked". */
  validation: PlanValidation | null;
  issues: Issue[];
  highlight: Set<string>;
  requirementName: (id: string) => string;
  onMove: (itemId: string, to: string) => void;
  onRemoveCourse: (itemId: string, code: string) => void;
  onRemovePlaceholder: (id: string, label: string) => void;
  onAddCourse: () => void;
  onAddPlaceholder: () => void;
  onResolve: (placeholderId: string) => void;
}) {
  const headingId = useId();
  const label = formatTerm(semester.term_id);
  const workload = validation?.workload[semester.term_id];
  const termIssues = issues.filter((i) => i.entity_refs.includes(semester.term_id));
  const perCourse = new Map((validation?.per_course ?? []).map((p) => [p.id, p]));
  const itemIssues = (id: string) => issues.filter((i) => i.entity_refs.includes(id));
  return (
    <section className="panel semester" aria-labelledby={headingId} data-current={isCurrent ? 'true' : undefined}>
      <div className="semester-head">
        <h2 id={headingId}>{label}</h2>
        <div className="panel-row">
          {isCurrent ? <Badge tone="neutral" symbol="●">Current term</Badge> : null}
          {isFuture ? <Badge tone="neutral">Future term — offerings and timetable not yet known</Badge> : null}
        </div>
      </div>
      <p className="num">
        {workload ? (
          <>
            Selected courses: {formatCredits(workload.selected_credits)} credits · Placeholder target: {formatCredits(workload.placeholder_credits)} credits
            {workload.target_credits ? ` · Target workload: ${formatCredits(workload.target_credits)} credits` : ''}
          </>
        ) : (
          <span className="muted">Credit totals update after the server saves and validates this plan.</span>
        )}
      </p>
      {termIssues.length > 0 ? (
        <ul className="issue-list">
          {termIssues.map((i, n) => (
            <li key={n} data-severity={i.severity}>
              <SeverityBadge severity={i.severity} /> {i.message}
            </li>
          ))}
        </ul>
      ) : null}
      {semester.courses.length === 0 && semester.placeholders.length === 0 ? (
        <p className="muted">No courses planned for this term.</p>
      ) : (
        <div className="table-wrap">
          <table className="data stack-mobile">
            <caption className="visually-hidden">Planned items for {label}</caption>
            <thead>
              <tr>
                <th scope="col">Course / placeholder</th>
                <th scope="col" className="num">Credits</th>
                <th scope="col">Requirement intent</th>
                <th scope="col">Prerequisites</th>
                <th scope="col">Offering / sections</th>
                <th scope="col">Issues</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {semester.courses.map((c) => {
                const pc = perCourse.get(c.id);
                const moveId = `${headingId}-move-${c.id}`;
                return (
                  <tr key={c.id} data-item={c.id} data-highlight={highlight.has(c.id) ? 'true' : undefined}>
                    <th scope="row" data-label="Course">
                      <span className="mono">{c.normalized_code}</span>
                      {!c.course_version_id ? <div className="muted">Not matched to a reviewed catalogue</div> : null}
                    </th>
                    <td className="num" data-label="Credits">
                      {formatCredits(c.credits)}
                    </td>
                    <td data-label="Requirement intent">{c.intended_allocation ? requirementName(c.intended_allocation) : <span className="muted">Not set</span>}</td>
                    <td data-label="Prerequisites">
                      <EvidenceBadge value={pc?.eligibility ?? 'not_checked'} />
                    </td>
                    <td data-label="Offering / sections">
                      <EvidenceBadge value={pc?.offering_status ?? 'not_checked'} /> <EvidenceBadge value={pc?.meeting_check_status ?? 'not_checked'} />
                      {c.section_ids?.length ? <div>Sections: {c.section_ids.join(', ')}</div> : null}
                    </td>
                    <td data-label="Issues">
                      {itemIssues(c.id).map((i, n) => (
                        <div key={n}>
                          <SeverityBadge severity={i.severity} /> {i.message}
                        </div>
                      ))}
                    </td>
                    <td data-label="Actions">
                      <div className="panel-row">
                        <label htmlFor={moveId} className="visually-hidden">
                          Move {c.normalized_code} to
                        </label>
                        <select id={moveId} defaultValue={semester.term_id} style={{ width: 'auto' }}>
                          {allTerms.map((t) => (
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
                      </div>
                    </td>
                  </tr>
                );
              })}
              {semester.placeholders.map((p) => {
                const name = p.label ?? requirementName(p.requirement_id);
                return (
                  <tr key={p.id} data-item={p.id} data-highlight={highlight.has(p.id) ? 'true' : undefined}>
                    <th scope="row" data-label="Placeholder">
                      {name}
                      <div>
                        <Badge tone="unknown" symbol="?">
                          Unresolved placeholder
                        </Badge>
                      </div>
                    </th>
                    <td className="num" data-label="Target credits">
                      {formatCredits(p.desired_credits)} (target)
                    </td>
                    <td data-label="Requirement intent">{requirementName(p.requirement_id)}</td>
                    <td data-label="Prerequisites">
                      <span className="muted">Cannot be checked until a course is chosen</span>
                    </td>
                    <td data-label="Offering / sections">
                      <span className="muted">Not a course; no offering or clash check</span>
                    </td>
                    <td data-label="Issues">
                      {itemIssues(p.id).map((i, n) => (
                        <div key={n}>
                          <SeverityBadge severity={i.severity} /> {i.message}
                        </div>
                      ))}
                    </td>
                    <td data-label="Actions">
                      <div className="panel-row">
                        <button type="button" className="btn btn-small" aria-label={`Choose a course for ${name}`} onClick={() => onResolve(p.id)}>
                          Choose a course
                        </button>
                        <button type="button" className="btn btn-small btn-danger" aria-label={`Remove placeholder ${name}`} onClick={() => onRemovePlaceholder(p.id, name)}>
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="panel-row">
        <button type="button" className="btn" aria-label={`Add course to ${label}`} onClick={onAddCourse}>
          Add course
        </button>
        <button type="button" className="btn" aria-label={`Add placeholder to ${label}`} onClick={onAddPlaceholder}>
          Add placeholder
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
  const [requirement, setRequirement] = useState(options[0]?.id ?? '');
  const [credits, setCredits] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!requirement) return setError('Choose the requirement this placeholder is meant to fill.');
    if (!isDecimalString(credits.trim())) return setError('Enter target credits as a number, for example 4 (no leading zeros, at most 4 decimal places).');
    setError(null);
    onAdd({ id: newId('placeholder'), requirement_id: requirement, desired_credits: credits.trim(), ...(label.trim() ? { label: label.trim() } : {}) });
  };
  return (
    <Dialog open title={`Add placeholder to ${formatTerm(term)}`} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <p className="muted">A placeholder reserves target workload for a requirement. It is never treated as an offered, eligible or completed course.</p>
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
