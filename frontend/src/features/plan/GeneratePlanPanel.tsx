import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { endpoints } from '../../api/endpoints';
import { useCatalogue, usePlans } from '../../api/hooks';
import { useResourceCache } from '../../api/resources';
import type { AcademicRecord, GeneratedPlacement, PlanCheck, PlanGeneration, PlannedSemester, PlanPayload, RequirementPlaceholder } from '../../api/types';
import { useSession } from '../../app/session';
import { CoursePicker, type PickedCourse } from '../../components/CoursePicker';
import { Dialog } from '../../components/Dialog';
import { ErrorPanel } from '../../components/StatePanel';
import { compareTerms, formatCredits, formatTerm } from '../../lib/format';
import { latestCompletedTerm, nextRegularTerm, regularTermsThrough } from '../../lib/terms';
import { isDecimalString } from '../../lib/validation';
import { meterLevel, meterWidth, sumCredits } from './loadLevel';
import { TermCoursePlans } from './CoursePlan';
import { isNamedOnline, isOnline, nextOnlineId, OnlineCourseForm, onlinePlaceholder, type OnlineCourseChoice } from './OnlineCourseForm';
import { plainIssues, type PlainIssue } from './plainIssues';
import { PlanLoadStrip, type LoadCell } from './PlanLoadStrip';
import { PlanStatusBadge, PlanStatusNote } from './PlanStatusNote';
import { moreCredits, PlanProgress } from './PlanProgress';
import { abortAfter, timeouts, usePlanCheck } from './usePlanCheck';
import './plan.css';

const LAST_SEMESTER = 8;
/** Shown when a semester has no server numbers yet; the server's own limit (options.max_credits_per_term) replaces it as soon as a draft exists. */
const DEFAULT_LIMIT = '28';
/** The "Lighter" load: the server aims for about this many credits a semester instead of packing to the limit. */
const LIGHTER_TARGET = '20';
const DEFAULT_PLAN_NAME = 'Generated plan';
const PLAN_NAME_LIMIT = 200;

/** The regular terms a generated plan can cover: the next term after the latest completed one, through semester 8. Labelling only. */
export function candidateTerms(record: AcademicRecord): string[] {
  const admission = record.profile.admission_year;
  const latest = latestCompletedTerm(record.attempts);
  const start = (latest && nextRegularTerm(latest)) ?? `${admission}-${String((admission + 1) % 100).padStart(2, '0')}-I`;
  return regularTermsThrough(start, admission, LAST_SEMESTER);
}

const nonEmpty = (semesters: PlannedSemester[]) =>
  semesters.filter((s) => s.courses.length > 0 || s.placeholders.length > 0).sort((a, b) => compareTerms(a.term_id, b.term_id));

/** What a placeholder is called to the student. */
function placeholderName(p: RequirementPlaceholder, requirement: string | undefined): string {
  if (p.label?.startsWith('Internship module')) return 'Internship module';
  if (isOnline(p)) return 'Online course';
  const first = p.label?.split(/[:;]/)[0]?.trim();
  return first || requirement || 'Course';
}

/** The second column of a placeholder row: the student's own name for an online course, or what to do with the credits. */
function placeholderHint(p: RequirementPlaceholder): string {
  if (p.label?.startsWith('Internship module')) return '4-credit module';
  if (isNamedOnline(p)) return p.label ?? '';
  if (isOnline(p)) return 'Choose an online course';
  if (p.label?.startsWith('Open project')) return 'Arrange it yourself';
  return 'Choose any course that counts';
}

/**
 * The content of a plan without its item ids: per semester the courses (code and credits) and the held credits (requirement, credits,
 * name), sorted. Two drafts with the same canonical form are the same plan, whichever way the student arrived at it.
 */
function canonical(semesters: PlannedSemester[]): string {
  return JSON.stringify(
    nonEmpty(semesters).map((s) => [
      s.term_id,
      s.courses.map((c) => `${c.normalized_code}|${c.credits}`).sort(),
      s.placeholders.map((p) => `${p.requirement_id}|${p.desired_credits}|${p.label ?? ''}|${p.online === true}`).sort(),
    ]),
  );
}

/** "6 credits", "1 credit". */
function creditsPhrase(value: string): string {
  const text = formatCredits(value);
  return text === '1' ? '1 credit' : `${text} credits`;
}

/** "10 online credits", "1 online credit". */
function onlineCreditsWord(value: string): string {
  const text = formatCredits(value);
  return text === '1' ? '1 online credit' : `${text} online credits`;
}

/** The default credits for a new elective placeholder: 4, or what the requirement still needs, or what the semester has room for. */
function defaultElectiveCredits(uncovered: string, available: string): string {
  const n = Math.min(4, Number(uncovered), Number(available));
  return Number.isFinite(n) && n > 0 ? String(n) : '';
}

interface Generation {
  internship: string;
  lighter: boolean;
  /** Use online credits in the breaks to lower each semester's load (D-42). */
  lighten: boolean;
}

/**
 * The primary way to start a plan. One click asks the server for a draft of the remaining semesters; the student can change the
 * internship semester and the load, add or remove any course or elective credits, and sees the server's check after every change:
 * the problems with the plan, how many more credits each semester can take (28 at most) and how many credits are left for
 * graduation. Nothing is saved until "Save as my plan". The server is authoritative for credits, checks and totals.
 */
export function GeneratePlanPanel({ record, autoStart = false, onAutoStarted }: { record: AcademicRecord; autoStart?: boolean; onAutoStarted?: () => void }) {
  const { api } = useSession();
  const plans = usePlans();
  const cache = useResourceCache();
  const navigate = useNavigate();
  const catalogue = useCatalogue();
  const internshipId = useId();
  const loadId = useId();
  const semesterId = useId();
  const basisId = useId();
  const coveredId = useId();
  const nameId = useId();
  const [generating, setGenerating] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [staleRecord, setStaleRecord] = useState(false);
  const [draft, setDraft] = useState<PlanGeneration | null>(null);
  // D-49: plan from the completed and current courses (the default), or from the completed courses alone. A ref so a request made in the same
  // event as the change already sees it.
  const [includeCurrent, setIncludeCurrent] = useState(true);
  const includeCurrentRef = useRef(true);
  const [draftNumber, setDraftNumber] = useState(0);
  const [semesters, setSemesters] = useState<PlannedSemester[]>([]);
  const [chosen, setChosen] = useState<Generation>({ internship: '', lighter: false, lighten: false });
  const [termChoices, setTermChoices] = useState<string[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const [electiveFor, setElectiveFor] = useState<string | null>(null);
  const [onlineFor, setOnlineFor] = useState<string | null>(null);
  const [planName, setPlanName] = useState<string | null>(null);
  const [resetCount, setResetCount] = useState(0);
  const [noGain, setNoGain] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<ApiError | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const current = useRef<{ number: number; cancel: () => void } | null>(null);
  const sequence = useRef(0);
  const savingRef = useRef(false);
  const lastRequest = useRef<Generation>({ internship: '', lighter: false, lighten: false });
  const draftChoiceRef = useRef<Generation>({ internship: '', lighter: false, lighten: false });

  const planned = useMemo(() => (draft ? nonEmpty(semesters) : null), [draft, semesters]);
  const { check, pending: checking, error: checkError, conflict, retry } = usePlanCheck(record.revision, planned, `${draftNumber}.${resetCount}`);

  useEffect(() => {
    if (draft) headingRef.current?.focus();
  }, [draftNumber]); // eslint-disable-line react-hooks/exhaustive-deps

  // Leaving the page cancels a request still in flight.
  useEffect(
    () => () => {
      current.current?.cancel();
      autoStarted.current = false; // React's strict mode unmounts and remounts once: a generation cancelled by that must start again, never be left 'building'
    },
    [],
  );

  const generate = async (next: Generation) => {
    current.current?.cancel();
    sequence.current += 1;
    const mine = sequence.current;
    const request = abortAfter(timeouts.request);
    current.current = { number: mine, cancel: request.cancel };
    lastRequest.current = next;
    setChosen(next);
    setError(null);
    setStaleRecord(false);
    setSlow(false);
    setGenerating(true);
    // Lightening with online credits spreads the work itself, so it does not send the credits-per-semester choice.
    const options = {
      ...(next.internship ? { internship_term: next.internship } : {}),
      ...(next.lighten ? { lighten_with_online: true } : next.lighter ? { target_credits_per_term: LIGHTER_TARGET } : {}),
      ...(includeCurrentRef.current ? {} : { include_current: false }),
    };
    try {
      const result = await endpoints.generatePlan(api, record.revision, Object.keys(options).length > 0 ? options : undefined, { signal: request.signal });
      request.done();
      if (sequence.current !== mine) return;
      const potential = result.data.online_potential;
      if (next.lighten && (!potential?.lightened || potential.busiest_before === null || Number(potential.busiest_semester_credits) >= Number(potential.busiest_before))) {
        // Online courses would not lower the busiest semester: keep the draft that is on screen, with the student's edits, and say so.
        setChosen(draftChoiceRef.current);
        setNoGain(true);
        setGenerating(false);
        return;
      }
      if (!next.internship) setTermChoices(result.data.options.terms ?? []);
      setSaveError(null);
      setAdding(null);
      setElectiveFor(null);
      setOnlineFor(null);
      setNoGain(false);
      setSemesters(structuredClone(result.data.semesters));
      setDraft(result.data);
      draftChoiceRef.current = next;
      setDraftNumber((n) => n + 1);
      setGenerating(false);
    } catch (e) {
      request.done();
      if (sequence.current !== mine) return; // a newer request owns the screen now
      if (e instanceof ApiError && e.kind === 'aborted' && !request.timedOut()) return;
      setGenerating(false);
      setChosen(draftChoiceRef.current); // the selects show the draft that is still on screen
      if (request.timedOut()) setSlow(true);
      else if (e instanceof ApiError && e.kind === 'conflict') setStaleRecord(true);
      else setError(e instanceof ApiError ? e : new ApiError('server', 0, 'The plan could not be generated.', []));
    }
  };

  const catalogueByCode = useMemo(() => new Map((catalogue.data?.courses ?? []).map((c) => [c.normalized_code, c])), [catalogue.data]);
  const placements = useMemo(() => new Map((draft?.placements ?? []).map((p) => [p.item_id, p] as [string, GeneratedPlacement])), [draft]);
  const requirementNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const u of draft?.unmet ?? []) names.set(u.requirement_id, u.label);
    for (const r of check?.requirements ?? []) names.set(r.id, r.label);
    return names;
  }, [draft, check]);
  const codeFor = (id: string) => semesters.flatMap((s) => s.courses).find((c) => c.id === id)?.normalized_code;
  const issues = useMemo(() => plainIssues(check?.validation.issues ?? [], codeFor), [check, semesters]); // eslint-disable-line react-hooks/exhaustive-deps
  const limit = draft?.options.max_credits_per_term ?? DEFAULT_LIMIT;
  const visibleTerms = useMemo(() => [...new Set(semesters.map((s) => s.term_id))].sort(compareTerms), [semesters]);
  const hiddenTerms = [...new Set([...termChoices, ...(draft?.online_potential?.break_terms ?? [])])].filter((t) => !visibleTerms.includes(t)).sort(compareTerms);
  const stale = staleRecord || conflict;

  const change = (term: string, fn: (s: PlannedSemester) => PlannedSemester) =>
    setSemesters((now) => {
      const base = now.some((s) => s.term_id === term) ? now : [...now, { term_id: term, courses: [], placeholders: [] }];
      return base.map((s) => (s.term_id === term ? fn(s) : s));
    });

  const addCourse = (term: string, picked: PickedCourse) => {
    const stem = `user-${term}-${picked.normalized_code.replace(/\s+/g, '')}`;
    change(term, (s) => {
      let id = stem;
      const taken = new Set(semesters.flatMap((x) => x.courses.map((c) => c.id)));
      for (let n = 2; taken.has(id); n += 1) id = `${stem}-${n}`;
      return { ...s, courses: [...s.courses, { id, normalized_code: picked.normalized_code, credits: picked.credits, ...(picked.course_version_id ? { course_version_id: picked.course_version_id } : {}) }] };
    });
    setAdding(null);
  };

  const addElective = (term: string, requirementId: string, credits: string) => {
    const taken = new Set(semesters.flatMap((x) => x.placeholders.map((p) => p.id)));
    let n = 1;
    while (taken.has(`user-${term}-${requirementId}-${n}`)) n += 1;
    change(term, (s) => ({ ...s, placeholders: [...s.placeholders, { id: `user-${term}-${requirementId}-${n}`, requirement_id: requirementId, desired_credits: credits, label: requirementNames.get(requirementId) ?? 'Elective' }] }));
    setElectiveFor(null);
  };

  const addOnline = (term: string, choice: OnlineCourseChoice) => {
    const id = nextOnlineId(term, semesters);
    change(term, (s) => ({ ...s, placeholders: [...s.placeholders, onlinePlaceholder(id, choice)] }));
    setOnlineFor(null);
  };

  // The plan's name: what the student typed, or "Generated plan" (then "Generated plan 2" and so on) when they leave it empty.
  const takenNames = new Set((plans.data ?? []).map((p) => (p.label ?? '').trim().toLowerCase()));
  let defaultName = DEFAULT_PLAN_NAME;
  for (let n = 2; takenNames.has(defaultName.toLowerCase()); n += 1) defaultName = `${DEFAULT_PLAN_NAME} ${n}`;
  const nameValue = planName ?? defaultName;
  const trimmedName = nameValue.trim();
  const nameTooLong = trimmedName.length > PLAN_NAME_LIMIT;
  const dirty = draft ? canonical(semesters) !== canonical(draft.semesters) : false;

  /** Back to exactly what the server generated for this draft: no new request, the same name, the check runs again. */
  const resetDraft = () => {
    if (!draft) return;
    setSemesters(structuredClone(draft.semesters));
    setResetCount((n) => n + 1);
    setSaveError(null);
    setAdding(null);
    setElectiveFor(null);
    setOnlineFor(null);
  };

  const save = async () => {
    if (!draft || savingRef.current || nameTooLong) return;
    savingRef.current = true;
    const payload: PlanPayload = { label: trimmedName || defaultName, semesters: nonEmpty(semesters) };
    setSaving(true);
    setSaveError(null);
    try {
      const created = await endpoints.createPlan(api, payload);
      cache.invalidate('plans:');
      navigate(`/plan/${encodeURIComponent(created.data.id)}`);
    } catch (e) {
      setSaveError(e instanceof ApiError ? e : new ApiError('server', 0, 'The plan could not be saved. Your draft is still here.', []));
      savingRef.current = false;
      setSaving(false);
    }
  };

  const discard = () => {
    current.current?.cancel();
    sequence.current += 1;
    setGenerating(false);
    setSlow(false);
    setDraft(null);
    setSemesters([]);
    setSaveError(null);
    setAdding(null);
    setElectiveFor(null);
    setOnlineFor(null);
    setPlanName(null);
    setNoGain(false);
    setResetCount(0);
    draftChoiceRef.current = { internship: '', lighter: false, lighten: false };
    setChosen({ internship: '', lighter: false, lighten: false });
    openerRef.current?.focus();
  };

  const reloadRecord = () => {
    cache.invalidate('record:');
    setStaleRecord(false);
    discard();
  };

  const termIssues = (term: string): PlainIssue[] => {
    const s = semesters.find((x) => x.term_id === term);
    const refs = new Set([term, ...(s?.courses ?? []).flatMap((c) => [c.id, c.normalized_code]), ...(s?.placeholders ?? []).map((p) => p.id)]);
    return issues.filter((i) => i.entityRefs.some((r) => refs.has(r)));
  };
  const shownInTerms = new Set(visibleTerms.flatMap((t) => termIssues(t).map((i) => i.key)));
  const general = issues.filter((i) => !shownInTerms.has(i.key));
  const unplaced = draft && !draft.summary.complete ? draft.unmet.filter((u) => u.reason_code === 'NO_CAPACITY' || u.reason_code === 'NO_OFFERED_COURSE') : [];
  const early = draft?.graduation.early === true;
  const noRecord = record.attempts.length === 0 && (record.current_enrolment?.length ?? 0) === 0;
  const hasCurrent = (record.current_enrolment ?? []).some((r) => r.confirmed);
  const chooseBasis = (value: string) => {
    const next = value !== 'completed';
    includeCurrentRef.current = next;
    setIncludeCurrent(next);
    if (draft) void generate(chosen);   // a draft on screen is rebuilt from the other starting point
  };
  const busy = generating || saving;

  // The command bar opens /plan?generate=1: start one generation as if "Generate plan" was clicked, then let the page drop the parameter
  // so reloading does not generate again. Nothing starts without a record or while a request or a draft is already there.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoStart || autoStarted.current) return;
    autoStarted.current = true;
    onAutoStarted?.();
    if (!noRecord && !generating && !draft) void generate({ internship: '', lighter: false, lighten: false });
  }, [autoStart]); // eslint-disable-line react-hooks/exhaustive-deps

  // One cell per semester for the load strip, and the plan's credits in total: the server's per-semester numbers, never recomputed here.
  const termLimitOf = (term: string) => check?.load[term]?.limit_credits ?? (term.endsWith('SUMMER') ? '10' : limit);
  const termPlannedOf = (term: string) => {
    const s = semesters.find((x) => x.term_id === term);
    const empty = !s || (s.courses.length === 0 && s.placeholders.length === 0);
    return empty ? '0' : (check?.load[term]?.planned_credits ?? check?.validation.workload[term]?.target_credits ?? draft?.summary.credits_by_term[term] ?? '0');
  };
  const cells: LoadCell[] = visibleTerms.map((t) => ({ term: t, planned: termPlannedOf(t), limit: termLimitOf(t) }));
  const planTotal = sumCredits(cells.map((c) => c.planned));

  return (
    <div>
      <div className="panel-row">
        <button ref={openerRef} type="button" className="btn btn-primary" onClick={() => void generate({ internship: '', lighter: false, lighten: false })} disabled={noRecord || saving} aria-busy={generating}>
          Generate plan
        </button>
        {hasCurrent ? (
          <div className="field">
            <label htmlFor={basisId}>Plan from</label>
            <select id={basisId} value={includeCurrent ? 'current' : 'completed'} disabled={generating || saving} onChange={(e) => chooseBasis(e.target.value)}>
              <option value="current">Completed + current courses</option>
              <option value="completed">Completed courses only</option>
            </select>
          </div>
        ) : null}
        <span className="muted">
          {hasCurrent && !includeCurrent
            ? 'Builds a plan that starts with your running semester, leaving your current courses out. You can change it before saving.'
            : 'Builds a plan for your remaining semesters. You can change it before saving.'}
        </span>
      </div>
      {noRecord ? (
        <p className="muted">
          Add your record first, so the plan starts from what you have completed. <Link to="/record/import">Add my record</Link>
        </p>
      ) : null}
      {generating ? (
        <p role="status" className="muted">
          Building your plan…
        </p>
      ) : null}
      {slow ? (
        <div className="callout" data-tone="warning" role="alert">
          <p>This is taking too long.</p>
          <button type="button" className="btn" onClick={() => void generate(lastRequest.current)}>
            Try again
          </button>
        </div>
      ) : null}
      {stale ? (
        <div className="callout" data-tone="danger" role="alert">
          <p>
            <strong>Your record was saved elsewhere</strong> since this page loaded, so a plan built from it could be wrong. Reload your record and generate again.
          </p>
          <button type="button" className="btn" onClick={reloadRecord}>
            Reload my record
          </button>
        </div>
      ) : error ? (
        <ErrorPanel error={error} />
      ) : null}

      {draft ? (
        <section className="panel pb-draft" aria-label="Draft plan (not saved)" aria-busy={generating}>
          <h2 ref={headingRef} tabIndex={-1}>
            Draft plan
          </h2>
          {draft.graduation.message && !generating ? (
            <p className="callout pb-status" data-tone={early ? 'success' : undefined} role="status">
              <strong>{draft.graduation.message}</strong>
            </p>
          ) : null}
          {unplaced.length > 0 ? <p className="callout pb-status" data-tone="warning">{`Some requirements could not be placed: ${unplaced.map((u) => u.label).join(', ')}. Add courses for them below.`}</p> : null}
          {draft.online_potential ? (
            <div className="callout pb-online" data-testid="online-potential" aria-label="Online courses">
              {draft.online_potential.lightened ? (
                <>
                  <p>
                    {draft.online_potential.busiest_before !== null
                      ? `Taking ${onlineCreditsWord(draft.graduation.online_credits)} in the breaks lowers your busiest semester from ${formatCredits(draft.online_potential.busiest_before)} to ${formatCredits(draft.online_potential.busiest_semester_credits)} credits.`
                      : `Online credits in the breaks are used to lower the load of each semester.`}
                  </p>
                  <button type="button" className="btn btn-small" disabled={generating} onClick={() => void generate({ ...chosen, lighten: false })}>
                    Back to courses only
                  </button>
                </>
              ) : noGain ? (
                <p role="status">Online courses would not lower your busiest semester here.</p>
              ) : Number(draft.online_potential.credits_available) > 0 && (draft.online_potential.break_terms.length > 0 || !!draft.options.internship_term) ? (
                <>
                  <p>{`Online courses could lighten your semesters: up to ${creditsPhrase(draft.online_potential.credits_available)} can be taken in the breaks.`}</p>
                  <button type="button" className="btn btn-small" disabled={generating} onClick={() => void generate({ ...chosen, lighten: true })}>
                    Show me how much
                  </button>
                </>
              ) : null}
            </div>
          ) : null}

          <div className="pb-toolbar" role="group" aria-label="Draft settings">
            {termChoices.length > 0 ? (
              <>
                <div className="field">
                  <label htmlFor={internshipId}>Internship semester</label>
                  <select id={internshipId} value={chosen.internship} onChange={(e) => void generate({ ...chosen, internship: e.target.value })}>
                    <option value="">No internship</option>
                    {termChoices.map((t) => (
                      <option key={t} value={t}>
                        {formatTerm(t)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor={loadId}>Credits per semester</label>
                  <select id={loadId} value={chosen.lighter ? 'lighter' : 'most'} disabled={chosen.lighten} aria-describedby={chosen.lighten ? `${loadId}-why` : undefined} onChange={(e) => void generate({ ...chosen, lighter: e.target.value === 'lighter' })}>
                    <option value="most">As many as possible (up to {limit})</option>
                    <option value="lighter">Lighter (about {LIGHTER_TARGET})</option>
                  </select>
                  {chosen.lighten ? (
                    <p id={`${loadId}-why`} className="muted">
                      Online courses already spread the work evenly, so this choice is off.
                    </p>
                  ) : null}
                </div>
              </>
            ) : null}
            <div className="field">
              <label htmlFor={nameId}>Plan name</label>
              <input id={nameId} type="text" value={nameValue} placeholder={defaultName} onChange={(e) => setPlanName(e.target.value)} aria-invalid={nameTooLong ? true : undefined} aria-describedby={nameTooLong ? `${nameId}-error` : undefined} />
              {nameTooLong ? (
                <p id={`${nameId}-error`} className="field-error" role="alert">
                  {`Use at most ${PLAN_NAME_LIMIT} characters for the plan name.`}
                </p>
              ) : null}
            </div>
            <div className="pb-actions">
              <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy || checking || stale || !!checkError || nameTooLong || (planned?.length ?? 0) === 0 || !check} aria-busy={saving}>
                {saving ? 'Saving…' : 'Save as my plan'}
              </button>
              {check && !checking ? <PlanStatusBadge status={check.status} /> : null}
              <button type="button" className="btn" onClick={resetDraft} disabled={!dirty || saving}>
                Reset to generated plan
              </button>
              <button type="button" className="btn" onClick={discard} disabled={saving}>
                Discard
              </button>
            </div>
          </div>
          {saveError ? <ErrorPanel error={saveError} /> : null}
          <p className="pb-note">Changing either choice builds a new draft.</p>

          <PlanLoadStrip cells={cells} />
          <PlanProgress check={check} pending={checking} plannedTotal={check ? planTotal : undefined} />
          {check && Number(check.uncovered_credits) <= 0 ? (
            <p id={coveredId} className="muted">
              This plan already meets every requirement, so there are no elective credits to add. Remove an elective to add a different amount.
            </p>
          ) : null}
          {checkError ? (
            <div className="callout" data-tone="warning" role="alert">
              <p>{checkError.message}</p>
              <button type="button" className="btn" onClick={retry}>
                Try again
              </button>
            </div>
          ) : null}

          <div className="pb-board">
            {visibleTerms.map((term) => {
              const semester = semesters.find((s) => s.term_id === term);
              const empty = !semester || (semester.courses.length === 0 && semester.placeholders.length === 0);
              const load = check?.load[term];
              // An empty semester holds nothing and has all its room, whatever an older answer said; the server's numbers rule for the rest.
              const total = termPlannedOf(term);
              const termLimit = termLimitOf(term); // a summer break holds at most 10 credits
              const room = empty ? termLimit : load?.available_credits;
              const mine = termIssues(term);
              const over = mine.some((i) => /-credit limit/.test(i.message));
              const hasInternship = semester?.placeholders.some((p) => p.label?.startsWith('Internship module')) ?? false;
              const needing = (check?.requirements ?? []).filter((r) => Number(r.uncovered_credits) > 0);
              return (
                <section key={term} aria-label={`Draft ${formatTerm(term)}`} className="pb-col" data-updating={checking ? 'true' : undefined}>
                  <div className="pb-colhead">
                    <div className="pb-colhead-row">
                      <h3>{formatTerm(term)}</h3>
                      <span className="pb-used" aria-hidden="true">{`${formatCredits(total)} / ${formatCredits(termLimit)}`}</span>
                    </div>
                    <div className="pb-meter" aria-hidden="true" data-level={meterLevel(total, termLimit)}>
                      <i style={{ width: `${meterWidth(total, termLimit)}%` }} />
                    </div>
                  </div>
                  {empty ? (
                    <p className="pb-empty">Nothing planned in this semester.</p>
                  ) : (
                    <TermCoursePlans term={term}>
                      {(coursePlan) => (
                        <table className="pb-chips">
                          <caption>{`${formatTerm(term)} draft`}</caption>
                          <thead>
                            <tr>
                              <th scope="col">Course</th>
                              <th scope="col">Title</th>
                              <th scope="col" className="num">
                                Credits
                              </th>
                              <th scope="col">Counts toward</th>
                              <th scope="col">
                                <span className="visually-hidden">Actions</span>
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {semester!.courses.map((c) => {
                              const placement = placements.get(c.id);
                              return (
                                <tr key={c.id}>
                                  <th scope="row" data-label="Course" className="pb-code">
                                    <span className="mono">{c.normalized_code}</span>
                                    <div className="pb-courseplan">{coursePlan(c)}</div>
                                  </th>
                                  <td data-label="Title" className="pb-title">
                                    {placement?.title ?? catalogueByCode.get(c.normalized_code)?.title ?? ''}
                                  </td>
                                  <td className="num pb-cr" data-label="Credits">
                                    {formatCredits(c.credits)}
                                  </td>
                                  <td data-label="Counts toward" className="pb-for">
                                    {placement?.requirement_label ?? ''}
                                  </td>
                                  <td data-label="Actions" className="pb-act">
                                    <button
                                      type="button"
                                      className="btn btn-small btn-danger"
                                      aria-label={`Remove ${c.normalized_code} from ${formatTerm(term)}`}
                                      onClick={() => change(term, (s) => ({ ...s, courses: s.courses.filter((x) => x.id !== c.id) }))}
                                    >
                                      Remove
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                            {semester!.placeholders.map((p) => {
                              const name = placeholderName(p, requirementNames.get(p.requirement_id));
                              const removeName = isNamedOnline(p) ? (p.label ?? name) : name;
                              return (
                                <tr key={p.id} className="pb-ph" data-online={isOnline(p) ? 'true' : undefined}>
                                  <th scope="row" data-label="Course" className="pb-code">
                                    {name}
                                  </th>
                                  <td data-label="Title" className="pb-title">
                                    {placeholderHint(p)}
                                  </td>
                                  <td className="num pb-cr" data-label="Credits">
                                    {formatCredits(p.desired_credits)}
                                  </td>
                                  <td data-label="Counts toward" className="pb-for">
                                    {placements.get(p.id)?.requirement_label ?? requirementNames.get(p.requirement_id) ?? ''}
                                  </td>
                                  <td data-label="Actions" className="pb-act">
                                    <button
                                      type="button"
                                      className="btn btn-small btn-danger"
                                      aria-label={`Remove ${removeName} from ${formatTerm(term)}`}
                                      onClick={() => change(term, (s) => ({ ...s, placeholders: s.placeholders.filter((x) => x.id !== p.id) }))}
                                    >
                                      Remove
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </TermCoursePlans>
                  )}
                  {hasInternship ? <p className="pb-hint">Internship credits come in 4-credit modules, 16 at most. No timetabled courses are planned in this semester.</p> : null}
                  <p className="pb-load">
                    <span>{`${term.endsWith('SUMMER') ? 'Summer' : 'Semester'} total: ${formatCredits(total)} / ${formatCredits(termLimit)} credits`}</span>
                    {room !== undefined ? <span>{Number(room) > 0 ? ` — ${moreCredits(room)} can be added` : ' — no more credits can be added'}</span> : null}
                    {over ? <strong className="field-error">{` Over the ${formatCredits(termLimit)}-credit limit`}</strong> : null}
                  </p>
                  {mine.length > 0 ? (
                    <ul className="pb-problems" aria-label={`Problems in ${formatTerm(term)}`} aria-live="polite">
                      {mine.map((i) => (
                        <li key={i.key} data-severity={i.severity}>
                          {i.message}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="pb-add">
                    <button type="button" className="btn btn-small" aria-label={`Add course to ${formatTerm(term)}`} onClick={() => setAdding(term)}>
                      Add course
                    </button>
                    {term.endsWith('SUMMER') ? null : (
                      <button
                        type="button"
                        className="btn btn-small"
                        aria-label={`Add elective credits to ${formatTerm(term)}`}
                        aria-expanded={electiveFor === term}
                        onClick={() => {
                          setOnlineFor(null);
                          setElectiveFor(electiveFor === term ? null : term);
                        }}
                        disabled={needing.length === 0}
                        aria-describedby={needing.length === 0 ? coveredId : undefined}
                      >
                        Add elective credits
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-small"
                      aria-label={`Add online course to ${formatTerm(term)}`}
                      aria-expanded={onlineFor === term}
                      onClick={() => {
                        setElectiveFor(null);
                        setOnlineFor(onlineFor === term ? null : term);
                      }}
                    >
                      Add online course
                    </button>
                  </div>
                  {onlineFor === term ? <OnlineCourseForm key={term} term={term} requirements={check?.requirements} room={room} onAdd={(choice) => addOnline(term, choice)} onCancel={() => setOnlineFor(null)} /> : null}
                  {electiveFor === term ? <ElectiveForm key={term} term={term} options={needing} available={room ?? limit} onAdd={(id, credits) => addElective(term, id, credits)} onCancel={() => setElectiveFor(null)} /> : null}
                </section>
              );
            })}
          </div>

          {hiddenTerms.length > 0 ? (
            <div className="field" style={{ maxWidth: '22rem' }}>
              <label htmlFor={semesterId}>Add a semester</label>
              <select id={semesterId} value="" onChange={(e) => e.target.value && change(e.target.value, (s) => s)}>
                <option value="">Choose a semester</option>
                {hiddenTerms.map((t) => (
                  <option key={t} value={t}>
                    {formatTerm(t)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {general.length > 0 ? (
            <section aria-label="Problems with your plan">
              <h3>Check these</h3>
              <ul className="pb-problems" aria-live="polite">
                {general.map((i) => (
                  <li key={i.key} data-severity={i.severity}>
                    {i.message}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {!stale && !checkError ? <PlanStatusNote status={check?.status} pending={checking} /> : null}

          <Dialog open={adding !== null} title={`Add course to ${adding ? formatTerm(adding) : ''}`} onClose={() => setAdding(null)} variant="drawer">
            {adding ? <CoursePicker term={adding} courses={catalogue.data?.courses ?? []} coverage={catalogue.data?.coverage ?? 'unknown'} onPick={(c) => addCourse(adding, c)} /> : null}
          </Dialog>
        </section>
      ) : null}
    </div>
  );
}

/** Adds credits for a requirement that still needs them; the student fills them with any course that counts. */
function ElectiveForm({
  term,
  options,
  available,
  onAdd,
  onCancel,
}: {
  term: string;
  options: PlanCheck['requirements'];
  available: string;
  onAdd: (requirementId: string, credits: string) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [requirement, setRequirement] = useState(options[0]?.id ?? '');
  const row = options.find((o) => o.id === requirement) ?? options[0];
  const [credits, setCredits] = useState(() => defaultElectiveCredits(row?.uncovered_credits ?? '0', available));
  const [problem, setProblem] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!row) return;
    const value = credits.trim();
    if (!isDecimalString(value) || Number(value) <= 0) {
      setProblem('Enter the credits as a number, for example 4.');
      return;
    }
    onAdd(row.id, value);
  };

  return (
    <form className="inline-form" onSubmit={submit} aria-label={`Add elective credits to ${formatTerm(term)}`}>
      <div className="field">
        <label htmlFor={`${id}-requirement`}>Requirement</label>
        <select
          id={`${id}-requirement`}
          value={row?.id ?? ''}
          onChange={(e) => {
            setRequirement(e.target.value);
            const next = options.find((o) => o.id === e.target.value);
            setCredits(defaultElectiveCredits(next?.uncovered_credits ?? '0', available));
          }}
        >
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {`${o.label} — ${moreCredits(o.uncovered_credits)} needed`}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${id}-credits`}>Credits</label>
        <input id={`${id}-credits`} inputMode="decimal" value={credits} onChange={(e) => setCredits(e.target.value)} aria-invalid={problem ? true : undefined} />
        {problem ? <p className="field-error">{problem}</p> : null}
      </div>
      <div className="panel-row">
        <button type="submit" className="btn btn-primary btn-small">
          Add credits
        </button>
        <button type="button" className="btn btn-small" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
