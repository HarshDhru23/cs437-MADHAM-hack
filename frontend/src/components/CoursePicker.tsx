import { useId, useMemo, useState, type FormEvent } from 'react';
import { useCurriculum, useTermOfferings } from '../api/hooks';
import type { CatalogueCourse, RequirementDefinition } from '../api/types';
import { formatCredits, formatTerm } from '../lib/format';
import { CreditStepper } from './CreditStepper';
import { findCourses } from './CourseSearchBox';
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
  /** Which parts to show (all by default): the search, the project form and the by-code form. The add box shows them on separate tabs. */
  parts?: { search?: boolean; project?: boolean; manual?: boolean };
  /** Adds a Cancel button after the submit button of the forms, which is how the add box ends every tab. */
  onCancel?: () => void;
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
  parts,
  onCancel,
}: CoursePickerProps & { offered?: Set<string> | null; note?: string | null; onRetry?: () => void; choices?: RequirementChoice[]; semester?: string }) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [requirement, setRequirement] = useState('');
  const available = useMemo(() => (offered ? courses.filter((c) => offered.has(c.normalized_code)) : courses), [courses, offered]);
  const options = useMemo(() => choices ?? derivedChoices(available), [choices, available]);
  const chosen = options.find((o) => o.id === requirement) ?? null;
  const filtered = useMemo(() => {
    return findCourses(
      available.filter((c) => !chosen || (c.baskets ?? []).includes(chosen.id)),
      query,
    );
  }, [available, chosen, query]);
  const narrowed = Boolean(chosen) || query.trim() !== '';
  const results = narrowed ? filtered : filtered.slice(0, DEFAULT_LIMIT);

  const showSearch = parts?.search ?? true;
  const showProject = parts?.project ?? true;
  const showManual = parts?.manual ?? true;
  const departments = useMemo(() => courseDepartments(courses), [courses]);
  const count = filtered.length === 1 ? '1 course' : `${filtered.length} courses`;
  return (
    <div className="stack">
      {note && showSearch ? (
        <p className="muted" role="status">
          {note}{' '}
          {onRetry ? (
            <button type="button" className="btn btn-small" onClick={onRetry}>
              Try again
            </button>
          ) : null}
        </p>
      ) : null}
      {showSearch && courses.length > 0 && !(offered && offered.size === 0) ? (
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
      ) : showSearch && courses.length === 0 ? (
        <div className="callout">
          <strong>No course list is available right now.</strong> You can still add a course by its code and credits.
        </div>
      ) : null}
      {showProject ? <ProjectCourseForm departments={departments} onPick={onPick} onCancel={onCancel} /> : null}
      {showManual ? <ManualCourseForm submitLabel={submitLabel} onPick={onPick} onCancel={onCancel} /> : null}
    </div>
  );
}

/** The departments a project can be arranged in, as the catalogue names them (CS first), for the quick-pick buttons. */
export function courseDepartments(courses: CatalogueCourse[]): string[] {
  const found = new Set<string>(['CS']);
  for (const c of courses) if (c.department && /^[A-Z]{2,4}$/.test(c.department)) found.add(c.department);
  return [...found].sort((a, b) => (a === 'CS' ? -1 : b === 'CS' ? 1 : a.localeCompare(b))).slice(0, 8);
}

/**
 * D-52: a project (a department's 299, 399 or 499 course) is arranged with a supervisor, so no timetable lists it. The student gives the department,
 * level and credits; the server's allocation decides whether it is the open project or an elective, so nothing here asks which.
 */
export function ProjectCourseForm({ departments = ['CS'], onPick, onCancel }: { departments?: string[]; onPick: (course: PickedCourse) => void; onCancel?: () => void }) {
  const id = useId();
  const [dept, setDept] = useState('CS');
  const [level, setLevel] = useState('299');
  const [credits, setCredits] = useState('4');
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const department = dept.trim().toUpperCase();
    if (!/^[A-Z]{2,4}$/.test(department)) {
      setError('Enter the department as two to four letters, for example CS.');
      return;
    }
    const value = credits.trim();
    if (!isDecimalString(value) || Number(value) <= 0) {
      setError('Enter the project credits as a number above 0, for example 4.');
      return;
    }
    setError(null);
    onPick({ normalized_code: `${department} ${level}`, credits: value, fromCatalogue: false });
  };

  return (
    <form className="add-form" data-add-form="project" onSubmit={submit} noValidate aria-label="Add a project course">
      <p className="muted">A project is arranged with a supervisor, so it is not in the timetable. CoursePath decides by itself whether it counts as your open project or as an elective.</p>
      <div className="field">
        <label htmlFor={`${id}-dept`}>Department code</label>
        <input id={`${id}-dept`} type="text" value={dept} onChange={(e) => setDept(e.target.value)} autoComplete="off" aria-invalid={Boolean(error)} />
        <div className="chips" role="group" aria-label="Departments">
          {departments.map((d) => (
            <button key={d} type="button" className="chip-button" aria-pressed={dept.trim().toUpperCase() === d} onClick={() => setDept(d)}>
              {d}
            </button>
          ))}
        </div>
      </div>
      <div className="add-row">
        <div className="field">
          <label htmlFor={`${id}-level`}>Project level</label>
          <select id={`${id}-level`} value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="299">299</option>
            <option value="399">399</option>
            <option value="499">499</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${id}-credits`}>Project credits</label>
          <CreditStepper id={`${id}-credits`} value={credits} onChange={setCredits} min={1} max={12} invalid={Boolean(error)} />
        </div>
      </div>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="add-actions" data-add-actions>
        <button type="submit" className="btn btn-primary">
          Add project course
        </button>
        {onCancel ? (
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}

/** A course the list does not have, or anything outside the timetable, added by its code and credits. */
export function ManualCourseForm({ submitLabel = 'Add course', onPick, onCancel }: { submitLabel?: string; onPick: (course: PickedCourse) => void; onCancel?: () => void }) {
  const id = useId();
  const [code, setCode] = useState('');
  const [credits, setCredits] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
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
    <form className="add-form" data-add-form="course" onSubmit={submit} noValidate aria-label="Add a course by code">
      <div className="add-row">
        <div className="field">
          <label htmlFor={`${id}-code`}>Course code</label>
          <input id={`${id}-code`} type="text" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" aria-invalid={Boolean(error)} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-credits`}>Credits</label>
          <input id={`${id}-credits`} type="text" inputMode="decimal" value={credits} onChange={(e) => setCredits(e.target.value)} aria-invalid={Boolean(error)} />
        </div>
      </div>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="add-actions" data-add-actions>
        <button type="submit" className="btn btn-primary">
          {submitLabel}
        </button>
        {onCancel ? (
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
