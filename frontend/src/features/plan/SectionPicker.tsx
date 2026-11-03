import { useId, useState, type FormEvent } from 'react';
import type { CourseOffering, MeetingGroup, PlannedCourse } from '../../api/types';
import { Badge } from '../../components/StatusBadge';
import { describeMeeting, kindLabel, refLocators, semantics } from './timetableFormat';

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
      Your saved variant <span className="mono">{staleId}</span> is not in the current timetable snapshot, so this course's clashes cannot be checked.
      {offerings.length > 0 ? ' Choose a variant from the current snapshot.' : ' Clear the saved choice to remove it from your plan.'}
    </p>
  ) : null;

  if (offerings.length === 0) {
    return (
      <div>
        {staleNote}
        <p>
          <span className="mono">{course.normalized_code}</span> is not in this term's timetable snapshot, so there are no meetings or sections to choose. Its
          availability is unknown unless the server says the snapshot is complete and reviewed.
        </p>
        <div className="panel-row">
          {staleId ? (
            <button type="button" className="btn btn-primary" onClick={() => onSave({ offering_id: null, section_ids: [] })}>
              Clear saved variant
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
      <p className="muted">
        Meetings come from the term's timetable snapshot. Choosing a section records your intention in the plan; it is not a registration. The server checks clashes
        after the plan is saved.
      </p>
      {staleNote}
      {offerings.length > 1 ? (
        <fieldset className="field">
          <legend>Source variant for {course.normalized_code}</legend>
          {variantRequired && !staleId ? (
            <p className="callout" data-tone="warning">
              The timetable lists more than one variant of this course. Choose the one you will take before clashes can be checked.
            </p>
          ) : null}
          {offerings.map((o) => (
            <div key={o.id}>
              <input type="radio" id={`${id}-v-${o.id}`} name={`${id}-variant`} value={o.id} checked={variant === o.id} onChange={() => setVariant(o.id)} />{' '}
              <label htmlFor={`${id}-v-${o.id}`}>
                {o.raw_label ?? o.display_code ?? o.code}
                {o.title ? ` — ${o.title}` : ''}
                {o.section_labels?.length ? ` (sections ${o.section_labels.join(', ')})` : ''}
                {refLocators(o.source_refs).length ? <span className="muted"> · source {refLocators(o.source_refs).join(', ')}</span> : null}
              </label>
            </div>
          ))}
        </fieldset>
      ) : null}
      {offering ? (
        offering.meeting_groups.length === 0 ? (
          <p className="callout" data-tone="warning">
            The snapshot lists no meetings for this course, so clashes cannot be checked.
          </p>
        ) : (
          offering.meeting_groups.map((g) => (
            <GroupBlock key={g.id} id={`${id}-${g.id}`} code={course.normalized_code} group={g} pick={picks[g.id] ?? NONE} onPick={(m) => setPicks((p) => ({ ...p, [g.id]: m }))} />
          ))
        )
      ) : offerings.length > 1 ? (
        <p className="muted">Choose a variant to see its meetings.</p>
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
  const cells = refLocators(group.source_refs);
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
      ) : (
        <Badge tone="unknown" symbol="?">
          Grouping not stated
        </Badge>
      )}
    </>
  );
  const sourceLine = (
    <p className="muted">
      Source text: {group.raw_text ? <span className="mono">{group.raw_text}</span> : 'not given'}
      {cells.length ? ` · cells ${cells.join(', ')}` : ''}
      {group.section_labels?.length ? ` · sections ${group.section_labels.join(', ')}` : ''}
    </p>
  );
  const clarification =
    unresolved.length > 0 ? (
      <p className="callout" data-tone="warning">
        Some slots in the source could not be read ({unresolved.join(', ')}). CoursePath cannot check clashes for this {kind} until the timetable owner clarifies them.
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
              {refLocators(m.source_refs).length ? <span className="muted"> · source {refLocators(m.source_refs).join(', ')}</span> : null}
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
        <p className="muted">Exam meetings are listed for reference. They are not weekly classes, so the clash check does not include them.</p>
      ) : mode === 'unknown' ? (
        <p className="callout" data-tone="warning">
          The timetable does not say whether you attend every listed {kind} slot or only one of them. CoursePath does not assume all of them are compulsory, and you cannot
          pick one until this is clarified. Ask the course office or timetable owner; until then, clashes involving these meetings are only possible clashes.
        </p>
      ) : null}
      {clarification}
      {notes}
      {group.meetings.length === 0 ? (
        <p className="muted">No meetings could be read for this group.</p>
      ) : (
        <ul>
          {group.meetings.map((m) => (
            <li key={m.id}>
              {exam ? <Badge tone="neutral">Exam</Badge> : mode === 'all_required' ? <Badge tone="neutral">Required</Badge> : <Badge tone="unknown">Listed; meaning not stated</Badge>}{' '}
              {describeMeeting(m)}
              {refLocators(m.source_refs).length ? <span className="muted"> · source {refLocators(m.source_refs).join(', ')}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
