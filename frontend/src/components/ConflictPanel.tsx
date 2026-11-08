import { useState, type ReactNode } from 'react';

interface ConflictPanelProps {
  conflictRevision: number | null;
  /** Fetch the latest saved version and adopt it, discarding the local draft. */
  onReload: () => Promise<void>;
  /** Fetch the latest revision and explicitly resubmit the local draft over it. */
  onKeepMine: () => Promise<void>;
  /** Fetch the latest saved version for side-by-side comparison. */
  onCompare?: () => Promise<ReactNode>;
  draftSummary: ReactNode;
}

/** Shown after a 409. Nothing is retried until the student chooses. */
export function ConflictPanel({ onReload, onKeepMine, onCompare, draftSummary }: ConflictPanelProps) {
  const [busy, setBusy] = useState(false);
  const [server, setServer] = useState<ReactNode>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="callout" data-tone="danger" role="alert">
      <p>
        <strong>This was saved elsewhere</strong>
        . Your unsaved changes are still here and have not been sent again.
      </p>
      <div className="grid-2">
        <div>
          <h4>Your unsaved version</h4>
          {draftSummary}
        </div>
        {server ? (
          <div>
            <h4>Saved version</h4>
            {server}
          </div>
        ) : null}
      </div>
      <div className="panel-row">
        {onCompare ? (
          <button type="button" className="btn" disabled={busy} onClick={() => run(async () => setServer(await onCompare()))}>
            Compare with saved version
          </button>
        ) : null}
        <button type="button" className="btn" disabled={busy} onClick={() => run(onReload)}>
          Reload saved version
        </button>
        <button type="button" className="btn btn-danger" disabled={busy} onClick={() => run(onKeepMine)}>
          Keep my version
        </button>
      </div>
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}
