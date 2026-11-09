/**
 * Serialized, debounced saves for one revisioned resource (record or plan).
 * - Edits are coalesced; only the newest draft is sent after ~500ms.
 * - At most one save is in flight; later edits wait for its acknowledgement.
 * - A failed/offline save keeps the draft. A 409 stops the queue: nothing is
 *   resubmitted until the user reloads or explicitly chooses to keep their draft.
 */
import { ApiError } from './client';

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'offline' | 'error' | 'conflict';

export interface SaveState<T> {
  status: SaveStatus;
  /** Unacknowledged local edits; null once the server has acknowledged them. */
  draft: T | null;
  /** Last server-acknowledged value and revision. */
  acknowledged: T;
  revision: number;
  error: ApiError | null;
  conflictRevision: number | null;
  savedAt: Date | null;
}

export interface SaveResult<T> {
  revision: number;
  value: T;
}

export interface SaveQueueOptions<T> {
  revision: number;
  value: T;
  save: (draft: T, expectedRevision: number, signal: AbortSignal) => Promise<SaveResult<T>>;
  onChange?: (state: SaveState<T>) => void;
  debounceMs?: number;
}

export class SaveQueue<T> {
  private current: SaveState<T>;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private readonly options: Required<Omit<SaveQueueOptions<T>, 'onChange'>> & Pick<SaveQueueOptions<T>, 'onChange'>;
  private controller: AbortController | null = null;

  constructor(options: SaveQueueOptions<T>) {
    this.options = { debounceMs: 500, ...options };
    this.current = { status: 'idle', draft: null, acknowledged: options.value, revision: options.revision, error: null, conflictRevision: null, savedAt: null };
  }

  get state(): SaveState<T> {
    return this.current;
  }

  /** The value the UI should display: the unsynced draft if any, else the acknowledged value. */
  get value(): T {
    return this.current.draft ?? this.current.acknowledged;
  }

  edit(draft: T): void {
    if (this.current.status === 'conflict') {
      // Keep editing the local draft, but never resubmit automatically.
      this.update({ draft });
      return;
    }
    this.update({ draft, status: this.inFlight ? 'saving' : 'pending', error: null });
    this.schedule();
  }

  /** Send any pending draft now (for example before navigation). */
  async flush(): Promise<void> {
    this.clearTimer();
    if (this.inFlight) await this.inFlight;
    if (this.current.draft !== null && this.current.status !== 'conflict') await this.run();
  }

  retry(): void {
    if (this.current.draft === null || this.current.status === 'conflict') return;
    this.update({ status: 'pending', error: null });
    this.schedule(0);
  }

  /** Discard the local draft in favour of a freshly loaded server value. */
  reload(serverValue: T, serverRevision: number): void {
    this.clearTimer();
    this.update({ status: 'saved', draft: null, acknowledged: serverValue, revision: serverRevision, error: null, conflictRevision: null, savedAt: new Date() });
  }

  /** Explicit user decision after comparing: submit the draft against the newer revision. */
  keepMineOver(serverRevision: number): void {
    if (this.current.draft === null) return;
    this.update({ status: 'pending', revision: serverRevision, conflictRevision: null, error: null });
    this.schedule(0);
  }

  /** A (re)mounted view takes over this queue: future saves and state changes go to it. */
  rebind(save: SaveQueueOptions<T>['save'], onChange: SaveQueueOptions<T>['onChange']): void {
    this.options.save = save;
    this.listen(onChange);
  }

  /** Replace only the state-change listener (the save function is kept). */
  listen(onChange: SaveQueueOptions<T>['onChange']): void {
    this.options.onChange = onChange;
  }

  /**
   * The same account signed in again after its session expired: a draft whose save was refused with 401 is sent now, against the revision it was
   * made on, so a draft that went stale meanwhile still gets its 409. A save that failed for any other reason keeps its Retry button.
   */
  resumeAfterSignIn(): void {
    if (this.current.draft === null || this.current.status !== 'error' || this.current.error?.kind !== 'auth') return;
    this.update({ status: 'pending', error: null });
    this.schedule(0);
  }

  /** The view went away: send a waiting draft immediately instead of dropping it. */
  sendNow(): void {
    if (this.current.draft !== null && this.current.status === 'pending') this.schedule(0);
  }

  dispose(): void {
    this.clearTimer();
    this.controller?.abort();
  }

  private schedule(delay = this.options.debounceMs): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.inFlight) {
        void this.inFlight.then(() => this.schedule(0));
        return;
      }
      void this.run();
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private run(): Promise<void> {
    const draft = this.current.draft;
    if (draft === null || this.inFlight) return this.inFlight ?? Promise.resolve();
    const expected = this.current.revision;
    this.controller = new AbortController();
    this.update({ status: 'saving' });
    this.inFlight = this.options
      .save(draft, expected, this.controller.signal)
      .then((result) => {
        const newer = this.current.draft !== draft;
        this.update({
          acknowledged: result.value,
          revision: result.revision,
          draft: newer ? this.current.draft : null,
          status: newer ? 'pending' : 'saved',
          error: null,
          savedAt: new Date(),
        });
      })
      .catch((error: unknown) => {
        const apiError = error instanceof ApiError ? error : new ApiError('server', 0, String(error), []);
        if (apiError.kind === 'conflict') {
          this.update({ status: 'conflict', conflictRevision: apiError.currentRevision, error: apiError });
        } else if (apiError.kind === 'network') {
          this.update({ status: 'offline', error: apiError });
        } else if (apiError.kind !== 'aborted') {
          this.update({ status: 'error', error: apiError });
        }
      })
      .finally(() => {
        this.inFlight = null;
        this.controller = null;
        if (this.current.status === 'pending' && this.current.draft !== null && !this.timer) this.schedule();
      });
    return this.inFlight;
  }

  private update(patch: Partial<SaveState<T>>): void {
    this.current = { ...this.current, ...patch };
    this.options.onChange?.(this.current);
  }
}
