import type { ReactNode } from 'react';
import { useTermOfferings } from '../../api/hooks';
import type { PerCourseValidation, PlannedCourse } from '../../api/types';
import { coursePlanUrl, offeringsFor } from './timetableFormat';

/**
 * CP-43: the course plan of a planned course, from the semester's official timetable. Returns a function that gives a course its link, or
 * "Course plan not available yet" when the timetable has none for it. The timetable is fetched once for the semester, not once per course.
 * While it loads, or if it cannot be loaded, nothing is said (the timetable panel reports a failed load), so a course is never reported as
 * missing its course plan just because the timetable has not arrived.
 */
export function useCoursePlans(term: string, perCourse?: PerCourseValidation[]): (course: PlannedCourse) => ReactNode {
  const offerings = useTermOfferings(term);
  const snapshot = offerings.data && offerings.data.id ? offerings.data : null;
  return (course) => {
    if (!offerings.data) return null;
    const url = coursePlanUrl(course, offeringsFor(course, snapshot, perCourse?.find((p) => p.id === course.id)));
    return url ? (
      <a href={url} target="_blank" rel="noopener noreferrer">
        Course plan<span className="visually-hidden"> for {course.normalized_code} (opens in a new tab)</span>
      </a>
    ) : (
      <span className="muted">Course plan not available yet</span>
    );
  };
}

/** For a table drawn inside a loop, where a hook cannot be called: gives its children the semester's course plan function. */
export function TermCoursePlans({ term, children }: { term: string; children: (coursePlan: (course: PlannedCourse) => ReactNode) => ReactNode }) {
  return <>{children(useCoursePlans(term))}</>;
}
