import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { useCatalogue } from '../../api/hooks';
import type { AcademicPlan, ScenarioChange, ScenarioOp } from '../../api/types';
import { CoursePicker, type PickedCourse } from '../../components/CoursePicker';
import { compareTerms, formatCredits, formatTerm } from '../../lib/format';
import { isDecimalString } from '../../lib/validation';
import { describeChange, fitChanges, laterTerms, LETTER_GRADES, OP_LABEL, PLAN_OPS, type PlanItem } from './model';
import { PlannedCourseSearch } from './PlannedCourseSearch';

interface ChangesEditorProps {
  plan: AcademicPlan | null;
  items: PlanItem[];
  /** Every item the plan has had, so a change on a course the plan has since dropped still shows its name (not an internal id). */
  named?: PlanItem[];
  changes: ScenarioChange[];
  onChange: (changes: ScenarioChange[], message: string) => void;
}

const OPS: ScenarioOp[] = ['drop', 'fail', 'grade', 'postpone', 'replace', 'cap'];

/**
 * Typed controls for each change the server supports, plus the exact list of
 * hypothetical changes. Only changes the server will accept after the earlier
 * ones are offered; a listed change it would refuse says why.
 */
export function ChangesEditor({ plan, items, named, changes, onChange }: ChangesEditorProps) {
  const names = named ?? items;
  const formId = useId();
  const [op, setOp] = useState<ScenarioOp>('drop');
  const [itemId, setItemId] = useState('');
  const [grade, setGrade] = useState('');
  const [term, setTerm] = useState('');
  const [replacement, setReplacement] = useState<(PickedCourse & { title?: string }) | null>(null);
  const [credits, setCredits] = useState('');
  const [error, setError] = useState<string | null>(null);
  const catalogue = useCatalogue();
  const titles = useMemo(() => new Map((catalogue.data?.courses ?? []).map((c) => [c.normalized_code, c.title] as const)), [catalogue.data]);
  const titleOf = (code: string) => titles.get(code) || undefined;

  const { refused, open } = fitChanges(changes, items);
  const refusedAt = new Map(refused.map((r) => [r.index, r.reason]));
  // A course's term after the earlier changes; dropped, failed and graded courses take no further changes.
  const item = open.find((i) => i.id === itemId) ?? null;
  const planTerms = [...(plan?.semesters ?? [])].map((s) => s.term_id).sort(compareTerms);
  const postponeTerms = item ? laterTerms(plan, item.term_id) : [];
  const needsItem = op !== 'cap';

  const reset = () => {
    setItemId('');
    setGrade('');
    setTerm('');
    setReplacement(null);
    setCredits('');
  };

  const build = (): ScenarioChange | string => {
    if (needsItem && !item) return 'Choose a planned course.';
    switch (op) {
      case 'drop':
      case 'fail':
        return { op, item_id: item!.id };
      case 'grade':
        return grade ? { op, item_id: item!.id, grade } : 'Choose a letter grade.';
      case 'postpone':
        return term ? { op, item_id: item!.id, term_id: term } : 'Choose a later term.';
      case 'replace':
        return replacement ? { op, item_id: item!.id, course: { normalized_code: replacement.normalized_code, credits: replacement.credits } } : 'Choose a replacement course.';
      case 'cap':
        if (!term) return 'Choose a term to cap.';
        if (!isDecimalString(credits.trim())) return 'Enter the credit cap as a number such as 16.';
        return { op, term_id: term, credits: credits.trim() };
      default:
        return 'Unsupported change.';
    }
  };

  const submit = () => {
    const change = build();
    if (typeof change === 'string') {
      setError(change);
      return;
    }
    setError(null);
    onChange([...changes, change], `Added: ${describeChange(change, names)}. Save the scenario to re-evaluate.`);
    reset();
  };

  const remove = (index: number) => {
    const removed = changes[index];
    onChange(
      changes.filter((_, i) => i !== index),
      removed ? `Removed: ${describeChange(removed, names)}.` : 'Removed a change.',
    );
  };

  return (
    <section className="panel" aria-labelledby={`${formId}-h`}>
      <h3 id={`${formId}-h`}>Hypothetical changes</h3>
      {changes.length === 0 ? (
        <p className="muted">No hypothetical changes yet. This scenario currently matches the baseline plan.</p>
      ) : (
        <ol className="scenario-changes" aria-label="Hypothetical changes">
          {changes.map((change, index) => {
            const text = describeChange(change, names);
            const why = refusedAt.get(index);
            return (
              <li key={`${change.op}-${index}`} className="chip change-chip" data-op={change.op}>
                <span>{text}</span>{' '}
                <span className="muted">{PLAN_OPS.includes(change.op) ? '(plan edit if applied)' : '(stays hypothetical)'}</span>{' '}
                <button type="button" className="btn btn-small" aria-label={`Remove change: ${text}`} onClick={() => remove(index)}>
                  Remove
                </button>
                {why ? (
                  <p className="field-error">
                    This change cannot be saved: {why} Remove it before saving.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      {/* A group, not a <form>: the replacement picker holds a form of its own (add by code), and forms cannot be nested. */}
      <div role="form" aria-label="Add a hypothetical change">
        <div className="field">
          <label htmlFor={`${formId}-op`}>Change type</label>
          <select
            id={`${formId}-op`}
            value={op}
            onChange={(e) => {
              setOp(e.target.value as ScenarioOp);
              setError(null);
              setTerm('');
              setReplacement(null);
            }}
          >
            {OPS.map((o) => (
              <option key={o} value={o}>
                {OP_LABEL[o]}
              </option>
            ))}
          </select>
        </div>
        {needsItem ? (
          <div>
            <PlannedCourseSearch
              items={open}
              titleOf={titleOf}
              value={itemId}
              onChange={(id) => {
                setItemId(id);
                setTerm('');
                setReplacement(null);
              }}
            />
            {items.length === 0 ? (
              <span className="hint">The baseline plan has no selected courses to change.</span>
            ) : open.length < items.length ? (
              <span className="hint">Courses this scenario already drops, fails or grades take no further changes, so they are not listed.</span>
            ) : null}
          </div>
        ) : null}
        {op === 'grade' ? (
          <div className="field">
            <label htmlFor={`${formId}-grade`}>Hypothetical letter grade</label>
            <select id={`${formId}-grade`} value={grade} onChange={(e) => setGrade(e.target.value)}>
              <option value="">Choose a grade</option>
              {LETTER_GRADES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            <span className="hint">Used only in the labelled hypothetical projection. It is never written to your record.</span>
          </div>
        ) : null}
        {op === 'postpone' ? (
          <div className="field">
            <label htmlFor={`${formId}-later`}>Later term</label>
            <select id={`${formId}-later`} value={term} onChange={(e) => setTerm(e.target.value)} disabled={!item}>
              <option value="">{item ? `Choose a term after ${formatTerm(item.term_id)}` : 'Choose a course first'}</option>
              {postponeTerms.map((t) => (
                <option key={t} value={t}>
                  {formatTerm(t)}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {op === 'replace' ? (
          <div className="field">
            <span className="label">Replacement course</span>
            {!item ? (
              <span className="hint">Choose the planned course to replace first.</span>
            ) : replacement ? (
              <div role="group" aria-label="Replacement course" className="panel-row">
                <strong>
                  {[replacement.normalized_code, replacement.title ?? titleOf(replacement.normalized_code), `${formatCredits(replacement.credits)} credits`].filter(Boolean).join(' · ')}
                </strong>
                <button type="button" className="btn btn-small" onClick={() => setReplacement(null)}>
                  Choose a different course
                </button>
              </div>
            ) : (
              <CoursePicker
                courses={catalogue.data?.courses ?? []}
                coverage={catalogue.data?.coverage ?? 'unknown'}
                term={item.term_id}
                pickLabel="Use"
                submitLabel="Use this course"
                onPick={(course) => {
                  setReplacement({ ...course, title: titleOf(course.normalized_code) });
                  setError(null);
                }}
              />
            )}
          </div>
        ) : null}
        {op === 'cap' ? (
          <>
            <div className="field">
              <label htmlFor={`${formId}-term`}>Term to cap</label>
              <select id={`${formId}-term`} value={term} onChange={(e) => setTerm(e.target.value)}>
                <option value="">Choose a term</option>
                {planTerms.map((t) => (
                  <option key={t} value={t}>
                    {formatTerm(t)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`${formId}-cap`}>Credit cap</label>
              <input
                id={`${formId}-cap`}
                type="text"
                inputMode="decimal"
                value={credits}
                onChange={(e) => setCredits(e.target.value)}
                onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
              <span className="hint">A hypothetical limit for this scenario. It never changes official load rules.</span>
            </div>
          </>
        ) : null}
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="button" className="btn" onClick={submit}>
          Add change
        </button>
      </div>
    </section>
  );
}
