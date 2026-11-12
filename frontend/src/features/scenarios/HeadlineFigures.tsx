import type { ReactNode } from 'react';
import type { ScenarioComparison, ScenarioEvaluation } from '../../api/types';
import { compareTerms, formatCredits, formatTerm } from '../../lib/format';

/**
 * The three figures a student looks for first, taken as the server sent them: CPI, the term they finish, and credits per semester.
 * Nothing is calculated here. A figure is "No change" only when the server's value for the scenario is the very value it gave the plan.
 */

type Figure = { value: string | null; was: string | null };

function note(f: Figure): string | null {
  if (f.value === null) return null;
  if (f.was === f.value) return 'No change';
  return `Your plan: ${f.was ?? '—'}`;
}

const cpiOf = (e: ScenarioEvaluation | null): string | null => e?.performance?.cumulative?.display_value ?? null;
const finishOf = (e: ScenarioEvaluation | null): string | null => {
  const term = e?.validation?.completion_term ?? e?.completion_term ?? null;
  return term ? formatTerm(term) : null;
};

function Card({ label, children, extra }: { label: string; children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="scn-figure">
      <span className="scn-figure-label">{label}</span>
      {children}
      {extra}
    </div>
  );
}

function Single({ label, figure, hypothetical }: { label: string; figure: Figure; hypothetical?: boolean }) {
  const text = note(figure);
  return (
    <Card label={label} extra={text ? <span className="scn-figure-note" data-same={text === 'No change' ? 'true' : undefined}>{text}</span> : null}>
      <strong className="num scn-figure-value">{figure.value ?? '—'}</strong>
      {hypothetical && figure.value ? <span className="scn-figure-note">hypothetical</span> : null}
    </Card>
  );
}

export function HeadlineFigures({ comparison, stale }: { comparison: ScenarioComparison; stale: boolean }) {
  const { baseline, scenario } = comparison;
  const load = scenario?.validation?.workload ?? null;
  const baseLoad = baseline?.validation?.workload ?? null;
  const terms = load ? Object.keys(load).sort(compareTerms) : [];
  return (
    <div className="scn-figures" role="group" aria-label="What happens in brief" aria-busy={stale || undefined} data-stale={stale || undefined}>
      <Single label="CPI" figure={{ value: cpiOf(scenario), was: cpiOf(baseline) }} hypothetical={Boolean(scenario?.performance?.hypothetical)} />
      <Single label="You finish" figure={{ value: finishOf(scenario), was: finishOf(baseline) }} />
      <Card label="Credits per semester">
        {terms.length === 0 ? (
          <strong className="scn-figure-value">—</strong>
        ) : (
          <ul className="scn-load">
            {terms.map((t) => {
              const now = load?.[t]?.target_credits ?? null;
              const was = baseLoad?.[t]?.target_credits ?? null;
              return (
                <li key={t}>
                  <span>{formatTerm(t)}</span>
                  <strong className="num">{now === null ? '—' : formatCredits(now)}</strong>
                  {now !== null && was !== null && was !== now ? <span className="scn-figure-note">{`was ${formatCredits(was)}`}</span> : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
