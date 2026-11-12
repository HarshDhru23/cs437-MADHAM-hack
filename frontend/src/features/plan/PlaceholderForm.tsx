import { useId, useState, type FormEvent } from 'react';
import type { RequirementDefinition } from '../../api/types';
import { CreditStepper } from '../../components/CreditStepper';
import { newId } from '../../lib/ids';
import { isDecimalString } from '../../lib/validation';
import { requirementLabel } from '../requirements/RequirementTree';

export interface NewPlaceholder {
  id: string;
  requirement_id: string;
  desired_credits: string;
  label?: string;
}

/** Holds credits for a requirement until the student chooses a course. Shares its layout and its ending (add, Cancel) with every other way of adding to a semester. */
export function PlaceholderForm({ options, onAdd, onCancel }: { options: (RequirementDefinition & { depth: number })[]; onAdd: (p: NewPlaceholder) => void; onCancel: () => void }) {
  const id = useId();
  const [chosen, setChosen] = useState('');
  const requirement = chosen || (options[0]?.id ?? ''); // the list may arrive after the form opens
  const [credits, setCredits] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!requirement) return setError('Choose the requirement this placeholder is meant to fill.');
    if (!isDecimalString(credits.trim())) return setError('Enter target credits as a number, for example 4 (no leading zeros, at most 4 decimal places).');
    if (Number(credits.trim()) <= 0) return setError('Target credits must be more than 0.');
    setError(null);
    onAdd({ id: newId('placeholder'), requirement_id: requirement, desired_credits: credits.trim(), ...(label.trim() ? { label: label.trim() } : {}) });
  };

  return (
    <form className="add-form" data-add-form="placeholder" onSubmit={submit} noValidate aria-label="Add a placeholder">
      <p className="muted">A placeholder holds credits for a requirement until you choose a course.</p>
      <div className="field">
        <label htmlFor={`${id}-req`}>Requirement</label>
        <select id={`${id}-req`} value={requirement} onChange={(e) => setChosen(e.target.value)}>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {'— '.repeat(o.depth)}
              {requirementLabel(o, undefined)}
            </option>
          ))}
        </select>
      </div>
      <div className="add-row">
        <div className="field">
          <label htmlFor={`${id}-cr`}>Target credits</label>
          <CreditStepper id={`${id}-cr`} value={credits} onChange={setCredits} min={1} max={16} invalid={Boolean(error)} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-label`}>Label</label>
          <input id={`${id}-label`} type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. HSS elective" />
        </div>
      </div>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="add-actions" data-add-actions>
        <button type="submit" className="btn btn-primary">
          Add placeholder
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
