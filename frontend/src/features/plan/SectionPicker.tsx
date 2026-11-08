import { useId, useState, type FormEvent } from 'react';
import type { CourseOffering, MeetingGroup, PlannedCourse } from '../../api/types';
import { Badge } from '../../components/StatusBadge';
import { describeMeeting, kindLabel, semantics } from './timetableFormat';

export interface SectionChoice {
  offering_id: string | null;
  section_ids: string[];
}

const NONE = '';

/**
 * A08 section picker for one planned course. It lists the snapshot's meeting
 * groups as the server stored them: `all_required` meetings are shown as
 * required, a `choose_one` group offers one radio per meeting, and a group
 * with unknown semantics or unresolved slots gets a clarification instead of
 * being treated as compulsory attendance at every listed slot. Saving only
 * records `offering_id`/`section_ids` on the plan item; the server decides
 * clashes on the next validation. A stored `offering_id` that is no longer in
 * the snapshot (OFFERING_VARIANT_UNKNOWN) is never preselected or sent back.
 */
export function SectionPicker({
  course,
  offerings,
  variantRequired,
  onSave,
  onCancel,
}: {
  course: PlannedCourse;
  offerings: CourseOffering[];
  /** The server reported OFFERING_SECTION_REQUIRED or OFFERING_VARIANT_UNKNOWN for this item. */
  variantRequired: boolean;
  onSave: (choice: SectionChoice) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const staleId = course.offering_id && !offerings.some((o) => o.id === course.offering_id) ? course.offering_id : null;
  const [variant, setVariant] = useState<string | null>(course.offering_id && !staleId ? course.offering_id : offerings.length === 1 ? offerings[0]!.id : null);
  const selected = new Set(course.section_ids ?? []);
  const [picks, setPicks] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const o of offerings) for (const g of o.meeting_groups) initial[g.id] = g.meetings.find((m) => selected.has(m.id))?.id ?? NONE;
    return initial;
  });
  const offering = offerings.find((o) => o.id === variant) ?? null;

  const staleNote = staleId ? (
    <p className="callout" data-tone="warning">
      Your saved choice for this course is no longer in the timetable.
      {offerings.length > 0 ? ' Choose again from the current timetable.' : ' Clear it to remove it from your plan.'}
    </p>
  ) : null;

  if (offerings.length === 0) {
    return (
      <div>
        {staleNote}
        <p>
          <span className="mono">{course.normalized_code}</span> is not in this semester's timetable, so there are no sections to choose.
        </p>
        <div className="panel-row">
          {staleId ? (
            <button type="button" className="btn btn-primary" onClick={() => onSave({ offering_id: null, section_ids: [] })}>
              Clear saved choice
            </button>
          ) : null}
          <button type="button" className="btn" onClick={onCancel}>
            {staleId ? 'Cancel' : 'Close'}
          </button>
        </div>
      </div>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const groups = offering?.meeting_groups ?? [];
    const section_ids = groups.filter((g) => semantics(g.selection_semantics) === 'choose_one').map((g) => picks[g.id] ?? NONE).filter((m) => m !== NONE);
    // A single offering stays unpinned (the server matches it by code) unless the course already pinned it.
    onSave({ offering_id: offerings.length > 1 ? variant : staleId ? null : (course.offering_id ?? null), section_ids });
  };

  return (
    <form onSubmit={submit} aria-label={`Sections for ${course.normalized_code}`}>
      <p className="muted">Choose the sections you attend. They are used to check for clashes; this is not a registration.</p>
      {staleNote}
      {offerings.length > 1 ? (
        <fieldset className="field">
          <legend>Which version of {course.normalized_code}</legend>
          {variantRequired && !staleId ? (
            <p className="callout" data-tone="warning">
              More than one version of this course is listed. Choose the one you will take.
            </p>
          ) : null}
          {offerings.map((o) => (
            <div key={o.id}>
              <input type="radio" id={`${id}-v-${o.id}`} name={`${id}-variant`} value={o.id} checked={variant === o.id} onChange={() => setVariant(o.id)} />{' '}
              <label htmlFor={`${id}-v-${o.id}`}>
                {o.raw_label ?? o.display_code ?? o.code}
                {o.title ? ` — ${o.title}` : ''}
                {o.section_labels?.length ? ` (sections ${o.section_labels.join(', ')})` : ''}
              </label>
            </div>
          ))}
        </fieldset>
      ) : null}
      {offering ? (
        offering.meeting_groups.length === 0 ? (
          <p className="callout" data-tone="warning">
            No meeting times are listed for this course.
          </p>
        ) : (
          offering.meeting_groups.map((g) => (
            <GroupBlock key={g.id} id={`${id}-${g.id}`} code={course.normalized_code} group={g} pick={picks[g.id] ?? NONE} onPick={(m) => setPicks((p) => ({ ...p, [g.id]: m }))} />
          ))
        )
      ) : offerings.length > 1 ? (
        <p className="muted">Choose a version to see its meetings.</p>
      ) : null}
      <div className="panel-row">
        <button type="submit" className="btn btn-primary" disabled={!offering}>
          Save section choice
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function GroupBlock({ id, code, group, pick, onPick }: { id: string; code: string; group: MeetingGroup; pick: string; onPick: (meetingId: string) => void }) {
  const kind = kindLabel(group.kind);
  const exam = group.kind === 'exam';
  const mode = semantics(group.selection_semantics);
  const unresolved = group.unresolved ?? [];
  const header = (
    <>
      <span className="mono">{kind}</span>{' '}
      {exam ? (
        <Badge tone="neutral">Not a weekly class</Badge>
      ) : mode === 'all_required' ? (
        <Badge tone="neutral">All listed meetings required</Badge>
      ) : mode === 'choose_one' ? (
        <Badge tone="neutral">Choose one</Badge>
      ) : null}
    </>
  );
  const sourceLine = group.section_labels?.length ? <p className="muted">{`Sections ${group.section_labels.join(', ')}`}</p> : null;
  const clarification =
    unresolved.length > 0 ? (
      <p className="callout" data-tone="warning">
        Some {kind} slots could not be read ({unresolved.join(', ')}), so clashes for this {kind} cannot be checked.
      </p>
    ) : null;
  const notes = group.notes?.length ? <p className="muted">Notes: {group.notes.join('; ')}</p> : null;

  if (mode === 'choose_one' && !exam) {
    return (
      <fieldset className="field" data-group={group.id}>
        <legend>
          Choose one {kind} meeting for {code} {header}
        </legend>
        {sourceLine}
        <p className="muted">
          Each student is assigned to exactly one {kind} slot. Choose yours once you know it; until then any option may clash.
        </p>
        {clarification}
        {notes}
        <div>
          <input type="radio" id={`${id}-none`} name={`${id}-pick`} value={NONE} checked={pick === NONE} onChange={() => onPick(NONE)} />{' '}
          <label htmlFor={`${id}-none`}>Not chosen yet (any option may clash)</label>
        </div>
        {group.meetings.map((m) => (
          <div key={m.id}>
            <input type="radio" id={`${id}-${m.id}`} name={`${id}-pick`} value={m.id} checked={pick === m.id} onChange={() => onPick(m.id)} />{' '}
            <label htmlFor={`${id}-${m.id}`}>
              {describeMeeting(m)}
            </label>
          </div>
        ))}
      </fieldset>
    );
  }
  return (
    <section className="field" aria-label={`${code} ${kind} meetings`} data-group={group.id}>
      <h4 style={{ margin: 0 }}>{header}</h4>
      {sourceLine}
      {exam ? (
        <p className="muted">Exam meetings are listed for reference; they are not weekly classes.</p>
      ) : mode === 'unknown' ? (
        <p className="muted">Check the official timetable for which of these {kind} slots apply to you.</p>
      ) : null}
      {clarification}
      {notes}
      {group.meetings.length === 0 ? null : (
        <ul>
          {group.meetings.map((m) => (
            <li key={m.id}>
              {exam ? <Badge tone="neutral">Exam</Badge> : mode === 'all_required' ? <Badge tone="neutral">Required</Badge> : null} {describeMeeting(m)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
