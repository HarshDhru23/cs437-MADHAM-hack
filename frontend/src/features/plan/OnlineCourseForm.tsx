import { useId, useState, type FormEvent } from 'react';
import type { PlanCheckRequirement, PlannedSemester, RequirementPlaceholder } from '../../api/types';
import { formatCredits, formatTerm } from '../../lib/format';
import { isDecimalString } from '../../lib/validation';
import { moreCredits } from './PlanProgress';

/** What an online course placeholder is called when the student gives it no name of their own. */
export const ONLINE_LABEL = 'Online course';
const NAME_LIMIT = 80;
const MIN_CREDITS = 1;
const MAX_CREDITS = 8;

/** The requirements an online course can be added for, in the order a student reads them. The names are the fallback before the server has answered. */
const ONLINE_REQUIREMENTS: { id: string; label: string }[] = [
  { id: 'hss-other', label: 'HSS electives' },
  { id: 'bs-elective', label: 'Basic Science elective' },
  { id: 'cse-general', label: 'General CSE electives' },
  { id: 'open-electives', label: 'Open electives' },
];

/** True for an online course the student takes (a generated one, or one they added). */
export const isOnline = (p: Pick<RequirementPlaceholder, 'online' | 'label'>): boolean => p.online === true || (p.label ?? '').startsWith(ONLINE_LABEL);

/** True when the student named the course (for example "Machine Learning on NPTEL"): it is chosen already, not a placeholder to fill. */
export const isNamedOnline = (p: Pick<RequirementPlaceholder, 'online' | 'label'>): boolean => isOnline(p) && !!p.label && p.label !== ONLINE_LABEL;

/** An unused placeholder id for a new online course in a semester. */
export function nextOnlineId(term: string, semesters: PlannedSemester[]): string {
  const taken = new Set(semesters.flatMap((s) => s.placeholders.map((p) => p.id)));
  let n = 1;
  while (taken.has(`user-online-${term}-${n}`)) n += 1;
  return `user-online-${term}-${n}`;
}

export interface OnlineCourseChoice {
  requirement_id: string;
  desired_credits: string;
  label: string;
}

export function onlinePlaceholder(id: string, choice: OnlineCourseChoice): RequirementPlaceholder {
  return { id, requirement_id: choice.requirement_id, desired_credits: choice.desired_credits, label: choice.label, online: true };
}

function optionsFrom(requirements: PlanCheckRequirement[] | undefined) {
  return ONLINE_REQUIREMENTS.map((r) => {
    const row = requirements?.find((x) => x.id === r.id);
    return { id: r.id, label: row?.label ?? r.label, needed: row && Number(row.uncovered_credits) > 0 ? row.uncovered_credits : null };
  });
}

/** 4 credits, or what the requirement still needs, or what the semester has room for, whichever is least (1 to 8). */
function defaultCredits(needed: string | null, room: string | undefined): string {
  let n = 4;
  if (needed !== null && Number(needed) > 0) n = Math.min(n, Number(needed));
  if (room !== undefined && Number(room) > 0) n = Math.min(n, Number(room));
  n = Math.min(MAX_CREDITS, Math.max(MIN_CREDITS, n));
  return String(Number.isFinite(n) ? n : 4);
}

/**
 * Adds an online course to a semester or a summer break: which requirement it counts toward (HSS, Basic Science, CSE or open electives),
 * how many credits (1 to 8) and, if the student wants, its name. The plan holds the credits; the server decides how many online credits
 * count toward the degree and says so after every change.
 */
export function OnlineCourseForm({
  term,
  requirements,
  room,
  onAdd,
  onCancel,
}: {
  term: string;
  requirements: PlanCheckRequirement[] | undefined;
  /** How many more credits the semester can take, from the server (undefined before its first answer). */
  room: string | undefined;
  onAdd: (choice: OnlineCourseChoice) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const summer = term.endsWith('SUMMER');
  room = summer ? room : undefined;   // D-50: a regular semester's load never includes online credits, so its room is no limit here
  const options = optionsFrom(requirements);
  const [requirement, setRequirement] = useState(() => options.find((o) => o.needed !== null)?.id ?? options[0]!.id);
  const [credits, setCredits] = useState(() => defaultCredits(options.find((o) => o.id === requirement)?.needed ?? null, room));
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const chosen = options.find((o) => o.id === requirement) ?? options[0]!;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = credits.trim();
    if (!isDecimalString(value) || Number(value) < MIN_CREDITS || Number(value) > MAX_CREDITS) {
      setProblem(`Enter the credits as a number from ${MIN_CREDITS} to ${MAX_CREDITS}.`);
      return;
    }
    if (name.trim().length > NAME_LIMIT) {
      setProblem(`Use at most ${NAME_LIMIT} characters for the name.`);
      return;
    }
    setProblem(null);
    onAdd({ requirement_id: chosen.id, desired_credits: value, label: name.trim() || ONLINE_LABEL });
  };

  return (
    <form className="inline-form" onSubmit={submit} noValidate aria-label={`Add online course to ${formatTerm(term)}`}>
      <div className="field">
        <label htmlFor={`${id}-requirement`}>Counts toward</label>
        <select
          id={`${id}-requirement`}
          value={chosen.id}
          onChange={(e) => {
            setRequirement(e.target.value);
            setCredits(defaultCredits(options.find((o) => o.id === e.target.value)?.needed ?? null, room));
          }}
        >
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.needed !== null ? `${o.label} — ${moreCredits(o.needed)} needed` : o.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${id}-credits`}>Credits</label>
        <input id={`${id}-credits`} inputMode="decimal" value={credits} onChange={(e) => setCredits(e.target.value)} aria-invalid={problem ? true : undefined} />
      </div>
      <div className="field">
        <label htmlFor={`${id}-name`}>Course name (optional)</label>
        <input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} placeholder="For example Machine Learning on NPTEL" aria-invalid={problem ? true : undefined} />
      </div>
      {room !== undefined ? <p className="muted">{`This break has room for ${formatCredits(room)} more credits.`}</p> : null}
      {!summer ? <p className="muted">Online courses are not part of the semester&apos;s credit limit. They count toward your degree within the online limit.</p> : null}
      {problem ? (
        <p className="field-error" role="alert">
          {problem}
        </p>
      ) : null}
      <div className="panel-row">
        <button type="submit" className="btn btn-primary btn-small">
          Add online course
        </button>
        <button type="button" className="btn btn-small" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
