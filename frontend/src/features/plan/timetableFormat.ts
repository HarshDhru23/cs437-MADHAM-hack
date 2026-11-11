/**
 * Presentation-only helpers for timetable data from the server (A08).
 * Weekday 0 is Monday (the backend's convention: B1 = weekday 1 = Tuesday).
 * Minutes are from midnight and intervals are end-exclusive. Nothing here
 * decides whether meetings clash; that comes from plan validation.
 */
import type { CourseOffering, OfferingMeeting, PerCourseValidation, PlannedCourse, SnapshotSourceRef, TermOfferingSnapshot } from '../../api/types';

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function weekdayName(weekday: number): string {
  return WEEKDAYS[weekday] ?? `Day ${weekday} (unrecognised)`;
}

export function clock(minute: number): string {
  if (!Number.isInteger(minute) || minute < 0 || minute > 1440) return 'unknown time';
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

export function timeRange(start: number, end: number): string {
  return `${clock(start)}–${clock(end)}`;
}

export function kindLabel(kind: string | null | undefined): string {
  if (!kind) return 'meeting';
  return kind;
}

export function refLocators(refs: SnapshotSourceRef[] | undefined): string[] {
  return [...new Set((refs ?? []).map((r) => r.locator ?? r.id).filter((x): x is string => Boolean(x)))];
}

/** "Tuesday 08:30–09:50 · slot B1 · room LH 1" */
export function describeMeeting(m: OfferingMeeting): string {
  const parts = [`${weekdayName(m.weekday)} ${timeRange(m.start_minute, m.end_minute)}`];
  if (m.original_slot) parts.push(`slot ${m.original_slot}`);
  if (roomText(m)) parts.push(roomText(m));
  if (m.delivery_note) parts.push(m.delivery_note);
  return parts.join(' · ');
}

export function roomText(m: OfferingMeeting): string {
  if (m.room) return `room ${m.room}`;
  if (m.room_options?.length) return `room one of ${m.room_options.join(', ')}`;
  return '';
}

export type Semantics = 'all_required' | 'choose_one' | 'unknown';

export function semantics(value: string | null | undefined): Semantics {
  return value === 'all_required' || value === 'choose_one' ? value : 'unknown';
}

/**
 * Offerings the server matched for a planned course. Uses the validation's
 * `offering_ids` when present; otherwise the snapshot entries with the same
 * code (display only, for the picker before the first validation arrives).
 */
export function offeringsFor(course: PlannedCourse, snapshot: TermOfferingSnapshot | null, row: PerCourseValidation | undefined): CourseOffering[] {
  if (!snapshot) return [];
  if (row?.offering_ids) return row.offering_ids.map((id) => snapshot.offerings.find((o) => o.id === id)).filter((o): o is CourseOffering => Boolean(o));
  return snapshot.offerings.filter((o) => o.code === course.normalized_code);
}

/** The offering whose meetings apply: the chosen variant, or the only one. */
export function chosenOffering(course: PlannedCourse, offerings: CourseOffering[]): CourseOffering | null {
  if (course.offering_id) return offerings.find((o) => o.id === course.offering_id) ?? null;
  return offerings.length === 1 ? offerings[0]! : null;
}

/**
 * The course plan for a planned course: the link the official timetable gives for the chosen version (or, with no version chosen, the
 * first version that has one). Only an ordinary web address is offered; anything else (a `javascript:` or `data:` address, text that is
 * not an address) counts as no link, so the student is never sent somewhere unexpected.
 */
export function coursePlanUrl(course: PlannedCourse, offerings: CourseOffering[]): string | null {
  // A version chosen for another semester names no version of this one (D-51: the plan check ignores it), so it does not narrow the choice.
  const picked = course.offering_id ? offerings.filter((o) => o.id === course.offering_id) : [];
  for (const o of picked.length ? picked : offerings) {
    const target = o.course_plan_link?.target;
    if (!target) continue;
    try {
      const url = new URL(target);
      if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
    } catch {
      // not an address: treated as no link
    }
  }
  return null;
}
