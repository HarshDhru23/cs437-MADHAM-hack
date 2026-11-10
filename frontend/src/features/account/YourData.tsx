/**
 * A11 "Your data": backup download, restore from a backup (preview, then an
 * explicit confirmation) and data/account deletion. Every count shown here is
 * the server's; nothing is claimed as deleted or restored unless the server
 * acknowledged it.
 */
import { useId, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { accountEndpoints, endpoints } from '../../api/endpoints';
import { useRecord } from '../../api/hooks';
import { useResourceCache } from '../../api/resources';
import type { AcademicRecord, BackupDiff, BackupPreview, CourseAttempt, DeleteDataResult, Issue } from '../../api/types';
import { useSession } from '../../app/session';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ConflictPanel } from '../../components/ConflictPanel';
import { IssueList } from '../../components/IssueList';
import { formatTerm, formatTimestamp, humanize } from '../../lib/format';
import { previewStore } from '../import/previewStore';
import { PasswordField } from '../auth/AuthPages';
import { GoogleSignIn } from '../auth/GoogleSignIn';
import './account.css';

export const DELETE_PHRASE = 'delete my data';

/** Quoted from server/README.md ("Rules and deployment configuration"); not CoursePath policy text of our own. */
const README_RETENTION =
  'Data deletion is immediate in the application database. The hosted database keeps automatic backups for 7 days, so a copy can remain in a backup until it expires (the deletion response says so).';

function asApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError('server', 0, String(error), []);
}

/** `coursepath-backup-YYYY-MM-DD.json`, dated in Asia/Kolkata from the server's export time. */
export function backupFileName(exportedAt: string | null | undefined): string {
  const parsed = exportedAt ? new Date(exportedAt) : new Date();
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  return `coursepath-backup-${day}.json`;
}

/** Save text as a local file through a Blob URL (no server round trip, nothing in the URL bar). */
export function saveTextFile(name: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser time to start the download before releasing the Blob.
  setTimeout(() => URL.revokeObjectURL?.(url), 10_000);
}

function ServerFailure({ title, error, extra }: { title: string; error: ApiError; extra?: ReactNode }) {
  return (
    <div className="callout" data-tone="danger" role="alert">
      <p>
        <strong>{title}</strong>
      </p>
      {error.issues.length > 0 ? <IssueList issues={error.issues} grouped={false} /> : <p>{error.message}</p>}
      {extra}
    </div>
  );
}

// ------------------------------------------------------------------ download

function DownloadBackup() {
  const session = useSession();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState<{ name: string; revision: number | null; issues: Issue[] } | null>(null);

  const download = async () => {
    setPending(true);
    setError(null);
    setDone(null);
    try {
      const envelope = await accountEndpoints.exportBackup(session.api);
      const name = backupFileName(envelope.data.exported_at);
      // The whole envelope, as served: restore accepts it, and its issues (for example draft rules) stay with the data.
      saveTextFile(name, JSON.stringify(envelope, null, 2));
      setDone({ name, revision: envelope.data.record?.revision ?? null, issues: envelope.issues });
    } catch (e) {
      setError(asApiError(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <section aria-labelledby="backup-heading">
      <h3 id="backup-heading">Download a backup</h3>
      <p>
        The backup is a file with your username, your record (courses, corrections and current courses), your plans and your scenarios. It contains no
        password.
      </p>
      <p className="muted">
        It is your own copy for restoring into this CoursePath account. It is not an official transcript.
      </p>
      <button type="button" className="btn btn-primary" onClick={download} disabled={pending}>
        {pending ? 'Preparing backup…' : 'Download backup (JSON)'}
      </button>
      {done ? (
        <div className="callout" role="status">
          <p>
            Saved <span className="mono">{done.name}</span>
            . Keep it somewhere private: it contains your grades.
          </p>
          {done.issues.length > 0 ? <IssueList issues={done.issues} grouped={false} headingLevel={4} /> : null}
        </div>
      ) : null}
      {error ? <ServerFailure title="The backup could not be downloaded." error={error} /> : null}
    </section>
  );
}

// ------------------------------------------------------------------- restore

const DIFF_LABELS: Record<string, string> = {
  attempts_added: 'Attempts added',
  attempts_removed: 'Attempts removed',
  attempts_changed: 'Attempts changed',
  attempts_unchanged: 'Attempts unchanged',
  current_enrolment_changed: 'Current enrolment replaced',
  plans_to_create: 'Plans to create',
  scenarios_not_restored: 'Scenarios not restored',
};

/** Attempts in a chosen backup file, read only to label the server's attempt IDs. */
function backupAttempts(file: unknown): CourseAttempt[] {
  const root = file as { data?: { record?: { attempts?: unknown } }; record?: { attempts?: unknown } } | null;
  const attempts = root?.data?.record?.attempts ?? root?.record?.attempts;
  return Array.isArray(attempts) ? (attempts as CourseAttempt[]) : [];
}

function attemptLabel(id: string, lookup: Map<string, CourseAttempt>): ReactNode {
  const a = lookup.get(id);
  if (!a) return <span className="mono">{id}</span>;
  return (
    <>
      <span className="mono">{a.normalized_code}</span> {a.title} ({formatTerm(a.term_id)}, grade {a.grade || 'blank'})
    </>
  );
}

function DiffValue({ name, value, lookup }: { name: string; value: unknown; lookup: Map<string, CourseAttempt> }) {
  if (Array.isArray(value)) {
    if (value.length === 0) return <>0</>;
    return (
      <>
        {value.length}
        <ul>
          {value.map((v, i) => (
            <li key={`${name}-${i}`}>{typeof v === 'string' && name.startsWith('attempts_') ? attemptLabel(v, lookup) : typeof v === 'string' ? v : JSON.stringify(v)}</li>
          ))}
        </ul>
      </>
    );
  }
  if (typeof value === 'boolean') return <>{value ? 'Yes' : 'No'}</>;
  if (typeof value === 'number' || typeof value === 'string') return <>{String(value)}</>;
  return <>{value === null || value === undefined ? 'Not reported' : JSON.stringify(value)}</>;
}

function RestoreDiff({ diff, lookup }: { diff: BackupDiff; lookup: Map<string, CourseAttempt> }) {
  const known = Object.keys(DIFF_LABELS).filter((k) => k in diff);
  const other = Object.keys(diff).filter((k) => !(k in DIFF_LABELS));
  return (
    <dl className="diff-list">
      {[...known, ...other].map((key) => (
        <div key={key}>
          <dt>{DIFF_LABELS[key] ?? humanize(key)}</dt>
          <dd className="num">
            <DiffValue name={key} value={diff[key]} lookup={lookup} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

type Chosen = { name: string; value: unknown };

function RestoreBackup({ record }: { record: AcademicRecord | null }) {
  const session = useSession();
  const cache = useResourceCache();
  const inputId = useId();
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ data: BackupPreview; issues: Issue[] } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState<'preview' | 'commit' | null>(null);
  const [error, setError] = useState<{ stage: 'preview' | 'commit'; error: ApiError } | null>(null);
  const [done, setDone] = useState<{ revision: number; attempts: number; plans: number } | null>(null);
  const [fileKey, setFileKey] = useState(0);

  const reset = () => {
    setChosen(null);
    setPreview(null);
    setConfirming(false);
    setError(null);
    setFileKey((k) => k + 1);
  };

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setChosen(null);
    setPreview(null);
    setError(null);
    setDone(null);
    setFileError(null);
    if (!file) return;
    let text: string;
    try {
      text = await file.text();
    } catch {
      setFileError('This file could not be read. Choose the backup file again.');
      return;
    }
    try {
      setChosen({ name: file.name, value: JSON.parse(text) as unknown });
    } catch {
      setFileError(`“${file.name}” is not valid JSON. Choose the .json file you downloaded from CoursePath; nothing was sent or changed.`);
    }
  };

  const requestPreview = async (file: Chosen, revision: number) => {
    setPending('preview');
    setError(null);
    setPreview(null);
    try {
      const result = await accountEndpoints.previewBackup(session.api, { expected_revision: revision, backup: file.value });
      setPreview({ data: result.data, issues: result.issues });
    } catch (e) {
      setError({ stage: 'preview', error: asApiError(e) });
    } finally {
      setPending(null);
    }
  };

  const latestRecord = async () => {
    const fresh = await endpoints.record(session.api);
    if (session.user) cache.set(`record:${session.user.id}`, { data: fresh.data, issues: fresh.issues });
    return fresh.data;
  };

  const commit = async () => {
    if (!preview) return;
    setConfirming(false);
    setPending('commit');
    setError(null);
    try {
      const result = await accountEndpoints.commitBackup(session.api, preview.data.id, { expected_revision: preview.data.base_record_revision, confirm: true });
      setDone({ revision: result.data.revision, attempts: result.data.attempts.length, plans: preview.data.diff.plans_to_create });
      reset();
      // Reload the record and everything derived from it.
      cache.invalidate('record:');
      cache.invalidate('plan');
      cache.invalidate('analysis:');
    } catch (e) {
      setError({ stage: 'commit', error: asApiError(e) });
    } finally {
      setPending(null);
    }
  };

  const lookup = new Map<string, CourseAttempt>([...(record?.attempts ?? []), ...backupAttempts(chosen?.value)].map((a) => [a.id, a]));
  const conflict = error?.error.kind === 'conflict';
  const diff = preview?.data.diff;

  return (
    <section aria-labelledby="restore-heading">
      <h3 id="restore-heading">Restore from a backup</h3>
      <p>
        Restoring replaces your saved record (attempts, current enrolment and source-reported totals) with the one in the backup, and adds the backup’s plans as
        new plans. Scenarios are not restored. You see the changes first; nothing changes until you confirm. A backup restores only into the account that made
        it.
      </p>
      <div className="field">
        <label htmlFor={inputId}>Backup file (.json)</label>
        <input key={fileKey} id={inputId} type="file" accept="application/json,.json" onChange={choose} aria-invalid={Boolean(fileError)} />
      </div>
      {fileError ? (
        <p className="callout" data-tone="danger" role="alert">
          {fileError}
        </p>
      ) : null}
      {chosen && !preview ? (
        <button type="button" className="btn btn-primary" disabled={!record || pending !== null} onClick={() => record && requestPreview(chosen, record.revision)}>
          {pending === 'preview' ? 'Checking backup…' : 'Preview restore'}
        </button>
      ) : null}

      {preview && diff ? (
        <section className="panel" aria-label="Restore preview">
          <h4>What restoring would change</h4>
          <p className="muted">
            Compared with your saved record. This preview expires {formatTimestamp(preview.data.expires_at)}.
          </p>
          <RestoreDiff diff={diff} lookup={lookup} />
          {preview.issues.length > 0 ? <IssueList issues={preview.issues} headingLevel={4} /> : null}
          <div className="panel-row">
            <button type="button" className="btn btn-danger" disabled={pending !== null} onClick={() => setConfirming(true)}>
              {pending === 'commit' ? 'Restoring…' : 'Restore this backup…'}
            </button>
            <button type="button" className="btn" disabled={pending !== null} onClick={reset}>
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      {done ? (
        <p className="callout" role="status">
          Backup restored. Your record now has {done.attempts} courses; {done.plans} {done.plans === 1 ? 'plan was' : 'plans were'} added.
        </p>
      ) : null}

      {conflict && error && chosen ? (
        <ConflictPanel
          conflictRevision={error.error.currentRevision}
          draftSummary={
            <p>
              Restore from <span className="mono">{chosen.name}</span>. It was not applied.
            </p>
          }
          onCompare={async () => {
            const fresh = await latestRecord();
            return (
              <p>
                {fresh.attempts.length} courses.
              </p>
            );
          }}
          onReload={async () => {
            await latestRecord();
            reset();
          }}
          onKeepMine={async () => {
            // A new preview against the latest revision; the student still has to confirm it.
            const fresh = await latestRecord();
            await requestPreview(chosen, fresh.revision);
          }}
        />
      ) : error && !conflict ? (
        <ServerFailure title={error.stage === 'preview' ? 'This backup cannot be restored. Your saved record was not changed.' : 'The restore did not complete. Your saved record was not changed.'} error={error.error} />
      ) : null}

      <ConfirmDialog open={confirming} title="Replace your saved record?" confirmLabel="Replace record and restore" danger onConfirm={commit} onCancel={() => setConfirming(false)}>
        {diff ? (
          <p>
            Your saved record will be replaced by the backup: {diff.attempts_added.length} courses added,{' '}
            {diff.attempts_removed.length} removed and {diff.attempts_changed.length} changed. {diff.plans_to_create} plans will be created;{' '}
            {diff.scenarios_not_restored} scenarios are not restored. This cannot be undone except by restoring another backup.
          </p>
        ) : null}
      </ConfirmDialog>
    </section>
  );
}

// -------------------------------------------------------------------- delete

function DeletedCounts({ result }: { result: DeleteDataResult }) {
  return (
    <>
      <ul aria-label="Deleted items">
        {Object.entries(result.deleted).map(([key, count]) => (
          <li key={key}>
            {humanize(key)}: <span className="num">{count}</span>
          </li>
        ))}
      </ul>
      <p>
        <strong>Retention:</strong> {result.retention}
      </p>
    </>
  );
}

function deleteFailure(error: ApiError, googleOnly: boolean): string {
  if (error.code === 'REAUTH_FAILED')
    return googleOnly
      ? 'Google could not confirm that this is your account. Nothing was deleted.'
      : 'Your current password was not accepted. Nothing was deleted.';
  if (error.kind === 'throttled') return 'Too many attempts. Wait and try again later. Nothing was deleted.';
  if (error.kind === 'network')
    return 'The CoursePath server could not be reached, so CoursePath cannot confirm whether anything was deleted. Reload this page to check your record.';
  return 'The server did not delete your data. Nothing was deleted.';
}

function DeleteData({ record }: { record: AcademicRecord | null }) {
  const session = useSession();
  const cache = useResourceCache();
  const navigate = useNavigate();
  const phraseId = useId();
  const accountId = useId();
  const [password, setPassword] = useState('');
  // The account says how it re-authenticates (`reauth`); the site-wide sign-in options only say whether Google is available. A Google-only account has
  // no password and confirms with a fresh Google credential; a legacy password account always keeps its password, even where Google is configured.
  const googleClientId = session.user?.reauth === 'google' ? session.signIn.google_client_id : null;
  const googleOnly = googleClientId !== null;
  const [googleCredential, setGoogleCredential] = useState('');
  const proof = googleOnly ? googleCredential : password;
  const [phrase, setPhrase] = useState('');
  const [deleteAccount, setDeleteAccount] = useState(false);
  const [errors, setErrors] = useState<{ password?: string; phrase?: string }>({});
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<DeleteDataResult | null>(null);
  const [revision, setRevision] = useState<number | null>(null);
  const expected = revision ?? record?.revision ?? null;

  const review = (event: FormEvent) => {
    event.preventDefault();
    const next = {
      password: proof ? undefined : googleOnly ? 'Confirm with your IITGN Google account first.' : 'Enter your current password.',
      phrase: phrase.trim() === DELETE_PHRASE ? undefined : `Type “${DELETE_PHRASE}” exactly to confirm.`,
    };
    setErrors(next);
    if (next.password || next.phrase || expected === null) return;
    setError(null);
    setResult(null);
    setConfirming(true);
  };

  const remove = async () => {
    if (expected === null) return;
    setConfirming(false);
    setPending(true);
    setError(null);
    try {
      const response = await accountEndpoints.deleteData(session.api, {
        expected_revision: expected,
        ...(googleOnly ? { google_credential: googleCredential } : { password }),
        confirm: DELETE_PHRASE,
        delete_account: deleteAccount,
      });
      const data = response.data;
      setPassword('');
      setGoogleCredential('');
      setPhrase('');
      setRevision(null);
      previewStore.clear();
      if (data.account_deleted) {
        await session.forgetSession(
          <>
            <p>
              <strong>Your CoursePath account and its data were deleted, and you are signed out.</strong>
            </p>
            <DeletedCounts result={data} />
          </>,
        );
        navigate('/', { replace: true });
        return;
      }
      setResult(data);
      cache.invalidate('record:');
      cache.invalidate('plan');
      cache.invalidate('analysis:');
    } catch (e) {
      const failure = asApiError(e);
      if (failure.code === 'REAUTH_FAILED') {
        setPassword('');
        setGoogleCredential('');
      }
      setError(failure);
    } finally {
      setPending(false);
    }
  };

  const revisionConflict = error?.kind === 'conflict' && error.code !== 'ACCOUNT_HAS_VERIFICATIONS';

  return (
    <section aria-labelledby="delete-heading" className="danger-zone">
      <h3 id="delete-heading">Delete my data</h3>
      <p>Deleting removes from CoursePath:</p>
      <ul>
        <li>every course attempt in your record, with its source evidence and corrections;</li>
        <li>your confirmed current enrolment;</li>
        <li>the source-reported totals saved from your imports;</li>
        <li>all your plans and scenarios;</li>
        <li>any import previews still waiting for review;</li>
        <li>any approval evidence attached to your account.</li>
      </ul>
      <p>
        Your account stays, with an empty record, unless you also tick “Delete my account too”. That also deletes your {googleOnly ? 'account' : 'username and password'} and signs you out
        on every device. Download a backup first if you may want this data again.
      </p>
      <blockquote cite="server/README.md">
        <p>{README_RETENTION}</p>
        <footer className="muted">— CoursePath server documentation (server/README.md)</footer>
      </blockquote>

      <form onSubmit={review} noValidate className="form-narrow">
        {googleClientId !== null ? (
          <div className="field">
            <p id={`${phraseId}-google`}>Confirm that this is you by choosing your IITGN Google account.</p>
            <GoogleSignIn clientId={googleClientId} text="continue_with" onCredential={setGoogleCredential} />
            {googleCredential ? (
              <p className="muted" role="status">
                Confirmed with your Google account.
              </p>
            ) : errors.password ? (
              <span className="field-error">{errors.password}</span>
            ) : null}
          </div>
        ) : (
          <PasswordField label="Current password for deletion" value={password} onChange={setPassword} autoComplete="current-password" error={errors.password} />
        )}
        <div className="field">
          <label htmlFor={phraseId}>Type “{DELETE_PHRASE}” to confirm</label>
          <input
            id={phraseId}
            type="text"
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={Boolean(errors.phrase)}
            aria-describedby={errors.phrase ? `${phraseId}-err` : undefined}
          />
          {errors.phrase ? (
            <span className="field-error" id={`${phraseId}-err`}>
              {errors.phrase}
            </span>
          ) : null}
        </div>
        <div className="field checkbox-row">
          <label htmlFor={accountId}>
            <input id={accountId} type="checkbox" checked={deleteAccount} onChange={(e) => setDeleteAccount(e.target.checked)} /> Delete my account too
          </label>
        </div>
        <button type="submit" className="btn btn-danger" disabled={pending || expected === null}>
          {pending ? 'Deleting…' : deleteAccount ? 'Delete my data and account…' : 'Delete my data…'}
        </button>
      </form>

      {result ? (
        <div className="callout" role="status">
          <p>
            <strong>Your data was deleted.</strong> Your record is now empty. Your account remains.
          </p>
          <DeletedCounts result={result} />
        </div>
      ) : null}

      {revisionConflict && error ? (
        <ConflictPanel
          conflictRevision={error.currentRevision}
          draftSummary={<p>Your deletion request was not applied: nothing was deleted.</p>}
          onReload={async () => {
            cache.invalidate('record:');
            setRevision(null);
            setError(null);
          }}
          onKeepMine={async () => {
            // Take the newer revision, then the student confirms the deletion again.
            const fresh = await endpoints.record(session.api);
            setRevision(fresh.data.revision);
            setError(null);
            if (proof && phrase.trim() === DELETE_PHRASE) setConfirming(true);
          }}
        />
      ) : error ? (
        <ServerFailure title={deleteFailure(error, googleOnly)} error={error} />
      ) : null}

      <ConfirmDialog
        open={confirming}
        title={deleteAccount ? 'Delete your data and account now?' : 'Delete your data now?'}
        confirmLabel={deleteAccount ? 'Delete data and account' : 'Delete my data'}
        danger
        onConfirm={remove}
        onCancel={() => setConfirming(false)}
      >
        <p>
          This permanently removes every attempt, your current enrolment, reported totals, plans, scenarios, import previews and approval evidence
          {deleteAccount ? ', and your account. You will be signed out everywhere.' : '. Your account remains with an empty record.'}
        </p>
        <p>It cannot be undone except by restoring a backup{deleteAccount ? ' into a new account with the same username' : ''}.</p>
      </ConfirmDialog>
    </section>
  );
}

export function YourData() {
  const record = useRecord();
  return (
    <section className="panel stack" aria-labelledby="your-data-heading">
      <h2 id="your-data-heading">Your data</h2>
      <DownloadBackup />
      <RestoreBackup record={record.data} />
      <DeleteData record={record.data} />
    </section>
  );
}
