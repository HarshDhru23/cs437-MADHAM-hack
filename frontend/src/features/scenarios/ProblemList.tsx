import type { Issue } from '../../api/types';
import type { PlanItem } from './model';
import { problems, problemText } from './scenarioIssues';

/** The distinct problems of a scenario, each once, in plain words (see scenarioIssues.ts). */
export function ProblemList({ issues, items, empty = 'Nothing to check.' }: { issues: Issue[] | undefined; items: PlanItem[]; empty?: string }) {
  const found = problems(issues, items);
  if (found.length === 0) return <p className="muted">{empty}</p>;
  return (
    <ul className="plain-list">
      {found.map((p) => (
        <li key={p.message}>{problemText(p)}</li>
      ))}
    </ul>
  );
}

/** How many distinct problems `ProblemList` would show. */
export const problemCount = (issues: Issue[] | undefined, items: PlanItem[]) => problems(issues, items).length;
