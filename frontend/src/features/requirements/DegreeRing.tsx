import { useEffect, useState } from 'react';
import { formatCredits } from '../../lib/format';
import './requirements.css';

/** One top-level requirement group as the ring draws it. Numbers are the server's; the ring only draws them. */
export interface RingGroup {
  id: string;
  label: string;
  required: string;
  /** Credits counted so far; null when there is no record to count. */
  counted: string | null;
  /** Credits a plan keeps in placeholders for this group (the server's number); drawn after the counted credits, lighter. */
  held?: string | null;
  done: boolean;
}

interface Props {
  groups: RingGroup[];
  /** The degree total and what is counted toward it, as the server reports them; null without a record. */
  total: string | null;
  counted: string | null;
  highlightId: string | null;
  onHighlight: (id: string | null) => void;
}

const SIZE = 300;
const CENTRE = SIZE / 2;
const RADIUS = 122;
const GAP_DEGREES = 1.2;

function point(angle: number): [number, number] {
  const radians = ((angle - 90) * Math.PI) / 180;
  return [CENTRE + RADIUS * Math.cos(radians), CENTRE + RADIUS * Math.sin(radians)];
}

function arcPath(from: number, to: number): string {
  const [x1, y1] = point(from);
  const [x2, y2] = point(to);
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${RADIUS} ${RADIUS} 0 ${to - from > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

/** Presentation only: the fraction of an arc to fill, never above the whole arc. */
function fraction(counted: string | null, required: string): number {
  const c = counted === null ? 0 : Number(counted);
  const r = Number(required);
  return Number.isFinite(c) && Number.isFinite(r) && r > 0 ? Math.max(0, Math.min(1, c / r)) : 0;
}

export const reducedMotion = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The degree as a ring: one arc per requirement group, as long as the credits it asks for, filled by the credits counted so far.
 * The arcs fill once when the page opens (not at all when the student asked for less motion). Hovering an arc, or focusing its group
 * row in the list, highlights both and names the group underneath.
 */
export function DegreeRing({ groups, total, counted, highlightId, onHighlight }: Props) {
  const reduced = reducedMotion();
  const [filled, setFilled] = useState(reduced);
  useEffect(() => {
    if (reduced) return;
    const frame = requestAnimationFrame(() => setFilled(true));
    return () => cancelAnimationFrame(frame);
  }, [reduced]);

  const circle = groups.reduce((sum, g) => sum + Number(g.required), 0);
  let angle = 0;
  const arcs = groups.map((g, index) => {
    const sweep = circle > 0 ? (Number(g.required) / circle) * 360 : 0;
    const from = angle + GAP_DEGREES;
    const to = Math.max(from + 0.1, angle + sweep - GAP_DEGREES);
    angle += sweep;
    const heldShare = g.held && Number(g.held) > 0 ? fraction(String(Number(g.counted ?? 0) + Number(g.held)), g.required) : 0;   // drawing only
    return { group: g, index, d: arcPath(from, to), share: fraction(g.counted, g.required), heldShare };
  });

  const summary =
    counted !== null && total !== null
      ? `${formatCredits(counted)} of ${formatCredits(total)} degree credits counted, across ${groups.length} requirement groups`
      : `${total !== null ? formatCredits(total) : ''} degree credits in ${groups.length} requirement groups`.trim();
  const active = groups.find((g) => g.id === highlightId) ?? null;

  return (
    <figure className="ring" data-motion={reduced ? 'reduced' : 'full'}>
      <div className="ring-art" data-active={active ? 'true' : undefined}>
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={summary} className="ring-svg">
          {arcs.map(({ group, d, share, heldShare, index }) => (
            <g
              key={group.id}
              className="ring-arc"
              data-ring-arc={group.id}
              data-highlight={highlightId === group.id ? 'true' : undefined}
              onMouseEnter={() => onHighlight(group.id)}
              onMouseLeave={() => onHighlight(null)}
              onFocus={() => onHighlight(group.id)}
              onBlur={() => onHighlight(null)}
              tabIndex={-1}
            >
              <path d={d} className="ring-track" fill="none" />
              {heldShare > share ? (
                <path d={d} className="ring-held" fill="none" pathLength={1} strokeDasharray="1 1" strokeDashoffset={filled ? 1 - heldShare : 1} />
              ) : null}
              <path
                d={d}
                className="ring-fill"
                data-done={group.done ? 'true' : undefined}
                fill="none"
                pathLength={1}
                strokeDasharray="1 1"
                strokeDashoffset={filled ? 1 - share : 1}
                style={reduced ? { transition: 'none' } : { transitionDelay: `${index * 70}ms` }}
              />
            </g>
          ))}
        </svg>
        <div className="ring-centre" aria-hidden="true">
          {counted !== null && total !== null ? (
            <>
              <span className="ring-number num">{formatCredits(counted)}</span>
              <span className="ring-of">of {formatCredits(total)} credits</span>
            </>
          ) : (
            <>
              <span className="ring-number num">{total !== null ? formatCredits(total) : ''}</span>
              <span className="ring-of">credits</span>
            </>
          )}
        </div>
      </div>
      <figcaption className="ring-caption" aria-live="polite">
        {active ? (
          <>
            <span>{active.label}</span>
            {active.counted !== null ? (
              <span className="mono num">
                {' · '}
                {formatCredits(Number(active.counted) > Number(active.required) ? active.required : active.counted)} / {formatCredits(active.required)}
              </span>
            ) : (
              <span className="mono num"> · {formatCredits(active.required)} credits</span>
            )}
          </>
        ) : (
          <span className="muted">Point at a segment to see its group.</span>
        )}
      </figcaption>
    </figure>
  );
}
