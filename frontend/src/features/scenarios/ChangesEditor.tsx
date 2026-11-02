import { useId, useState, type FormEvent } from 'react';
import type { AcademicPlan, ScenarioChange, ScenarioOp } from '../../api/types';
import { compareTerms, formatTerm } from '../../lib/format';
import { isCourseCode, isDecimalString, normalizeCode } from '../../lib/validation';
import { describeChange, laterTerms, LETTER_GRADES, OP_LABEL, PLAN_OPS, type PlanItem } from './model';

interface ChangesEditorProps {
  plan: AcademicPlan | null;
  items: PlanItem[];
  changes: ScenarioChange[];
  onChange: (changes: ScenarioChange[], message: string) => void;
}

const OPS: ScenarioOp[] = ['drop', 'fail', 'grade', 'postpone', 'replace', 'cap'];

/** Typed controls for each change the server supports, plus the exact list of hypothetical changes. */
export function ChangesEditor({ plan, items, changes, onChange }: ChangesEditorProps) {
  const formId = useId();
  const [op, setOp] = useState<ScenarioOp>('drop');
  const [itemId, setItemId] = useState('');
  const [grade, setGrade] = useState('');
  const [term, setTerm] = useState('');
  const [code, setCode] = useState('');
  const [credits, setCredits] = useState('');
  const [error, setError] = useState<string | null>(null);

  const item = items.find((i) => i.id === itemId) ?? null;
  const planTerms = [...(plan?.semesters ?? [])].map((s) => s.term_id).sort(compareTerms);
  const postponeTerms = item ? laterTerms(plan, item.term_id) : [];
  const needsItem = op !== 'cap';

  const reset = () => {
    setItemId('');
    setGrade('');
    setTerm('');
    setCode('');
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
        if (!isCourseCode(code)) return 'Enter a course code such as CS 330.';
        if (!isDecimalString(credits.trim())) return 'Enter the replacement’s credits as a number such as 4 or 1.5.';
        return { op, item_id: item!.id, course: { normalized_code: normalizeCode(code), credits: credits.trim() } };
      case 'cap':
        if (!term) return 'Choose a term to cap.';
        if (!isDecimalString(credits.trim())) return 'Enter the credit cap as a number such as 16.';
        return { op, term_id: term, credits: credits.trim() };
      default:
        return 'Unsupported change.';
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const change = build();
    if (typeof change === 'string') {
      setError(change);
      return;
    }
    setError(null);
    onChange([...changes, change], `Added: ${describeChange(change, items)}. Save the scenario to re-evaluate.`);
    reset();
  };

  const remove = (index: number) => {
    const removed = changes[index];
    onChange(
      changes.filter((_, i) => i !== index),
      removed ? `Removed: ${describeChange(removed, items)}.` : 'Removed a change.',
    );
  };

  return (
    <section className="panel" aria-labelledby={`${formId}-h`}>
      <h2 id={`${formId}-h`}>Hypothetical changes</h2>
      {changes.length === 0 ? (
        <p className="muted">No hypothetical changes yet. This scenario currently matches the baseline plan.</p>
      ) : (
        <ol className="scenario-changes" aria-label="Hypothetical changes">
          {changes.map((change, index) => {
            const text = describeChange(change, items);
            return (
              <li key={`${change.op}-${index}`}>
                <span>{text}</span>{' '}
                <span className="muted">{PLAN_OPS.includes(change.op) ? '(plan edit if applied)' : '(stays hypothetical)'}</span>{' '}
                <button type="button" className="btn btn-small" aria-label={`Remove change: ${text}`} onClick={() => remove(index)}>
                  Remove
                </button>
              </li>
            );
          })}
        </ol>
      )}

      <form onSubmit={submit} aria-label="Add a hypothetical change" noValidate>
        <div className="field">
          <label htmlFor={`${formId}-op`}>Change type</label>
          <select
            id={`${formId}-op`}
            value={op}
            onChange={(e) => {
              setOp(e.target.value as ScenarioOp);
              setError(null);
              setTerm('');
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
          <div className="field">
            <label htmlFor={`${formId}-item`}>Planned course</label>
            <select
              id={`${formId}-item`}
              value={itemId}
              onChange={(e) => {
                setItemId(e.target.value);
                setTerm('');
              }}
            >
              <option value="">Choose a course</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.code} — {formatTerm(i.term_id)}
                </option>
              ))}
            </select>
            {items.length === 0 ? <span className="hint">The baseline plan has no selected courses to change.</span> : null}
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
              <option value="">{item ? 'Choose a later term' : 'Choose a course first'}</option>
              {postponeTerms.map((t) => (
                <option key={t} value={t}>
                  {formatTerm(t)}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {op === 'replace' ? (
          <>
            <div className="field">
              <label htmlFor={`${formId}-code`}>Replacement course code</label>
              <input id={`${formId}-code`} type="text" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
            </div>
            <div className="field">
              <label htmlFor={`${formId}-rcredits`}>Replacement credits</label>
              <input id={`${formId}-rcredits`} type="text" inputMode="decimal" value={credits} onChange={(e) => setCredits(e.target.value)} />
            </div>
          </>
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
              <input id={`${formId}-cap`} type="text" inputMode="decimal" value={credits} onChange={(e) => setCredits(e.target.value)} />
              <span className="hint">A hypothetical limit for this scenario. It never changes official load rules.</span>
            </div>
          </>
        ) : null}
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="btn">
          Add change
        </button>
      </form>
    </section>
  );
}
