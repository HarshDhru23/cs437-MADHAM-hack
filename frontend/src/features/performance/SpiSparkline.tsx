import { formatTerm } from '../../lib/format';
import './performance.css';

export interface SpiPoint {
  term_id: string;
  /** The SPI as the server displays it, or null when the term has no graded credits. */
  display_value: string | null;
}

const WIDTH = 600;
const HEIGHT = 90;
const PAD_X = 14;
const PAD_Y = 16;

/**
 * SPI by semester as one line. A point is drawn only for a term that has a value; nothing is invented for the others and no axis numbers
 * are printed. The first and last values are named underneath, and the same words are the chart's accessible label.
 */
export function SpiSparkline({ terms }: { terms: SpiPoint[] }) {
  const points = terms.filter((t) => t.display_value !== null && Number.isFinite(Number(t.display_value))).map((t) => ({ ...t, value: Number(t.display_value) }));
  if (points.length === 0) return null;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const low = Math.min(...points.map((p) => p.value));
  const high = Math.max(...points.map((p) => p.value));
  const span = high - low || 1;
  const x = (i: number) => (points.length === 1 ? WIDTH / 2 : PAD_X + (i * (WIDTH - 2 * PAD_X)) / (points.length - 1));
  const y = (value: number) => (high === low ? HEIGHT / 2 : HEIGHT - PAD_Y - ((value - low) / span) * (HEIGHT - 2 * PAD_Y));
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const label =
    points.length === 1
      ? `SPI was ${first.display_value} in ${formatTerm(first.term_id)}`
      : `SPI went from ${first.display_value} in ${formatTerm(first.term_id)} to ${last.display_value} in ${formatTerm(last.term_id)}, over ${points.length} semesters`;
  return (
    <figure className="spark">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={label} className="spark-svg">
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={0} x2={WIDTH} y1={HEIGHT * f} y2={HEIGHT * f} className="spark-grid" />
        ))}
        {points.length > 1 ? <polyline points={line} className="spark-line" fill="none" /> : null}
        {points.map((p, i) => (
          <circle key={p.term_id} cx={x(i)} cy={y(p.value)} r={i === points.length - 1 ? 5 : 3.5} className={i === points.length - 1 ? 'spark-end' : 'spark-dot'} />
        ))}
      </svg>
      <figcaption className="spark-caption mono num">
        <span>
          {formatTerm(first.term_id)} · {first.display_value}
        </span>
        {points.length > 1 ? (
          <span>
            {formatTerm(last.term_id)} · {last.display_value}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}
