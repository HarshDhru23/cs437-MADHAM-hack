import type { PlanCheck, PlanCheckRequirement } from '../../api/types';
import { formatCredits } from '../../lib/format';
import { plainIssues } from './plainIssues';

const needs = (r: PlanCheckRequirement) => Number(r.uncovered_credits) > 0;

/** "1 credit", "12 credits": words only, the number is the server's. */
export function creditsWord(value: string): string {
  const text = formatCredits(value);
  return text === '1' ? '1 credit' : `${text} credits`;
}

/** "1 more credit", "12 more credits". */
export function moreCredits(value: string): string {
  const text = formatCredits(value);
  return text === '1' ? '1 more credit' : `${text} more credits`;
}

/** The requirements that still need credits, grouped by their top-level group, in the server's order. */
function groupsStillNeeded(requirements: PlanCheckRequirement[]): { group: string; rows: PlanCheckRequirement[] }[] {
  const groups: { group: string; rows: PlanCheckRequirement[] }[] = [];
  for (const row of requirements.filter(needs)) {
    const found = groups.find((g) => g.group === row.group);
    if (found) found.rows.push(row);
    else groups.push({ group: row.group, rows: [row] });
  }
  return groups;
}

/**
 * What is left of the degree after the plan as it stands: the credits left for graduation, how many are counted, and the
 * requirements that still need credits ("Open electives: 12 more credits needed"). Every number comes from the server check.
 * While a newer check is pending the last numbers stay on screen, marked as updating.
 */
export function PlanProgress({ check, pending, showOnlineWarnings = false, plannedTotal }: { check: PlanCheck | null; pending: boolean; showOnlineWarnings?: boolean; plannedTotal?: string }) {
  const open = check ? groupsStillNeeded(check.requirements) : [];
  // The server says in plain words when online credits would not all count; a page that does not place that sentence beside a semester shows it here.
  const onlineWarnings = check && showOnlineWarnings ? plainIssues(check.validation.issues.filter((i) => /^ONLINE/.test(i.code)), () => undefined) : [];
  const online = check?.online && Number(check.online.planned_credits) > 0 ? check.online : null;
  const allCovered = check ? Number(check.uncovered_credits) <= 0 : false;
  const coveredRows = check ? check.requirements.filter((r) => !needs(r)).length : 0;
  return (
    <section className="pb-progress" aria-label="Your plan so far" aria-busy={pending} data-updating={pending && check ? 'true' : undefined}>
      <h3>Your plan so far</h3>
      {!check ? (
        pending ? (
          <p aria-live="polite" className="muted">
            Checking your plan…
          </p>
        ) : null
      ) : (
        <div>
          {allCovered ? (
            <p className="pb-lead" data-state="done">
              <strong>Every requirement is covered.</strong> No credits left for graduation.
            </p>
          ) : (
            <p className="num pb-lead">
              <strong>{`${creditsWord(check.uncovered_credits)} left for graduation`}</strong>
            </p>
          )}
          {plannedTotal !== undefined ? (
            <p className="num pb-total">
              <strong>{creditsWord(plannedTotal)}</strong> in the plan
            </p>
          ) : null}
          <p className="num">{`${formatCredits(check.degree_surplus?.earned_credits ?? check.degree.counted_credits)} of ${formatCredits(check.degree.total_credits)} degree credits covered by your plan`}</p>
          {check.degree_surplus && Number(check.degree_surplus.surplus_credits) > 0 ? <p className="num muted">{`${creditsWord(check.degree_surplus.surplus_credits)} more than the degree asks for: they are earned but fill no requirement.`}</p> : null}
          {Number(check.placeholder_credits) > 0 ? <p className="num">{`${creditsWord(check.placeholder_credits)} held in placeholders that you fill with courses`}</p> : null}
          {online ? <p className="num">{`Online credits: ${formatCredits(online.planned_credits)} planned, ${formatCredits(online.counted_credits)} count toward your degree`}</p> : null}
          {onlineWarnings.map((w) => (
            <p key={w.key} className="field-error" role="status">
              {w.message}
            </p>
          ))}
          {open.length > 0 ? (
            <ul className="progress-list" aria-label="Credits still needed">
              {open.map(({ group, rows }) =>
                rows.length === 1 && rows[0]!.label === group ? (
                  <li key={group}>{`${group}: ${moreCredits(rows[0]!.uncovered_credits)} needed`}</li>
                ) : (
                  <li key={group}>
                    <strong>{group}</strong>
                    <ul>
                      {rows.map((r) => (
                        <li key={r.id}>{`${r.label}: ${moreCredits(r.uncovered_credits)} needed`}</li>
                      ))}
                    </ul>
                  </li>
                ),
              )}
            </ul>
          ) : null}
          {open.length > 0 && coveredRows > 0 ? <p className="muted">Everything else is covered.</p> : null}
        </div>
      )}
      {pending && check ? (
        <p className="muted" aria-live="polite">
          Updating…
        </p>
      ) : null}
    </section>
  );
}
