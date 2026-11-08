import type { SaveStatus } from '../api/saveQueue';
import { formatTimestamp } from '../lib/format';

const TEXT: Record<SaveStatus, string> = {
  idle: 'All changes saved',
  pending: 'Unsaved changes',
  saving: 'Saving…',
  saved: 'Saved',
  offline: 'Offline — changes kept on this device only',
  error: 'Save failed — changes not saved',
  conflict: 'Conflict — saved elsewhere',
};

const SYMBOL: Record<SaveStatus, string> = { idle: '✓', pending: '•', saving: '…', saved: '✓', offline: '⚠', error: '✕', conflict: '⚠' };

export function SaveStatusIndicator({ status, savedAt, label }: { status: SaveStatus; revision?: number | null; savedAt?: Date | null; label?: string }) {
  const tone = status === 'error' || status === 'conflict' ? 'danger' : status === 'offline' || status === 'pending' ? 'warning' : 'neutral';
  return (
    <span className="save-status" role="status" aria-live="polite" aria-label={label}>
      <span className={`badge badge-${tone}`}>
        <span aria-hidden="true">{SYMBOL[status]}</span>
        {TEXT[status]}
      </span>
      {savedAt && status === 'saved' ? <span className="muted">at {formatTimestamp(savedAt.toISOString())}</span> : null}
    </span>
  );
}
