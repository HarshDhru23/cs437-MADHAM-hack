import { useState } from 'react';
import type { Allocation, CourseAttempt, Curriculum, RequirementDefinition, RequirementResult } from '../../api/types';
import { CreditProgress } from '../../components/CreditProgress';
import { RequirementStatusBadge } from '../../components/StatusBadge';
import { formatCredits, humanize } from '../../lib/format';

export function requirementLabel(def: RequirementDefinition | undefined, result?: RequirementResult): string {
  if (def?.label) return def.label;
  if (result?.label && result.label !== result.id) return result.label;
  return humanize(def?.id ?? result?.id ?? 'requirement');
}

/** Plain description of the rule shape from the server definition (no evaluation). */
export function describeRule(def: RequirementDefinition | undefined): string {
  if (!def) return 'Rule definition not provided by the server.';
  const credits = def.minimum_credits ? `${formatCredits(def.minimum_credits)} credits` : null;
  switch (def.type) {
    case 'mandatory_course':
      return `Mandatory course ${def.course_id ?? '(code not provided)'}${credits ? ` · ${credits}` : ''}`;
    case 'choose_courses':
      return `Choose at least ${def.minimum_courses ?? 'an unspecified number of'} courses${credits ? ` · at least ${credits}` : ''}`;
    case 'all_of':
      return `All parts below${credits ? ` · ${credits} in total` : ''}`;
    case 'minimum_credits':
      return credits ? `At least ${credits}` : 'Minimum credits not specified';
    default:
      return `${humanize(def.type)}${credits ? ` · ${credits}` : ''}`;
  }
}

export function indexDefinitions(curriculum: Curriculum | null): Map<string, RequirementDefinition> {
  const map = new Map<string, RequirementDefinition>();
  const walk = (defs: RequirementDefinition[] = []) => {
    for (const d of defs) {
      map.set(d.id, d);
      walk(d.children);
    }
  };
  walk(curriculum?.requirements);
  return map;
}

interface TreeProps {
  definitions: Map<string, RequirementDefinition>;
  /** Public mode: render definitions only. */
  defs?: RequirementDefinition[];
  /** Personal mode: render server results. */
  results?: RequirementResult[];
  ledger?: Allocation[];
  attempts?: Map<string, CourseAttempt>;
  onWhy: (id: string) => void;
  highlight?: Set<string>;
  label?: string;
}

export function RequirementTree({ definitions, defs, results, ledger = [], attempts, onWhy, highlight, label }: TreeProps) {
  const items = results ? results.map((r) => ({ id: r.id, result: r as RequirementResult | undefined, def: definitions.get(r.id) })) : (defs ?? []).map((d) => ({ id: d.id, result: undefined, def: d }));
  return (
    <ul className="req-list" aria-label={label}>
      {items.map(({ id, result, def }) => (
        <RequirementRow key={id} id={id} result={result} def={def} definitions={definitions} ledger={ledger} attempts={attempts} onWhy={onWhy} highlight={highlight} />
      ))}
    </ul>
  );
}

function RequirementRow({
  id,
  result,
  def,
  definitions,
  ledger,
  attempts,
  onWhy,
  highlight,
}: {
  id: string;
  result?: RequirementResult;
  def?: RequirementDefinition;
  definitions: Map<string, RequirementDefinition>;
  ledger: Allocation[];
  attempts?: Map<string, CourseAttempt>;
  onWhy: (id: string) => void;
  highlight?: Set<string>;
}) {
  const [open, setOpen] = useState(false);
  const name = requirementLabel(def, result);
  const childDefs = def?.children ?? [];
  const childResults = result?.children ?? [];
  const counted = result ? ledger.filter((a) => result.allocation_ids.includes(a.id)) : [];
  const detailsId = `req-details-${id}`;
  return (
    <li data-requirement={id}>
      <div className="req-row" data-highlight={highlight?.has(id) ? 'true' : undefined}>
        <div className="req-head">
          <div>
            <h3>{name}</h3>
            <p className="muted">{describeRule(def)}</p>
          </div>
          <div className="req-metrics">
            {result ? <RequirementStatusBadge status={result.status} /> : null}
            {result ? (
              <CreditProgress label={name} counted={result.counted_credits} required={result.required_credits} />
            ) : (
              <span className="num">Requires {formatCredits(def?.minimum_credits)} credits</span>
            )}
            {result ? <span className="num">Remaining: {formatCredits(result.remaining_credits)}</span> : null}
            {result && result.required_courses != null ? (
              <span className="num">
                Courses: {result.counted_courses ?? 'Unknown'} of {result.required_courses}
              </span>
            ) : null}
            <button type="button" className="btn btn-small" aria-expanded={open} aria-controls={detailsId} aria-label={`Details for ${name}`} onClick={() => setOpen((o) => !o)}>
              Details
            </button>
            <button type="button" className="btn btn-small btn-quiet" aria-label={`Why? ${name}`} onClick={() => onWhy(id)}>
              Why?
            </button>
          </div>
        </div>
        {open ? (
          <div className="req-details" id={detailsId}>
            {result ? (
              <>
                <h4>Counted toward this requirement</h4>
                {counted.length === 0 ? (
                  <p className="muted">No attempts are counted here by the server.</p>
                ) : (
                  <ul>
                    {counted.map((a) => {
                      const at = attempts?.get(a.attempt_id);
                      return (
                        <li key={a.id}>
                          <span className="mono">{at?.normalized_code ?? a.attempt_id}</span> {at?.title ?? ''} · <span className="num">{formatCredits(a.credits)} credits</span> ·{' '}
                          {a.counting_context} — {a.explanation}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            ) : null}
            {def?.course_ids && def.course_ids.length > 0 ? (
              <p>
                Listed courses in these rules: <span className="mono">{def.course_ids.join(', ')}</span>
              </p>
            ) : def && def.type !== 'mandatory_course' && def.type !== 'all_of' ? (
              <p className="muted">Eligible course list: not provided by the reviewed data yet.</p>
            ) : null}
            <p className="muted">Sources: {(result?.source_refs ?? def?.source_refs ?? []).join(', ') || 'none provided'}</p>
          </div>
        ) : null}
      </div>
      {result && childResults.length > 0 ? (
        <RequirementTree definitions={definitions} results={childResults} ledger={ledger} attempts={attempts} onWhy={onWhy} highlight={highlight} label={`Parts of ${name}`} />
      ) : !result && childDefs.length > 0 ? (
        <RequirementTree definitions={definitions} defs={childDefs} onWhy={onWhy} highlight={highlight} label={`Parts of ${name}`} />
      ) : null}
    </li>
  );
}
