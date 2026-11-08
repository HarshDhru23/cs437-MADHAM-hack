import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '../../api/client';
import { endpoints } from '../../api/endpoints';
import { useResourceCache } from '../../api/resources';
import { saveRegistry } from '../../api/saveRegistry';
import { useSession } from '../../app/session';
import { ConfirmDialog } from '../../components/ConfirmDialog';

export interface DeleteTarget {
  id: string;
  label: string;
  /** The revision the student last saw; used unless `prepare` supplies a newer one. */
  revision: number;
}

/** Thrown by `prepare` when the plan has edits that could not be saved first. */
export class UnsavedChangesError extends Error {}

type Failure = { kind: 'conflict' | 'network' | 'unsaved' | 'other'; message: string; target: DeleteTarget };

/**
 * Deleting a saved plan: a confirmation first (never a one-click delete), then DELETE with the plan's revision.
 * Only the plan is removed; the student's record and other plans are untouched. A plan that is already gone counts as deleted.
 */
export function useDeletePlan({ onDeleted, prepare }: { onDeleted: (target: DeleteTarget) => void; prepare?: (target: DeleteTarget) => Promise<number> }) {
  const { api, user } = useSession();
  const cache = useResourceCache();
  const [asking, setAsking] = useState<DeleteTarget | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [deleted, setDeleted] = useState<string | null>(null);
  const running = useRef(false);

  const finish = useCallback(
    (target: DeleteTarget) => {
      saveRegistry.discard(`plan:${target.id}`); // a draft kept for this plan must not be sent to a plan that no longer exists
      if (user) cache.invalidate(`plan:${user.id}:${target.id}`);
      cache.invalidate('plans:'); // the plans list and the Requirements projection selector
      cache.invalidate('analysis:');
      setDeleted(target.label);
      onDeleted(target);
    },
    [cache, onDeleted, user],
  );

  const run = useCallback(
    async (target: DeleteTarget) => {
      if (running.current) return; // rapid double clicks never send two requests
      running.current = true;
      setBusyId(target.id);
      setFailure(null);
      setDeleted(null);
      try {
        const revision = prepare ? await prepare(target) : target.revision;
        await endpoints.deletePlan(api, target.id, revision);
        finish(target);
      } catch (e) {
        if (e instanceof UnsavedChangesError) {
          setFailure({ kind: 'unsaved', message: 'Your latest changes could not be saved yet, so the plan was not deleted. Retry saving, or try again in a moment.', target });
        } else if (e instanceof ApiError && e.kind === 'not_found') {
          finish(target); // already deleted elsewhere
        } else if (e instanceof ApiError && e.kind === 'conflict') {
          cache.invalidate('plans:');
          if (user) cache.invalidate(`plan:${user.id}:${target.id}`);
          setFailure({
            kind: 'conflict',
            message: 'This plan was changed in another tab or on another device, so it was not deleted. Your plans have been reloaded; check it and delete it again if you still want to.',
            target,
          });
        } else if (e instanceof ApiError && e.kind === 'network') {
          setFailure({ kind: 'network', message: 'CoursePath could not be reached, so the plan was not deleted.', target });
        } else {
          setFailure({ kind: 'other', message: e instanceof ApiError ? e.message : 'The plan could not be deleted.', target });
        }
      } finally {
        running.current = false;
        setBusyId(null);
      }
    },
    [api, cache, finish, prepare, user],
  );

  const ask = useCallback((target: DeleteTarget) => {
    setDeleted(null);
    setFailure(null);
    setAsking(target);
  }, []);

  const confirmation: ReactNode = (
    <ConfirmDialog
      open={asking !== null}
      title="Delete this plan?"
      confirmLabel="Delete plan"
      danger
      onCancel={() => setAsking(null)}
      onConfirm={() => {
        const target = asking;
        setAsking(null);
        if (target) void run(target);
      }}
    >
      <p>
        “{asking?.label}” will be deleted and cannot be undone. Your record and your other plans are not changed.
      </p>
    </ConfirmDialog>
  );

  const notice: ReactNode = (
    <>
      {failure ? (
        <div className="callout" data-tone="warning" role="alert">
          {failure.message}{' '}
          {failure.kind !== 'conflict' ? (
            <button type="button" className="btn btn-small" onClick={() => void run(failure.target)}>
              Try again
            </button>
          ) : null}
        </div>
      ) : null}
      {deleted ? (
        <p className="callout" data-tone="success" role="status">
          Deleted “{deleted}”.
        </p>
      ) : null}
    </>
  );

  return { ask, busyId, confirmation, notice, showsMessage: failure !== null || deleted !== null };
}
