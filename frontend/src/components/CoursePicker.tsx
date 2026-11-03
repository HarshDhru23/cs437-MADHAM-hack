import { useId, useMemo, useState, type FormEvent } from 'react';
import type { CatalogueCourse } from '../api/types';
import { formatCredits } from '../lib/format';
import { isCourseCode, isDecimalString, normalizeCode } from '../lib/validation';
import { EvidenceBadge } from './StatusBadge';

export interface PickedCourse {
  normalized_code: string;
  credits: string;
  fromCatalogue: boolean;
  course_version_id?: string;
}

interface CoursePickerProps {
  courses: CatalogueCourse[];
  coverage: string;
  onPick: (course: PickedCourse) => void;
  submitLabel?: string;
}


/**
 * Search the server catalogue by code/title/basket/department. When no reviewed
 * catalogue exists, the student may enter a code and credits manually; such an
 * entry is labelled unverified and the server decides everything else.
 */
export function CoursePicker({ courses, coverage, onPick, submitLabel = 'Add course' }: CoursePickerProps) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [code, setCode] = useState('');
  const [credits, setCredits] = useState('');
  const [error, setError] = useState<string | null>(null);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return courses.slice(0, 20);
    return courses
      .filter((c) => [c.normalized_code, c.title, c.department, ...(c.baskets ?? [])].some((v) => v?.toLowerCase().includes(q)))
      .slice(0, 20);
  }, [courses, query]);

  const submitManual = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = normalizeCode(code);
    if (!isCourseCode(code)) {
      setError('Enter a course code such as "CS 330" or "ES 242(N)".');
      return;
    }
    if (!isDecimalString(credits.trim())) {
      setError('Enter credits as a number, for example 4 or 1.5 (no leading zeros, at most 4 decimal places).');
      return;
    }
    setError(null);
    onPick({ normalized_code: trimmed, credits: credits.trim(), fromCatalogue: false });
    setCode('');
    setCredits('');
  };

  return (
    <div className="stack">
      {courses.length > 0 ? (
        <div>
          <div className="field">
            <label htmlFor={`${id}-q`}>Search courses (code, title, basket or department)</label>
            <input id={`${id}-q`} type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <ul className="issue-list" aria-label="Matching courses">
            {results.map((c) => (
              <li key={c.id}>
                <div className="panel-row">
                  <strong className="mono">{c.normalized_code}</strong>
                  <span>{c.title}</span>
                  <span className="num">{formatCredits(c.credits)} credits</span>
                  <EvidenceBadge value={c.offering_status ?? 'unknown'} />
                </div>
                <p className="muted">
                  Could satisfy: {c.could_satisfy && c.could_satisfy.length > 0 ? c.could_satisfy.join(', ') : 'Unknown'} · Recommended preparation (CoursePath team):{' '}
                  {c.prerequisite_summary ?? 'Unknown'}
                </p>
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={!c.credits}
                  onClick={() => onPick({ normalized_code: c.normalized_code, credits: c.credits ?? '', fromCatalogue: true, course_version_id: c.id })}
                >
                  Add {c.normalized_code}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="callout">
          <strong>No reviewed catalogue is available yet</strong> (coverage: {coverage}). The server cannot yet confirm titles, baskets, prerequisites or
          offerings. You can still add a course code with the credits you expect; it stays unverified.
        </div>
      )}
      <form onSubmit={submitManual} noValidate aria-label="Add a course by code">
        <div className="inline-fields">
          <div className="field">
            <label htmlFor={`${id}-code`}>Course code</label>
            <input id={`${id}-code`} type="text" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" aria-invalid={Boolean(error)} />
          </div>
          <div className="field">
            <label htmlFor={`${id}-credits`}>Credits (unverified estimate)</label>
            <input id={`${id}-credits`} type="text" inputMode="decimal" value={credits} onChange={(e) => setCredits(e.target.value)} aria-invalid={Boolean(error)} />
          </div>
          <div className="field">
            <button type="submit" className="btn btn-primary">
              {submitLabel}
            </button>
          </div>
        </div>
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </div>
  );
}
