import { useId } from 'react';
import type { DurationChoice, InternshipInput, InternshipModuleInput, InternshipModuleResult, InternshipPreset, PlacementMode } from '../../api/types';
import { Badge } from '../../components/StatusBadge';
import { newId } from '../../lib/ids';
import { DURATION_LABEL, exclusiveToInclusive, inclusiveToExclusive, MODULE_PROGRESS_LABEL, moduleStateLabel, PLACEMENT_LABEL, TARGET_LABEL } from './model';

/** IN 498 modules are exactly 4 credits each (docs/academic-decisions.md D-14); the server re-checks. */
const MODULE_CREDITS = '4';
const MAX_MODULES = 10; // request limit in coursepath/validation.py, not an academic cap

interface InternshipEditorProps {
  value: InternshipInput | null;
  onChange: (next: InternshipInput | null, message: string) => void;
  /** Server evaluation of the saved scenario, or null when not evaluated yet. */
  modules: InternshipModuleResult[] | null;
}

/** Three equal duration options, presets, exact dates and IN 498 modules. Nothing here awards credit. */
export function InternshipEditor({ value, onChange, modules }: InternshipEditorProps) {
  const id = useId();
  const choice = value?.duration_choice ?? null;
  const preset: InternshipPreset = value?.preset ?? 'custom';
  const list = value?.modules ?? [];
  const lastDay = exclusiveToInclusive(value?.end_date_exclusive);

  const update = (patch: Partial<InternshipInput>, message: string) => {
    if (!value) return;
    onChange({ ...value, ...patch }, message);
  };

  const choose = (next: DurationChoice) => {
    if (next === 'none') {
      const removed = list.length;
      onChange(
        { duration_choice: 'none' },
        removed > 0 ? `No internship: removed ${removed} module(s) and the dates from this scenario.` : 'No internship selected.',
      );
      return;
    }
    onChange(
      {
        duration_choice: next,
        preset: value?.preset ?? 'custom',
        placement_mode: value?.placement_mode ?? 'unknown',
        start_date: value?.start_date ?? null,
        end_date_exclusive: value?.end_date_exclusive ?? null,
        modules: list,
      },
      `${DURATION_LABEL[next]} selected. Enter the exact dates; choosing a duration awards no credit.`,
    );
  };

  const setModules = (next: InternshipModuleInput[], message: string) => update({ modules: next }, message);
  const editModule = (moduleId: string, patch: Partial<InternshipModuleInput>) =>
    setModules(
      list.map((m) => (m.id === moduleId ? { ...m, ...patch } : m)),
      'Module updated.',
    );
  const addModule = (target: string) => ({ id: newId('in498'), credits: MODULE_CREDITS, intended_allocation: target, status: 'proposed' });

  return (
    <section className="panel" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>Internship</h2>
      <fieldset className="choice-group">
        <legend>Internship duration</legend>
        {(['none', 'three_months', 'six_months'] as DurationChoice[]).map((d) => (
          <label key={d} className="choice">
            <input type="radio" name={`${id}-duration`} value={d} checked={choice === d} onChange={() => choose(d)} />
            {DURATION_LABEL[d]}
          </label>
        ))}
      </fieldset>
      {choice === null ? <p className="muted">This scenario has no internship choice yet.</p> : null}
      {choice !== null && choice !== 'none' && value ? (
        <>
          <fieldset className="choice-group">
            <legend>How to choose the dates</legend>
            {(
              [
                ['summer', 'Summer'],
                ['semester', 'Semester'],
                ['custom', 'Custom dates'],
              ] as [InternshipPreset, string][]
            ).map(([p, label]) => (
              <label key={p} className="choice">
                <input type="radio" name={`${id}-preset`} value={p} checked={preset === p} onChange={() => update({ preset: p }, `${label} selected.`)} />
                {label}
              </label>
            ))}
          </fieldset>
          {preset !== 'custom' ? (
            <p className="callout" data-tone="warning" role="note">
              The server has not supplied academic calendar dates (GAP-03), so CoursePath cannot fill in {preset === 'summer' ? 'summer' : 'semester'} dates. Enter
              the exact start date and last day below; nothing is guessed.
            </p>
          ) : null}
          <div className="date-row">
            <div className="field">
              <label htmlFor={`${id}-start`}>Start date</label>
              <input
                id={`${id}-start`}
                type="date"
                value={value.start_date ?? ''}
                onChange={(e) => update({ start_date: e.target.value || null }, 'Start date changed.')}
              />
            </div>
            <div className="field">
              <label htmlFor={`${id}-end`}>Last day (inclusive)</label>
              <input
                id={`${id}-end`}
                type="date"
                aria-describedby={`${id}-end-hint`}
                value={lastDay}
                onChange={(e) => update({ end_date_exclusive: e.target.value ? inclusiveToExclusive(e.target.value) : null }, 'Last day changed.')}
              />
              <span className="hint" id={`${id}-end-hint`}>
                The last day you are away. CoursePath stores the day after it as the end of the interval.
              </span>
            </div>
          </div>
          {!value.start_date || !value.end_date_exclusive ? (
            <p className="field-error" role="status">
              Enter both exact dates. The server measures the actual duration from them.
            </p>
          ) : null}
          <div className="field">
            <label htmlFor={`${id}-placement`}>Placement</label>
            <select id={`${id}-placement`} value={value.placement_mode ?? 'unknown'} onChange={(e) => update({ placement_mode: e.target.value as PlacementMode }, 'Placement changed.')}>
              {Object.entries(PLACEMENT_LABEL).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
            <span className="hint">Remote or part-time work still needs explicit permission for any overlapping on-campus commitments.</span>
          </div>

          <h3>IN 498 modules</h3>
          <p className="muted">
            Choosing a duration awards no credit by itself. Credit can come only from 4-credit IN 498 modules, toward open electives, HSS electives or the open
            project, and only after recorded institute approval (D-14). Your entries stay proposals; you cannot mark a module approved here.
          </p>
          {list.length === 0 ? <p className="muted">No modules in this scenario.</p> : null}
          <ol className="module-list" aria-label="IN 498 modules">
            {list.map((m, index) => {
              const name = `IN 498 module ${index + 1}`;
              const evaluated = modules?.find((r) => r.id === m.id) ?? null;
              const state = evaluated ? moduleStateLabel(evaluated.status) : null;
              return (
                <li key={m.id}>
                  <fieldset>
                    <legend>
                      {name} — 4 credits{' '}
                      {state ? (
                        <Badge tone={state.tone} symbol={state.symbol}>
                          {state.label}
                        </Badge>
                      ) : (
                        <Badge tone="unknown" symbol="?">
                          Not evaluated yet
                        </Badge>
                      )}
                    </legend>
                    {evaluated && evaluated.reasons.length > 0 ? <p className="field-error">Server reasons: {evaluated.reasons.join(', ')}</p> : null}
                    <div className="date-row">
                      <div className="field">
                        <label htmlFor={`${m.id}-target`}>{`Target basket for ${name}`}</label>
                        <select id={`${m.id}-target`} value={m.intended_allocation} onChange={(e) => editModule(m.id, { intended_allocation: e.target.value })}>
                          {Object.entries(TARGET_LABEL).map(([k, label]) => (
                            <option key={k} value={k}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="field">
                        <label htmlFor={`${m.id}-status`}>{`Progress of ${name}`}</label>
                        <select
                          id={`${m.id}-status`}
                          value={m.status}
                          onChange={(e) => editModule(m.id, e.target.value === 'completed' ? { status: e.target.value } : { status: e.target.value, grade: null })}
                        >
                          {Object.entries(MODULE_PROGRESS_LABEL).map(([k, label]) => (
                            <option key={k} value={k}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </div>
                      {m.status === 'completed' ? (
                        <div className="field">
                          <label htmlFor={`${m.id}-grade`}>{`Result of ${name}`}</label>
                          <select id={`${m.id}-grade`} value={m.grade ?? ''} onChange={(e) => editModule(m.id, { grade: e.target.value || null })}>
                            <option value="">Not recorded</option>
                            <option value="P">P (pass)</option>
                            <option value="F">F (fail)</option>
                          </select>
                        </div>
                      ) : null}
                      <div className="field">
                        <label htmlFor={`${m.id}-ref`}>{`Approval evidence reference for ${name} (optional)`}</label>
                        <input
                          id={`${m.id}-ref`}
                          type="text"
                          value={m.approval_ref ?? ''}
                          onChange={(e) => editModule(m.id, { approval_ref: e.target.value.trim() ? e.target.value : null })}
                        />
                        <span className="hint">Only staff-verified evidence approves a module; a reference alone does not.</span>
                      </div>
                    </div>
                    <button type="button" className="btn btn-small" onClick={() => setModules(list.filter((x) => x.id !== m.id), `Removed ${name}.`)}>
                      {`Remove ${name}`}
                    </button>
                  </fieldset>
                </li>
              );
            })}
          </ol>
          <div className="panel-row">
            <button type="button" className="btn" disabled={list.length >= MAX_MODULES} onClick={() => setModules([...list, addModule('open_elective')], 'Added a proposed IN 498 module.')}>
              Add IN 498 module
            </button>
            <button
              type="button"
              className="btn"
              disabled={list.length > 0}
              onClick={() =>
                setModules(
                  [addModule('open_elective'), addModule('open_elective'), addModule('open_elective'), addModule('hss')],
                  'Added the example split as four proposed modules, pending approval.',
                )
              }
            >
              Use example split: 12 open elective + 4 HSS (proposed, pending approval)
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
