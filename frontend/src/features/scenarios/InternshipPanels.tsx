import { useId } from 'react';
import type { InternshipEvaluation, Issue } from '../../api/types';
import { IssueList } from '../../components/IssueList';
import { Badge } from '../../components/StatusBadge';
import { formatCredits, formatTerm } from '../../lib/format';
import { durationLabel, exclusiveToInclusive, formatDate, itemCode, moduleStateLabel, orUnavailable, PLACEMENT_LABEL, targetLabel, type PlanItem } from './model';

const CONFLICT_CODES = /^(INTERNSHIP_ATTENDANCE|INTERNSHIP_DOWNSTREAM|INTERNSHIP_DATES|INTERNSHIP_DURATION|CALENDAR_MISSING)/;

interface PanelsProps {
  evaluation: InternshipEvaluation | null;
  assumptions?: string[];
  items: PlanItem[];
  /** True while the shown evaluation is for an older saved revision or a request is in flight. */
  stale: boolean;
}

function codes(items: PlanItem[], ids: string[]): string {
  return ids.length ? ids.map((id) => itemCode(items, id)).join(', ') : 'None';
}

/** Server results for one scenario's internship, split into time away and academic credit. */
export function InternshipPanels({ evaluation, assumptions = [], items, stale }: PanelsProps) {
  const timeId = useId();
  const creditId = useId();
  if (!evaluation) return null;
  const issues = evaluation.issues ?? [];
  const conflictIssues = issues.filter((i) => CONFLICT_CODES.test(i.code));
  const creditIssues = issues.filter((i) => !CONFLICT_CODES.test(i.code));
  const calendarMissing = issues.some((i) => i.code === 'CALENDAR_MISSING');
  const isNone = evaluation.duration_choice === 'none';
  const differs = evaluation.expected_end_date_exclusive !== null && evaluation.end_date_exclusive !== null && evaluation.expected_end_date_exclusive !== evaluation.end_date_exclusive;
  const credits = evaluation.credits;
  const byTarget = (map: Record<string, string> | undefined) =>
    map && Object.keys(map).length ? Object.entries(map).map(([k, v]) => `${targetLabel(k)}: ${formatCredits(v)}`).join('; ') : 'none';

  return (
    <div className="grid-2" aria-busy={stale || undefined}>
      <section className="panel" aria-labelledby={timeId} data-stale={stale || undefined}>
        <h2 id={timeId}>Time away / course conflicts</h2>
        {isNone ? (
          <p>No internship: no time away and no course conflicts from an internship in this scenario.</p>
        ) : (
          <>
            <dl className="facts">
              <div>
                <dt>Duration chosen</dt>
                <dd>{durationLabel(evaluation.duration_choice)}</dd>
              </div>
              <div>
                <dt>Dates</dt>
                <dd>
                  {evaluation.start_date && evaluation.end_date_exclusive
                    ? `${formatDate(evaluation.start_date)} to ${formatDate(exclusiveToInclusive(evaluation.end_date_exclusive))} (last day)`
                    : 'Unavailable — exact dates are needed'}
                </dd>
              </div>
              <div>
                <dt>Actual duration (server)</dt>
                <dd>{orUnavailable(evaluation.actual_days, (v) => `${v} days`)}</dd>
              </div>
              <div>
                <dt>Placement</dt>
                <dd>{PLACEMENT_LABEL[evaluation.placement_mode] ?? evaluation.placement_mode}</dd>
              </div>
            </dl>
            {differs ? (
              <p className="callout" data-tone="warning">
                These dates do not match {durationLabel(evaluation.duration_choice)}: counted in calendar months from the start, that duration would end on{' '}
                {formatDate(exclusiveToInclusive(evaluation.expected_end_date_exclusive))} (last day). The server uses your actual dates; the label is not a credit
                formula.
              </p>
            ) : null}
            <h3>Overlapping terms</h3>
            {evaluation.overlapping_terms.length > 0 ? (
              <ul>
                {evaluation.overlapping_terms.map((t) => (
                  <li key={t.term_id}>
                    {formatTerm(t.term_id)}: {orUnavailable(t.overlap_days, (v) => `${v} days`)} away
                    {t.exam_overlap ? ', including exams' : ''}; courses: {codes(items, t.course_ids)}
                  </li>
                ))}
              </ul>
            ) : calendarMissing ? (
              <p>Unavailable: no academic calendar is loaded (GAP-03), so overlapping terms were not checked. This is not the same as “no overlap”.</p>
            ) : (
              <p>No overlapping term was found in the calendar.</p>
            )}
            <dl className="facts">
              <div>
                <dt>Affected planned courses</dt>
                <dd>{codes(items, evaluation.affected_courses)}</dd>
              </div>
              <div>
                <dt>Later courses that rely on them</dt>
                <dd>{codes(items, evaluation.downstream_courses)}</dd>
              </div>
              <div>
                <dt>Not checked</dt>
                <dd>{codes(items, evaluation.unchecked_courses)}</dd>
              </div>
            </dl>
            <p className="muted">Nothing is moved automatically. Edit the plan or the scenario and compare again.</p>
          </>
        )}
        <IssueList issues={conflictIssues} headingLevel={4} emptyMessage="The server reported no time-away issues." />
      </section>

      <section className="panel" aria-labelledby={creditId} data-stale={stale || undefined}>
        <h2 id={creditId}>Proposed academic credit</h2>
        <p>
          <strong>Choosing a duration awards no credit.</strong> Only IN 498 modules can carry credit, and only after institute approval (D-14).
        </p>
        <div role="group" aria-label="Exposure credits">
        <dl className="facts">
          <div>
            <dt>Proposed (pending approval)</dt>
            <dd>{orUnavailable(credits?.proposed, formatCredits)}</dd>
          </div>
          <div>
            <dt>Approved (not yet earned)</dt>
            <dd>{orUnavailable(credits?.approved, formatCredits)}</dd>
          </div>
          <div>
            <dt>Earned</dt>
            <dd>{orUnavailable(credits?.earned, formatCredits)}</dd>
          </div>
        </dl>
        </div>
        <p className="muted">Proposed by basket: {byTarget(credits?.proposed_by_target)}.</p>
        <p className="muted">Policy caps (D-14): 4-credit modules, at most 16 exposure credits in total, HSS at most 8 and the open project at most 4. The server checks them.</p>
        {evaluation.modules.length > 0 ? (
          <ul aria-label="Module approval states">
            {evaluation.modules.map((m, index) => {
              const state = moduleStateLabel(m.status);
              return (
                <li key={m.id ?? index}>
                  {`IN 498 module ${index + 1}`} → {targetLabel(m.intended_allocation)}:{' '}
                  <Badge tone={state.tone} symbol={state.symbol}>
                    {state.label}
                  </Badge>
                  {m.reasons.length ? <span className="issue-code"> {m.reasons.join(', ')}</span> : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted">No IN 498 modules: this internship earns no academic credit.</p>
        )}
        {assumptions.length > 0 ? (
          <>
            <h3>Completion assumptions (server)</h3>
            <ul>
              {assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </>
        ) : null}
        <h3>Unresolved evidence</h3>
        <IssueList issues={creditIssues as Issue[]} headingLevel={4} emptyMessage="The server reported no unresolved credit evidence." />
      </section>
    </div>
  );
}
