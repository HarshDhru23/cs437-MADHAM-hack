import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '../../api/client';
import { scenarioEndpoints } from '../../api/endpoints';
import { useResourceCache } from '../../api/resources';
import { useSession } from '../../app/session';
import { ConfirmDialog } from '../../components/ConfirmDialog';

export interface ScenarioTarget {
  id: string;
  label: string;
  /** The revision the student last saw. */
  revision: number;
}

type Failure = { kind: 'conflict' | 'network' | 'other'; message: string; target: ScenarioTarget };

/**
 * Deleting a scenario: a confirmation first (never a one-click delete), then DELETE with the scenario's revision. Only the scenario goes;
 * the baseline plan and the student's record are untouched. A scenario that is already gone counts as deleted.
 */
export function useDeleteScenario({ onDeleted }: { onDeleted: (target: ScenarioTarget) => void }) {
  const { api, user } = useSession();
  const cache = useResourceCache();
  const [asking, setAsking] = useState<ScenarioTarget | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [deleted, setDeleted] = useState<string | null>(null);
  const running = useRef(false);

  const finish = useCallback(
    (target: ScenarioTarget) => {
      cache.invalidate('scenarios:'); // the list and the "also compare" choices of every other scenario
      if (user) cache.invalidate(`scenario:${user.id}:${target.id}`);
      setDeleted(target.label);
      onDeleted(target);
    },
    [cache, onDeleted, user],
  );

  const run = useCallback(
    async (target: ScenarioTarget) => {
      if (running.current) return; // rapid double clicks never send two requests
      running.current = true;
      setBusyId(target.id);
      setFailure(null);
      setDeleted(null);
      try {
        await scenarioEndpoints.remove(api, target.id, target.revision);
        finish(target);
      } catch (e) {
        if (e instanceof ApiError && e.kind === 'not_found') {
          finish(target); // already deleted elsewhere
        } else if (e instanceof ApiError && e.kind === 'conflict') {
          cache.invalidate('scenarios:');
          if (user) cache.invalidate(`scenario:${user.id}:${target.id}`);
          setFailure({
            kind: 'conflict',
            message: 'This scenario was changed in another tab or on another device, so it was not deleted. Your scenarios have been reloaded; check it and delete it again if you still want to.',
            target,
          });
        } else if (e instanceof ApiError && e.kind === 'network') {
          setFailure({ kind: 'network', message: 'CoursePath could not be reached, so the scenario was not deleted.', target });
        } else {
          setFailure({ kind: 'other', message: 'The scenario could not be deleted. Try again in a moment.', target });
        }
      } finally {
        running.current = false;
        setBusyId(null);
      }
    },
    [api, cache, finish, user],
  );

  const ask = useCallback((target: ScenarioTarget) => {
    setDeleted(null);
    setFailure(null);
    setAsking(target);
  }, []);

  const confirmation: ReactNode = (
    <ConfirmDialog
      open={asking !== null}
      title="Delete this scenario?"
      confirmLabel="Delete scenario"
      danger
      onCancel={() => setAsking(null)}
      onConfirm={() => {
        const target = asking;
        setAsking(null);
        if (target) void run(target);
      }}
    >
      <p>
        “{asking?.label}” will be deleted for good and cannot be undone. Your baseline plan, your other plans and your record are not changed.
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

  return { ask, busyId, confirmation, notice };
}
