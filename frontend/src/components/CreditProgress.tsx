import { formatCredits } from '../lib/format';

/**
 * Visual illustration of server-provided counted/required strings. The bar is
 * only drawn when both values are known; it never decides a status.
 */
export function CreditProgress({ label, counted, required }: { label: string; counted: string | null | undefined; required: string | null | undefined }) {
  const text = `${formatCredits(counted)} of ${formatCredits(required)} credits`;
  const c = counted != null && counted !== '' ? Number(counted) : NaN;
  const r = required != null && required !== '' ? Number(required) : NaN;
  const drawable = Number.isFinite(c) && Number.isFinite(r) && r > 0;
  // Width is presentation only (percent of bar), never used as an academic value.
  const percent = drawable ? Math.max(0, Math.min(100, (c / r) * 100)) : 0;
  return (
    <div className="progress">
      <span className="num">{text}</span>
      {drawable ? (
        <div className="progress-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)} aria-valuetext={text}>
          <div className="progress-fill" style={{ width: `${percent}%` }} />
        </div>
      ) : null}
    </div>
  );
}
