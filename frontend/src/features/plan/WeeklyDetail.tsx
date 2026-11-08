import type { OfferingMeeting } from '../../api/types';
import { kindLabel, roomText, timeRange, weekdayName } from './timetableFormat';
import './plan.css';

export interface WeeklyEntry {
  code: string;
  meeting: OfferingMeeting;
  /** How the meeting applies to the student, from the group's stated semantics and their choice. */
  role: 'required' | 'chosen' | 'option' | 'unclear';
  /** The server listed this meeting in a clash for the term. */
  inServerConflict: boolean;
}

const ROLE: Record<WeeklyEntry['role'], string> = {
  required: '',
  chosen: 'your choice',
  option: 'one option, not chosen yet',
  unclear: '',
};

function entryText(e: WeeklyEntry): string {
  const slot = e.meeting.original_slot ? `, slot ${e.meeting.original_slot}` : '';
  const notes = [ROLE[e.role], roomText(e.meeting)].filter(Boolean).join('; ');
  return `${e.code} ${kindLabel(e.meeting.kind ?? null)}${slot}${notes ? ` (${notes})` : ''}${e.inServerConflict ? ' — clash' : ''}`;
}

/**
 * A08 weekly detail: a weekday-by-time grid of the planned courses' meetings,
 * with the same content as a text list. It supplements the conflict list; it
 * does not decide clashes (cells only mark meetings the server reported).
 */
export function WeeklyDetail({ label, entries }: { label: string; entries: WeeklyEntry[] }) {
  if (entries.length === 0) return null;
  const days = [...new Set(entries.map((e) => e.meeting.weekday))].sort((a, b) => a - b);
  const slots = [...new Map(entries.map((e) => [`${e.meeting.start_minute}-${e.meeting.end_minute}`, e.meeting])).values()].sort(
    (a, b) => a.start_minute - b.start_minute || a.end_minute - b.end_minute,
  );
  const at = (day: number, m: OfferingMeeting) => entries.filter((e) => e.meeting.weekday === day && e.meeting.start_minute === m.start_minute && e.meeting.end_minute === m.end_minute);
  return (
    <div>
      <div className="pb-week-wrap">
        <table className="pb-week">
          <caption>Weekly meetings for {label} (grid)</caption>
          <thead>
            <tr>
              <th scope="col">Time</th>
              {days.map((d) => (
                <th key={d} scope="col">
                  {weekdayName(d)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slots.map((s) => (
              <tr key={`${s.start_minute}-${s.end_minute}`}>
                <th scope="row" className="num">
                  {timeRange(s.start_minute, s.end_minute)}
                </th>
                {days.map((d) => (
                  <td key={d}>
                    {at(d, s).map((e, i) => (
                      <div key={`${e.meeting.id}-${i}`} data-conflict={e.inServerConflict ? 'true' : undefined}>
                        {e.inServerConflict ? <span aria-hidden="true">✕ </span> : null}
                        {entryText(e)}
                      </div>
                    ))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="pb-legend" aria-hidden="true">
        <span className="pb-legend-item">
          <i className="pb-swatch pb-swatch-meeting" />
          Meeting
        </span>
        <span className="pb-legend-item">
          <i className="pb-swatch pb-swatch-overlap" />
          Meetings that overlap
        </span>
      </p>
      <h4>As a list</h4>
      <ul aria-label={`Weekly meetings for ${label} (list)`}>
        {days.map((d) => (
          <li key={d}>
            <strong>{weekdayName(d)}:</strong>{' '}
            {entries
              .filter((e) => e.meeting.weekday === d)
              .sort((a, b) => a.meeting.start_minute - b.meeting.start_minute)
              .map((e) => `${timeRange(e.meeting.start_minute, e.meeting.end_minute)} ${entryText(e)}`)
              .join('; ')}
          </li>
        ))}
      </ul>
    </div>
  );
}
