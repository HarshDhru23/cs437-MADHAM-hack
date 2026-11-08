import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../api/client';
import { endpoints } from '../../api/endpoints';
import type { PlanCheck, PlannedSemester } from '../../api/types';
import { useSession } from '../../app/session';

/** How long a request may take before the student is told, plainly, that it is taking too long. Tests shorten `timeouts.request`. */
export const REQUEST_TIMEOUT_MS = 45_000;
export const timeouts = { request: REQUEST_TIMEOUT_MS };
const DEBOUNCE_MS = 400;

/** An AbortController that also aborts itself after `ms`; `timedOut()` tells a timeout from a cancel. */
export function abortAfter(ms: number) {
  const controller = new AbortController();
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
  }, ms);
  return {
    signal: controller.signal,
    timedOut: () => expired,
    cancel: () => {
      clearTimeout(timer);
      controller.abort();
    },
    done: () => clearTimeout(timer),
  };
}

export interface PlanCheckState {
  /** The latest answer. While a newer check is pending the previous answer stays, so numbers never vanish while the student edits. */
  check: PlanCheck | null;
  /** True from the moment the plan changes until its answer arrives. */
  pending: boolean;
  error: ApiError | null;
  /** The record was saved elsewhere since this page loaded (HTTP 409). The caller decides what to offer. */
  conflict: boolean;
  /** Ask again now (after an error or a timeout). */
  retry: () => void;
}

/**
 * Checks a plan with the server (`POST /plans/check`) as it stands, shortly after every change. Only the latest answer is used:
 * an earlier request is aborted and, if it still answers, ignored. `semesters` null means there is nothing to check. A new
 * `resetKey` (for example a freshly generated draft) clears the previous answer and checks at once instead of after the delay.
 */
export function usePlanCheck(recordRevision: number, semesters: PlannedSemester[] | null, resetKey: unknown = null): PlanCheckState {
  const { api } = useSession();
  const [check, setCheck] = useState<PlanCheck | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [conflict, setConflict] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const sequence = useRef(0);
  const lastKey = useRef<unknown>(undefined);
  const lastAttempt = useRef(0);

  useEffect(() => {
    sequence.current += 1;
    const mine = sequence.current;
    if (!semesters) {
      lastKey.current = undefined;
      setCheck(null);
      setPending(false);
      setError(null);
      setConflict(false);
      return undefined;
    }
    const fresh = lastKey.current !== resetKey || lastAttempt.current !== attempt;
    if (lastKey.current !== resetKey) setCheck(null);
    lastKey.current = resetKey;
    lastAttempt.current = attempt;
    const request = abortAfter(timeouts.request);
    setPending(true);
    setError(null);
    const run = async () => {
      try {
        const result = await endpoints.checkPlan(api, recordRevision, semesters, { signal: request.signal });
        request.done();
        if (sequence.current !== mine) return;
        setCheck(result.data);
        setConflict(false);
        setPending(false);
      } catch (e) {
        request.done();
        if (sequence.current !== mine) return;
        if (e instanceof ApiError && e.kind === 'aborted' && !request.timedOut()) return;
        if (e instanceof ApiError && e.kind === 'conflict') setConflict(true);
        else if (request.timedOut()) setError(new ApiError('network', 0, 'This is taking too long. Try again.', []));
        else setError(e instanceof ApiError ? e : new ApiError('server', 0, 'The plan could not be checked.', []));
        setPending(false);
      }
    };
    const timer = setTimeout(() => void run(), fresh ? 0 : DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      request.cancel();
    };
  }, [semesters, recordRevision, resetKey, api, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { check, pending, error, conflict, retry };
}
