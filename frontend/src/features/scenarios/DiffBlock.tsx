import type { Scenario, ScenarioComparison } from '../../api/types';
import { diffLines } from './diff';
import type { PlanItem } from './model';

/**
 * What the scenario changes, one line each, in the style of a diff: monospace, `-` lines in red, `+` lines in mint, the header in violet.
 * Only values the comparison already carries appear; with none, it says so plainly. The block scrolls sideways by itself on a phone.
 */
export function DiffBlock({ comparison, scenario, label, items }: { comparison: ScenarioComparison; scenario: Scenario | undefined; label: string; items: PlanItem[] }) {
  const lines = diffLines(comparison, scenario, items);
  return (
    <div className="diff-block" role="group" aria-label={`Changes in ${label} compared with your plan`} tabIndex={0}>
      <div className="diff-line diff-head">{`@@ your plan → what-if: ${label} @@`}</div>
      {lines.length === 0 ? (
        <div className="diff-line diff-none">No difference from your plan.</div>
      ) : (
        lines.map((line, index) => (
          <div key={index} className={`diff-line diff-${line.kind}`}>
            {`${line.kind === 'remove' ? '-' : '+'} ${line.text}`}
          </div>
        ))
      )}
    </div>
  );
}
