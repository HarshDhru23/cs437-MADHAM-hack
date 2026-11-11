import { useId, useMemo, useState, type FormEvent } from 'react';
import { useCurriculum, useTermOfferings } from '../api/hooks';
import type { CatalogueCourse, RequirementDefinition } from '../api/types';
import { formatCredits, formatTerm } from '../lib/format';
import { isCourseCode, isDecimalString, normalizeCode } from '../lib/validation';

export interface PickedCourse {
  normalized_code: string;
  credits: string;
  fromCatalogue: boolean;
  course_version_id?: string;
}

export interface RequirementChoice {
  id: string;
  label: string;
}

interface CoursePickerProps {
  courses: CatalogueCourse[];
  coverage: string;
  onPick: (course: PickedCourse) => void;
  submitLabel?: string;
  /** The verb on each listed course's button: 'Add' (the default) or, for example, 'Use'. */
  pickLabel?: string;
  /** The semester the course is being added to. Only courses offered in it are listed, and the requirement filter is built from the rules. */
  term?: string;
}

/** Shown until a requirement is chosen or something is typed: the full list of a semester is hundreds of courses. */
const DEFAULT_LIMIT = 20;

/** The requirements a student picks courses for: baskets and electives, not the single mandatory courses. In the rules' order. */
function requirementChoices(definitions: RequirementDefinition[] | undefined, courses: CatalogueCourse[]): RequirementChoice[] {
  const labels = new Map<string, string>(); // the catalogue's own wording ("Counts toward"), so the filter and the results always agree
  for (const c of courses) (c.baskets ?? []).forEach((id, index) => c.could_satisfy?.[index] && labels.set(id, c.could_satisfy[index]!));
  const found: RequirementChoice[] = [];
  const walk = (nodes: RequirementDefinition[]) => {
    for (const node of nodes) {
      if (node.children && node.children.length > 0) walk(node.children);
      else if (node.type !== 'mandatory_course' && Number(node.minimum_credits ?? 0) > 0 && labels.has(node.id)) found.push({ id: node.id, label: labels.get(node.id) ?? node.label ?? node.id });
    }
  };
  walk(definitions ?? []);
  return found;
}

/** Without the rules to hand: the requirements the catalogue itself names, leaving out those a single course fills (the mandatory ones). */
function derivedChoices(courses: CatalogueCourse[]): RequirementChoice[] {
  const seen = new Map<string, { label: string; count: number }>();
  for (const course of courses) {
    (course.baskets ?? []).forEach((id, index) => {
      const label = course.could_satisfy?.[index];
      if (!label) return;
      const entry = seen.get(id) ?? { label, count: 0 };
      entry.count += 1;
      seen.set(id, entry);
    });
  }
  return [...seen.entries()].filter(([, v]) => v.count > 1).map(([id, v]) => ({ id, label: v.label })).sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Search the catalogue by code/title/department and by the requirement a course counts toward ("Systems basket", "Open electives").
 * Given a `term`, only courses offered in that semester are listed. A course can also be added by its code and credits, which is how
 * online courses and anything outside the timetable are added.
 */
export function CoursePicker(props: CoursePickerProps) {
  return props.term ? <TermCoursePicker {...props} term={props.term} /> : <PickerView {...props} />;
}

/** Loads the semester's offerings and the rules, then renders the picker with them. */
function TermCoursePicker({ term, ...rest }: CoursePickerProps & { term: string }) {
  const offerings = useTermOfferings(term);
  const curriculum = useCurriculum();
  const summer = term.endsWith('SUMMER');
  const snapshot = offerings.data && offerings.data.id ? offerings.data : null;
  const codes = useMemo(() => new Set((snapshot?.offerings ?? []).flatMap((o) => [o.code, o.display_code].filter((c): c is string => Boolean(c)))), [snapshot]);
  const choices = useMemo(() => (curriculum.data ? requirementChoices(curriculum.data.requirements, rest.courses) : undefined), [curriculum.data, rest.courses]);

  let offered: Set<string> | null = null;
  let note: string | null = null;
  if (summer) {
    offered = new Set();
    note = `No timetabled courses run in ${formatTerm(term)}. Online courses and anything else can be added below by their code and credits.`;
  } else if (offerings.loading) {
    offered = new Set();
    note = 'Loading the courses offered in this semester…';
  } else if (offerings.error) {
    note = 'The courses offered in this semester could not be loaded, so all courses are listed.';
  } else if (snapshot) {
    offered = codes;
  } else {
    note = 'Showing all courses.';
  }
  return (
    <PickerView {...rest} offered={offered} note={note} onRetry={offerings.error ? offerings.reload : undefined} choices={choices} semester={formatTerm(term)} />
  );
}

function PickerView({
  courses,
  onPick,
  submitLabel = 'Add course',
  pickLabel = 'Add',
  offered = null,
  note = null,
  onRetry,
  choices,
  semester,
}: CoursePickerProps & { offered?: Set<string> | null; note?: string | null; onRetry?: () => void; choices?: RequirementChoice[]; semester?: string }) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [requirement, setRequirement] = useState('');
  const [code, setCode] = useState('');
  const [credits, setCredits] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [projectDept, setProjectDept] = useState('CS');
  const [projectLevel, setProjectLevel] = useState('299');
  const [projectCredits, setProjectCredits] = useState('4');
  const [projectError, setProjectError] = useState<string | null>(null);
  const available = useMemo(() => (offered ? courses.filter((c) => offered.has(c.normalized_code)) : courses), [courses, offered]);
  const options = useMemo(() => choices ?? derivedChoices(available), [choices, available]);
  const chosen = options.find((o) => o.id === requirement) ?? null;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return available
      .filter((c) => !chosen || (c.baskets ?? []).includes(chosen.id))
      .filter((c) => !q || [c.normalized_code, c.title, c.department, ...(c.could_satisfy ?? [])].some((v) => v?.toLowerCase().includes(q)))
      .sort((a, b) => a.normalized_code.localeCompare(b.normalized_code, undefined, { numeric: true }));
  }, [available, chosen, query]);
  const narrowed = Boolean(chosen) || query.trim() !== '';
  const results = narrowed ? filtered : filtered.slice(0, DEFAULT_LIMIT);

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

  // D-52: a project (a department's 299, 399 or 499 course) is arranged with a supervisor, so no timetable lists it. The student gives the department,
  // level and credits; the server's allocation decides whether it is the open project or an elective, so nothing here asks which.
  const submitProject = (event: FormEvent) => {
    event.preventDefault();
    const dept = projectDept.trim().toUpperCase();
    if (!/^[A-Z]{2,4}$/.test(dept)) {
      setProjectError('Enter the department as two to four letters, for example CS.');
      return;
    }
    const value = projectCredits.trim();
    if (!isDecimalString(value) || Number(value) <= 0) {
      setProjectError('Enter the project credits as a number above 0, for example 4.');
      return;
    }
    setProjectError(null);
    onPick({ normalized_code: `${dept} ${projectLevel}`, credits: value, fromCatalogue: false });
  };

  const count = filtered.length === 1 ? '1 course' : `${filtered.length} courses`;
  return (
    <div className="stack">
      {note ? (
        <p className="muted" role="status">
          {note}{' '}
          {onRetry ? (
            <button type="button" className="btn btn-small" onClick={onRetry}>
              Try again
            </button>
          ) : null}
        </p>
      ) : null}
      {courses.length > 0 && !(offered && offered.size === 0) ? (
        <div>
          <div className="inline-fields">
            {options.length > 0 ? (
              <div className="field">
                <label htmlFor={`${id}-req`}>Requirement</label>
                <select id={`${id}-req`} value={requirement} onChange={(e) => setRequirement(e.target.value)}>
                  <option value="">Any requirement</option>
                  {options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="field">
              <label htmlFor={`${id}-q`}>Search courses (code, title, requirement or department)</label>
              <input id={`${id}-q`} type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          </div>
          <p className="muted num" aria-live="polite">
            {narrowed
              ? `${count}${chosen ? ` count toward ${chosen.label}` : ''}${semester ? ` in ${semester}` : ''}`
              : filtered.length > DEFAULT_LIMIT
                ? `Showing ${DEFAULT_LIMIT} of ${filtered.length} courses. Choose a requirement or type to narrow them down.`
                : count}
          </p>
          <ul className="issue-list course-results" aria-label="Matching courses" style={{ maxHeight: '22rem', overflowY: 'auto' }}>
            {results.map((c) => (
              <li key={c.id}>
                <div className="panel-row">
                  <strong className="mono">{c.normalized_code}</strong>
                  <span>{c.title}</span>
                  <span className="num">{formatCredits(c.credits)} credits</span>
                </div>
                <p className="muted">
                  {c.could_satisfy && c.could_satisfy.length > 0 ? `Counts toward: ${c.could_satisfy.join(', ')}` : 'Counts toward no degree requirement'}
                  {c.prerequisite_summary && c.prerequisite_summary !== 'No recommendation recorded' ? ` · Recommended before: ${c.prerequisite_summary}` : ''}
                </p>
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={!c.credits}
                  onClick={() => onPick({ normalized_code: c.normalized_code, credits: c.credits ?? '', fromCatalogue: true, course_version_id: c.id })}
                >
                  {pickLabel} {c.normalized_code}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : courses.length === 0 ? (
        <div className="callout">
          <strong>No course list is available right now.</strong> You can still add a course by its code and credits.
        </div>
      ) : null}
      <form onSubmit={submitProject} noValidate aria-label="Add a project course">
        <h3>Project course</h3>
        <p className="muted">A project is arranged with a supervisor, so it is not in the timetable. CoursePath decides by itself whether it counts as your open project or as an elective.</p>
        <div className="inline-fields">
          <div className="field">
            <label htmlFor={`${id}-pdept`}>Department code</label>
            <input id={`${id}-pdept`} type="text" value={projectDept} onChange={(e) => setProjectDept(e.target.value)} autoComplete="off" aria-invalid={Boolean(projectError)} />
          </div>
          <div className="field">
            <label htmlFor={`${id}-plevel`}>Project level</label>
            <select id={`${id}-plevel`} value={projectLevel} onChange={(e) => setProjectLevel(e.target.value)}>
              <option value="299">299</option>
              <option value="399">399</option>
              <option value="499">499</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor={`${id}-pcredits`}>Project credits</label>
            <input id={`${id}-pcredits`} type="text" inputMode="decimal" value={projectCredits} onChange={(e) => setProjectCredits(e.target.value)} aria-invalid={Boolean(projectError)} />
          </div>
          <div className="field">
            <button type="submit" className="btn">
              Add project course
            </button>
          </div>
        </div>
        {projectError ? (
          <p className="field-error" role="alert">
            {projectError}
          </p>
        ) : null}
      </form>
      <form onSubmit={submitManual} noValidate aria-label="Add a course by code">
        <div className="inline-fields">
          <div className="field">
            <label htmlFor={`${id}-code`}>Course code</label>
            <input id={`${id}-code`} type="text" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" aria-invalid={Boolean(error)} />
          </div>
          <div className="field">
            <label htmlFor={`${id}-credits`}>Credits</label>
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
