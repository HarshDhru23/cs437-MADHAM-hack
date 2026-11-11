import { useEffect, useId, useState, type FormEvent } from 'react';
import { ApiError } from '../../api/client';
import { endpoints } from '../../api/endpoints';
import type { AcademicRecord, Profile } from '../../api/types';
import { useSession } from '../../app/session';

/** A whole number of credits from 1 to 28, as the student typed it (empty means no advisor limit). */
export function isAdvisorCap(text: string): boolean {
  return /^[1-9][0-9]?$/.test(text) && Number(text) <= 28;
}

/**
 * CP-44: the student says whether their standing is regular or GPS, and any credit limit their advisor set. Both are the student's own word.
 * They apply when a plan is saved; a draft still being edited keeps its one 28-credit limit.
 */
export function StudyLoadSection({ record, onSaved }: { record: AcademicRecord; onSaved: (next: AcademicRecord) => void }) {
  const { api } = useSession();
  const id = useId();
  const savedStanding = record.profile.standing === 'GPS' ? 'GPS' : 'normal';
  const savedCap = record.profile.advisor_cap ?? '';
  const [standing, setStanding] = useState(savedStanding);
  const [cap, setCap] = useState(savedCap);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  // A newer record (saved here or reloaded) replaces what the form shows.
  useEffect(() => {
    setStanding(savedStanding);
    setCap(savedCap);
  }, [savedStanding, savedCap]);

  const changed = standing !== savedStanding || cap.trim() !== savedCap;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const text = cap.trim();
    if (text !== '' && !isAdvisorCap(text)) {
      setSaved(false);
      return setError('Enter your advisor’s credit limit as a whole number from 1 to 28, or leave it empty.');
    }
    setError(null);
    setStale(false);
    setBusy(true);
    const profile: Profile = { ...record.profile, standing };
    if (text) profile.advisor_cap = text;
    else delete profile.advisor_cap;
    try {
      const result = await endpoints.patchRecord(api, { expected_revision: record.revision, profile });
      onSaved(result.data);
      setSaved(true);
    } catch (e) {
      setSaved(false);
      if (e instanceof ApiError && e.kind === 'conflict') setStale(true);
      else setError('Your study load could not be saved. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const reload = async () => {
    try {
      onSaved((await endpoints.record(api)).data);
      setStale(false);
    } catch {
      setError('Your record could not be reloaded. Try again in a moment.');
    }
  };

  return (
    <section aria-label="Study load" className="stack rec-load">
      <h2 style={{ margin: 0 }}>Study load</h2>
      <p className="muted">Used when you save a plan, to flag a semester that is over your limit. A draft you are still editing always uses 28 credits.</p>
      <form onSubmit={save} className="stack" noValidate>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend>Standing</legend>
          <label style={{ marginRight: 'var(--space-4)' }}>
            <input type="radio" name={`${id}-standing`} checked={standing === 'normal'} onChange={() => (setStanding('normal'), setSaved(false))} /> Regular
          </label>
          <label>
            <input type="radio" name={`${id}-standing`} checked={standing === 'GPS'} onChange={() => (setStanding('GPS'), setSaved(false))} /> GPS
          </label>
        </fieldset>
        <div>
          <label htmlFor={`${id}-cap`}>Credit limit set by my advisor (optional, 1 to 28)</label>
          <input
            id={`${id}-cap`}
            inputMode="numeric"
            value={cap}
            onChange={(e) => (setCap(e.target.value), setSaved(false))}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            style={{ width: '6rem' }}
          />
        </div>
        {error ? (
          <p id={`${id}-error`} role="alert" className="field-error">
            {error}
          </p>
        ) : null}
        {stale ? (
          <p role="alert" className="field-error">
            Your record changed somewhere else, so this was not saved.{' '}
            <button type="button" className="btn btn-small" onClick={() => void reload()}>
              Reload my record
            </button>
          </p>
        ) : null}
        <div className="panel-row">
          <button type="submit" className="btn btn-primary" disabled={!changed || busy}>
            Save study load
          </button>
          {saved ? <span role="status">Saved.</span> : null}
        </div>
      </form>
    </section>
  );
}
