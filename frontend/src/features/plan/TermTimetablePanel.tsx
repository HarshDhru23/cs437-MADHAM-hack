import { useState } from 'react';
import { useTermOfferings } from '../../api/hooks';
import type { Issue, MeetingConflict, OfferingMeeting, PlannedSemester, PlanValidation, TermOfferingSnapshot } from '../../api/types';
import { Dialog } from '../../components/Dialog';
import { SeverityBadge } from '../../components/StatusBadge';
import { formatTerm } from '../../lib/format';
import { SectionPicker, type SectionChoice } from './SectionPicker';
import { chosenOffering, describeMeeting, kindLabel, offeringsFor, semantics, timeRange, weekdayName } from './timetableFormat';
import { WeeklyDetail, type WeeklyEntry } from './WeeklyDetail';
import './plan.css';

export { useTermOfferings };

/** The server asks for a variant: several exist, or the saved one is no longer listed. */
const VARIANT_CODES = new Set(['OFFERING_SECTION_REQUIRED', 'OFFERING_VARIANT_UNKNOWN']);

function meetingIndex(snapshot: TermOfferingSnapshot | null): Map<string, { code: string; meeting: OfferingMeeting }> {
  const index = new Map<string, { code: string; meeting: OfferingMeeting }>();
  for (const o of snapshot?.offerings ?? []) for (const g of o.meeting_groups) for (const m of g.meetings) index.set(m.id, { code: o.display_code ?? o.code, meeting: { kind: g.kind, ...m } });
  return index;
}

/**
 * Per-semester timetable panel: the clashes the server found, courses that are not offered, the section choices and a weekly view.
 * Only things the student can act on are shown; a semester with nothing to say shows only its sections.
 */
export function TermTimetablePanel({
  semester,
  validation,
  issues,
  onChooseSections,
}: {
  semester: PlannedSemester;
  /** Null while loading or while the plan has unsaved edits. */
  validation: PlanValidation | null;
  issues: Issue[];
  stale?: boolean;
  onChooseSections: (itemId: string, choice: SectionChoice) => void;
}) {
  const term = semester.term_id;
  const label = formatTerm(term);
  const offerings = useTermOfferings(term);
  const snapshot = offerings.data && offerings.data.id ? offerings.data : null;
  const [picking, setPicking] = useState<string | null>(null);
  const perCourse = new Map((validation?.per_course ?? []).filter((p) => p.term_id === term).map((p) => [p.id, p]));
  const check = validation?.meeting_checks?.[term];
  const conflicts = validation ? (check?.conflicts ?? []) : [];
  const conflictMeetings = new Set(conflicts.flatMap((c) => c.meeting_ids));
  const meetings = meetingIndex(snapshot);
  const codeOf = (itemId: string) => semester.courses.find((c) => c.id === itemId)?.normalized_code ?? itemId;
  const needsVariant = (itemId: string) => issues.some((i) => VARIANT_CODES.has(i.code) && i.entity_refs.includes(itemId));
  const notOffered = semester.courses.filter((c) => perCourse.get(c.id)?.offering_status === 'not_offered');

  const entries: WeeklyEntry[] = [];
  for (const c of semester.courses) {
    const offering = chosenOffering(c, offeringsFor(c, snapshot, perCourse.get(c.id)));
    if (!offering) continue;
    const chosen = new Set(c.section_ids ?? []);
    // Exam groups are not weekly meetings; the server's clash check skips them too.
    for (const g of offering.meeting_groups.filter((x) => x.kind !== 'exam')) {
      const mode = semantics(g.selection_semantics);
      const pick = mode === 'choose_one' ? g.meetings.find((m) => chosen.has(m.id)) : undefined;
      for (const m of pick ? [pick] : g.meetings)
        entries.push({
          code: c.normalized_code,
          meeting: { kind: g.kind, ...m },
          role: mode === 'all_required' ? 'required' : pick ? 'chosen' : mode === 'choose_one' ? 'option' : 'unclear',
          inServerConflict: conflictMeetings.has(m.id),
        });
    }
  }

  const rows = semester.courses
    .map((c) => {
      const matched = offeringsFor(c, snapshot, validation ? perCourse.get(c.id) : undefined);
      const offering = chosenOffering(c, matched);
      const staleVariant = Boolean(c.offering_id) && !offering && !matched.some((o) => o.id === c.offering_id);
      return { c, matched, offering, staleVariant };
    })
    .filter((r) => r.matched.length > 0 || r.staleVariant);
  const pickingCourse = semester.courses.find((c) => c.id === picking) ?? null;

  if (semester.courses.length === 0) return null;
  if (offerings.error)
    return (
      <section className="panel timetable-panel pb-timetable" aria-label={`Timetable for ${label}`}>
        <p role="alert" data-severity="warning">
          The timetable for {label} could not be loaded, so clashes could not be checked.{' '}
          <button type="button" className="btn btn-small" onClick={offerings.reload}>
            Try again
          </button>
        </p>
      </section>
    );
  if (conflicts.length === 0 && notOffered.length === 0 && rows.length === 0 && entries.length === 0) return null;

  return (
    <section className="panel timetable-panel pb-timetable" aria-label={`Timetable for ${label}`}>
      <h3>Timetable</h3>

      {notOffered.map((c) => (
        <p key={c.id} data-severity="warning">
          <SeverityBadge severity="warning" /> <span className="mono">{c.normalized_code}</span> is not offered this semester.
        </p>
      ))}

      {conflicts.length > 0 ? (
        <div>
          <h4>Clashes ({conflicts.length})</h4>
          <ul className="issue-list">
            {conflicts.map((c, n) => (
              <ConflictItem key={`${c.id}-${n}`} conflict={c} codeOf={codeOf} meetings={meetings} />
            ))}
          </ul>
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div className="table-wrap">
          <table className="data stack-mobile">
            <caption>Your sections in {label}</caption>
            <thead>
              <tr>
                <th scope="col">Course</th>
                <th scope="col">Your sections</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ c, matched, offering, staleVariant }) => {
                const chosenText = (c.section_ids ?? []).map((id) => (meetings.get(id) ? `${kindLabel(meetings.get(id)!.meeting.kind)} ${describeMeeting(meetings.get(id)!.meeting)}` : 'A saved section that is no longer listed'));
                return (
                  <tr key={c.id}>
                    <th scope="row" data-label="Course">
                      <span className="mono">{c.normalized_code}</span>
                    </th>
                    <td data-label="Your sections">
                      {staleVariant ? (
                        <div>Your saved choice is no longer listed</div>
                      ) : matched.length > 1 ? (
                        <div>{offering ? `Version: ${offering.raw_label ?? offering.display_code ?? offering.id}` : 'Version not chosen'}</div>
                      ) : null}
                      {chosenText.length ? chosenText.map((t) => <div key={t}>{t}</div>) : <span className="muted">None chosen</span>}
                    </td>
                    <td data-label="Actions">
                      <button type="button" className="btn btn-small" aria-label={`Choose sections for ${c.normalized_code}`} onClick={() => setPicking(c.id)}>
                        {matched.length === 0 ? 'Clear saved choice' : needsVariant(c.id) || staleVariant ? 'Choose version and sections' : 'Choose sections'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {entries.length > 0 ? (
        <details>
          <summary>Weekly timetable for {label}</summary>
          <WeeklyDetail label={label} entries={entries} />
        </details>
      ) : null}

      {pickingCourse ? (
        <Dialog open title={`Sections for ${pickingCourse.normalized_code} in ${label}`} onClose={() => setPicking(null)} variant="drawer">
          <SectionPicker
            course={pickingCourse}
            offerings={offeringsFor(pickingCourse, snapshot, validation ? perCourse.get(pickingCourse.id) : undefined)}
            variantRequired={needsVariant(pickingCourse.id)}
            onCancel={() => setPicking(null)}
            onSave={(choice) => {
              onChooseSections(pickingCourse.id, choice);
              setPicking(null);
            }}
          />
        </Dialog>
      ) : null}
    </section>
  );
}

function ConflictItem({ conflict, codeOf, meetings }: { conflict: MeetingConflict; codeOf: (id: string) => string; meetings: Map<string, { code: string; meeting: OfferingMeeting }> }) {
  const [a, b] = conflict.item_ids;
  const kinds = conflict.kinds.map((k) => kindLabel(k));
  return (
    <li data-severity={conflict.certain ? 'error' : 'warning'}>
      <div className="issue-head">
        <SeverityBadge severity={conflict.certain ? 'error' : 'warning'} />
        <strong>{conflict.certain ? 'Clash' : 'Possible clash'}</strong>
      </div>
      <p>
        <span className="mono">{a ? codeOf(a) : '?'}</span> {kinds[0]} and <span className="mono">{b ? codeOf(b) : '?'}</span> {kinds[1]} overlap on {weekdayName(conflict.weekday)}{' '}
        {timeRange(conflict.start_minute, conflict.end_minute)}.
      </p>
      <ul>
        {conflict.meeting_ids.map((id, n) => {
          const found = meetings.get(id);
          const item = conflict.item_ids[n];
          return (
            <li key={`${id}-${n}`}>
              {item ? <span className="mono">{codeOf(item)}</span> : null} {kinds[n] ?? ''}: {found ? describeMeeting(found.meeting) : null}
            </li>
          );
        })}
      </ul>
    </li>
  );
}
