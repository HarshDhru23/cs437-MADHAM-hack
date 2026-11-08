import type { Issue } from '../../api/types';

/**
 * The server words some preparation messages for the team ("Recommended preparation (CoursePath team) ..."). A student reads them as plain advice
 * about earlier courses, with no mention of who recommends it or of any rule.
 */
export function studentIssue(issue: Issue): Issue {
  const message = issue.message
    .replace(/Recommended preparation \(CoursePath team\) missing:\s*/i, 'Recommended earlier course not completed or planned: ')
    .replace(/Recommended preparation \(CoursePath team\) is planned earlier; it helps only if passed\.?/i, 'A recommended earlier course is planned first; it only helps if you pass it.')
    .replace(/\s*\(CoursePath team\)/gi, '')
    .replace(/\bin the CoursePath team list\b/gi, '');
  return message === issue.message ? issue : { ...issue, message };
}

export function studentIssues(issues: Issue[]): Issue[] {
  return issues.map(studentIssue);
}
