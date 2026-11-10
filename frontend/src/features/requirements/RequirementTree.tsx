import { createContext, useContext, useId, useState } from 'react';
import type { Allocation, CatalogueCourse, Curriculum, PlanHolds, RequirementDefinition, RequirementResult, RequirementStatus } from '../../api/types';
import { formatTerm } from '../../lib/format';
import { Badge } from '../../components/StatusBadge';
import { formatCredits, humanize } from '../../lib/format';
import './requirements.css';

/** How a course that counts toward a requirement was found: taken (with its grade), being taken now, or planned. */
export interface CountedSource {
  code: string;
  title?: string;
  grade?: string;
  kind: 'done' | 'current' | 'planned';
}

const COURSE_LIST_LIMIT = 30;

export function requirementLabel(def: RequirementDefinition | undefined, result?: RequirementResult): string {
  if (def?.label) return def.label;
  if (result?.label && result.label !== result.id) return result.label;
  return humanize(def?.id ?? result?.id ?? 'requirement');
}

export function indexDefinitions(curriculum: Curriculum | null): Map<string, RequirementDefinition> {
  const map = new Map<string, RequirementDefinition>();
  const walk = (defs: RequirementDefinition[] = []) => {
    for (const d of defs) {
      map.set(d.id, d);
      walk(d.children);
    }
  };
  walk(curriculum?.requirements);
  return map;
}

interface Ctx {
  definitions: Map<string, RequirementDefinition>;
  ledger: Allocation[];
  sources: Map<string, CountedSource>;
  catalogue: CatalogueCourse[];
  /** What the plan keeps in placeholders, per requirement (D-53); empty outside the "With my plan" view. */
  holds: PlanHolds['requirements'];
  /** The group the ring is pointing at (top-level rows only), and how to point at one. */
  activeId: string | null;
  onActive: (id: string | null) => void;
}

const TreeContext = createContext<Ctx>({ definitions: new Map(), ledger: [], sources: new Map(), catalogue: [], holds: {}, activeId: null, onActive: () => undefined });

const MARK: Record<RequirementStatus, { tone: 'success' | 'warning' | 'scenario' | 'neutral'; symbol: string; label: string }> = {
  satisfied: { tone: 'success', symbol: '✓', label: 'Done' },
  conditional: { tone: 'scenario', symbol: '◐', label: 'Planned' },
  pending: { tone: 'warning', symbol: '○', label: 'To do' },
  needs_review: { tone: 'neutral', symbol: '○', label: 'To do' },
};

function StatusMark({ status }: { status: RequirementStatus }) {
  const meta = MARK[status] ?? MARK.pending;
  return (
    <Badge tone={meta.tone} symbol={meta.symbol}>
      {meta.label}
    </Badge>
  );
}

interface TreeProps {
  /** Every definition by id, so a server result can be shown with its label and courses. */
  definitions: Map<string, RequirementDefinition>;
  /** Without a record: the requirements only. */
  defs?: RequirementDefinition[];
  /** With a record: the server's result for each requirement. */
  results?: RequirementResult[];
  ledger?: Allocation[];
  sources?: Map<string, CountedSource>;
  catalogue?: CatalogueCourse[];
  /** The "With my plan" view: the credits the plan keeps in placeholders (D-53). */
  holds?: PlanHolds['requirements'];
  label?: string;
  /** Pointing at a group row highlights its arc in the ring, and the other way round. */
  activeId?: string | null;
  onActive?: (id: string | null) => void;
}

/** The top-level groups that carry credits, in the order the list (and so the ring) shows them. */
export function shownGroups(definitions: Map<string, RequirementDefinition>, defs?: RequirementDefinition[], results?: RequirementResult[]) {
  const items = results
    ? results.map((r) => ({ id: r.id, result: r as RequirementResult | undefined, def: definitions.get(r.id) }))
    : (defs ?? []).map((d) => ({ id: d.id, result: undefined, def: d }));
  return items.filter((i) => i.def && i.def.type !== 'noncredit') as { id: string; result: RequirementResult | undefined; def: RequirementDefinition }[];
}

export function RequirementTree({ definitions, defs, results, ledger = [], sources, catalogue = [], holds = {}, label, activeId = null, onActive = () => undefined }: TreeProps) {
  const value: Ctx = { definitions, ledger, sources: sources ?? new Map(), catalogue, holds, activeId, onActive };
  const shown = shownGroups(definitions, defs, results);
  return (
    <TreeContext.Provider value={value}>
      <ul className="req-list" aria-label={label}>
        {shown.map(({ id, result, def }) => (
          <RequirementRow key={id} id={id} result={result} def={def} top />
        ))}
      </ul>
    </TreeContext.Provider>
  );
}

const creditsText = (def: RequirementDefinition, result?: RequirementResult): string => {
  const required = def.minimum_credits ?? result?.required_credits;
  return required ? `${formatCredits(required)} credits` : '';
};

/** Credits counted so far, never shown above what the requirement asks for. */
function progressText(def: RequirementDefinition, result: RequirementResult): string | null {
  const required = def.minimum_credits ?? result.required_credits;
  if (!required || result.counted_credits == null) return null;
  const counted = Number(result.counted_credits) > Number(required) ? required : result.counted_credits;
  return `${formatCredits(counted)} of ${formatCredits(required)} credits`;
}

/** How much of a requirement's bar to fill: a drawing detail, the counted credits themselves come from the server. */
function meterPercent(def: RequirementDefinition, result?: RequirementResult, held?: string): number {
  const required = Number(def.minimum_credits ?? result?.required_credits);
  const counted = Number(result?.counted_credits) + (held ? Number(held) : 0);
  return Number.isFinite(required) && required > 0 && Number.isFinite(counted) ? Math.max(0, Math.min(100, (counted / required) * 100)) : 0;
}

/** "4 credits kept in placeholders": the credits a plan keeps for a requirement, and that a course still has to be chosen for them. */
const heldText = (held: string): string => `${formatCredits(held)} ${Number(held) === 1 ? 'credit' : 'credits'} kept in placeholders`;

function RequirementRow({ id, result, def, top = false }: { id: string; result?: RequirementResult; def: RequirementDefinition; top?: boolean }) {
  const { catalogue, ledger, sources, definitions, activeId, onActive, holds } = useContext(TreeContext);
  const hold = holds[id];
  const held = hold && Number(hold.held_credits) > 0 ? hold.held_credits : undefined;
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const name = requirementLabel(def, result);
  const counted = result ? ledger.filter((a) => result.allocation_ids.includes(a.id)) : [];
  const countedSources = counted.map((a) => sources.get(a.attempt_id)).filter((s): s is CountedSource => Boolean(s));

  if (def.type === 'mandatory_course') {
    const taken = countedSources[0];
    const catalogueEntry = catalogue.find((c) => c.normalized_code === def.course_id);
    return (
      <li data-requirement={id} className="req-course">
        <div className="req-course-row">
          <span className="mono">{def.course_id}</span>
          <span>{name}</span>
          <span className="num">{creditsText(def, result) || (catalogueEntry?.credits ? `${formatCredits(catalogueEntry.credits)} credits` : '')}</span>
          {result ? <StatusMark status={result.status} /> : null}
          {taken && taken.code !== def.course_id ? (
            <span className="muted">
              {' '}
              counted: {taken.code}
              {taken.grade ? ` (grade ${taken.grade})` : ''}
            </span>
          ) : taken?.grade ? (
            <span className="muted"> grade {taken.grade}</span>
          ) : null}
          {hold && hold.placeholders.length > 0 ? <span className="muted req-held"> · placeholder kept: {hold.placeholders.map((p) => `${formatCredits(p.desired_credits)} credits in ${formatTerm(p.term_id)}`).join(', ')}</span> : null}
        </div>
      </li>
    );
  }

  const children = def.children ?? [];
  const childResults = new Map((result?.children ?? []).map((r) => [r.id, r]));
  const progress = result ? progressText(def, result) : null;
  const courses = eligibleCourses(def, catalogue);
  const countedCodes = new Set(countedSources.map((s) => s.code));
  const hint = describe(def);

  return (
    <li data-requirement={id}>
      <div
        className="req-row"
        data-highlight={top && activeId === id ? 'true' : undefined}
        {...(top ? { onMouseEnter: () => onActive(id), onMouseLeave: () => onActive(null), onFocus: () => onActive(id), onBlur: () => onActive(null) } : {})}
      >
        <h3 className="req-title">
          <button type="button" className="req-toggle" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)}>
            <span className="req-chevron" aria-hidden="true">
              {open ? '▾' : '▸'}
            </span>
            <span className="req-name">{name}</span>
            <span className="req-meter" aria-hidden="true" data-done={result?.status === 'satisfied' ? 'true' : undefined}>
              {result && held ? <i className="held" style={{ width: `${meterPercent(def, result, held)}%` }} /> : null}
              {result ? <i style={{ width: `${meterPercent(def, result)}%` }} /> : null}
            </span>
            <span className="req-credits num">
              {progress ?? creditsText(def, result)}
              {held ? <span className="req-held">{` + ${heldText(held)}`}</span> : null}
            </span>
            {result ? <StatusMark status={result.status} /> : null}
          </button>
        </h3>
        {open ? (
          <div className="req-details" id={panelId}>
            {hint ? <p className="muted">{hint}</p> : null}
            {hold && hold.placeholders.length > 0 ? (
              <>
                <h4>Placeholder kept</h4>
                <ul>
                  {hold.placeholders.map((p) => (
                    <li key={p.id}>
                      {formatCredits(p.desired_credits)} {Number(p.desired_credits) === 1 ? 'credit' : 'credits'} in {formatTerm(p.term_id)}
                      {p.label ? `: ${p.label}` : ''}
                      {p.online ? ' (online)' : ''} — you still choose the course.
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {countedSources.length > 0 ? (
              <>
                <h4>Counted for you</h4>
                <ul>
                  {countedSources.map((s, i) => (
                    <li key={`${s.code}-${i}`}>
                      <span className="mono">{s.code}</span> {s.title ?? ''}
                      {s.kind === 'current' ? ' — in progress' : s.kind === 'planned' ? ' — planned' : s.grade ? ` — grade ${s.grade}` : ''}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {children.length > 0 ? (
              <ul className="req-list" aria-label={`Parts of ${name}`}>
                {children
                  .filter((c) => c.type !== 'noncredit')
                  .map((c) => (
                    <RequirementRow key={c.id} id={c.id} def={definitions.get(c.id) ?? c} result={childResults.get(c.id)} />
                  ))}
              </ul>
            ) : (
              <CourseList courses={courses} done={countedCodes} name={name} />
            )}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function describe(def: RequirementDefinition): string | null {
  if (def.any_course) return 'Any course that is not needed for another requirement.';
  const credits = def.minimum_credits ? `${formatCredits(def.minimum_credits)} credits` : '';
  switch (def.type) {
    case 'choose_courses':
      return `Choose ${def.minimum_courses ?? 'some'} courses${credits ? ` (${credits} in total)` : ''}.`;
    case 'minimum_credits':
      return credits ? `${credits} from the courses below.` : null;
    default:
      return null;
  }
}

interface ListedCourse {
  code: string;
  title?: string;
  credits?: string | null;
}

/** The courses that can fill a requirement: those the catalogue places in it, plus any the rules name outright. */
function eligibleCourses(def: RequirementDefinition, catalogue: CatalogueCourse[]): ListedCourse[] {
  if (def.any_course || (def.children?.length ?? 0) > 0) return [];
  const found = new Map<string, ListedCourse>();
  for (const c of catalogue) {
    if (c.baskets?.includes(def.id) || c.could_satisfy?.includes(def.id)) found.set(c.normalized_code, { code: c.normalized_code, title: c.title, credits: c.credits });
  }
  for (const code of def.course_ids ?? []) {
    if (!found.has(code)) {
      const known = catalogue.find((c) => c.normalized_code === code);
      found.set(code, { code, title: known?.title, credits: known?.credits });
    }
  }
  return [...found.values()].sort((a, b) => a.code.localeCompare(b.code));
}

function CourseList({ courses, done, name }: { courses: ListedCourse[]; done: Set<string>; name: string }) {
  const [all, setAll] = useState(false);
  if (courses.length === 0) return null;
  const visible = all ? courses : courses.slice(0, COURSE_LIST_LIMIT);
  return (
    <>
      <ul className="req-courses" aria-label={`Courses for ${name}`}>
        {visible.map((c) => (
          <li key={c.code}>
            <span className="mono">{c.code}</span> {c.title ?? ''}
            {c.credits ? <span className="muted"> · {formatCredits(c.credits)} credits</span> : null}
            {done.has(c.code) ? <span className="muted"> ✓ counted</span> : null}
          </li>
        ))}
      </ul>
      {courses.length > COURSE_LIST_LIMIT && !all ? (
        <button type="button" className="btn btn-small" onClick={() => setAll(true)}>
          Show all {courses.length} courses
        </button>
      ) : null}
    </>
  );
}
