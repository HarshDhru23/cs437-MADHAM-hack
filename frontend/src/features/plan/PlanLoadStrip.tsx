import { formatCredits, formatTerm } from '../../lib/format';
import { LOAD_WORDS, loadLevel, shortTerm, type LoadLevel } from './loadLevel';
import './plan.css';

export interface LoadCell {
  term: string;
  /** Credits planned in the semester, as the server counted them. */
  planned: string;
  /** The most the semester can hold: 28, or 10 for a summer break. */
  limit: string;
}

const LEGEND: LoadLevel[] = ['empty', 'light', 'normal', 'heavy', 'over'];

/**
 * One cell per semester, coloured by how full it is. A summary of the plan's workload, not a control.
 * Each cell says what it is in words (term, credits out of the limit, and the load level), so colour is never the only signal.
 */
export function PlanLoadStrip({ cells }: { cells: LoadCell[] }) {
  if (cells.length === 0) return null;
  return (
    <div className="pb-heat" role="group" aria-label="Load by semester">
      <ul className="pb-heat-cells">
        {cells.map((c) => {
          const level = loadLevel(c.planned, c.limit);
          return (
            <li key={c.term} className="pb-heat-cell" data-level={level} title={`${formatTerm(c.term)}: ${formatCredits(c.planned)} of ${formatCredits(c.limit)} credits, ${LOAD_WORDS[level]}`}>
              <span className="pb-heat-term">{shortTerm(c.term)}</span>
              <span className="pb-heat-num">{`${formatCredits(c.planned)} / ${formatCredits(c.limit)}`}</span>
              <span className="pb-vh">{` ${LOAD_WORDS[level]}`}</span>
            </li>
          );
        })}
      </ul>
      <p className="pb-legend" aria-hidden="true">
        {LEGEND.map((level) => (
          <span key={level} className="pb-legend-item">
            <i className="pb-swatch" data-level={level} />
            {LOAD_WORDS[level]}
          </span>
        ))}
      </p>
    </div>
  );
}
