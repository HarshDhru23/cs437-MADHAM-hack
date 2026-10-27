import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { endpoints } from '../../api/endpoints';
import { useRecord } from '../../api/hooks';
import { useResourceCache } from '../../api/resources';
import type { AcademicRecord, CompletionStatus, CourseAttempt, CurrentEnrolment } from '../../api/types';
import { useSaveQueue } from '../../api/useSaveQueue';
import { RECORD_TABS, SubNav } from '../../app/AppShell';
import { useSession } from '../../app/session';
import { usePublishView } from '../../app/viewContext';
import { ConflictPanel } from '../../components/ConflictPanel';
import { Dialog } from '../../components/Dialog';
import { DataTable } from '../../components/DataTable';
import { SaveStatusIndicator } from '../../components/SaveStatusIndicator';
import { SourcePanel } from '../../components/SourcePanel';
import { ErrorPanel, StatePanel } from '../../components/StatePanel';
import { Badge } from '../../components/StatusBadge';
import { compareTerms, describeCorrection, formatCredits, formatTerm, formatTimestamp, humanize } from '../../lib/format';
import { latestCompletedTerm, nextRegularTerm } from '../../lib/terms';

const STATUS_LABEL: Record<CompletionStatus, string> = {
  completed: 'Completed',
  in_progress: 'In progress',
  failed: 'Failed / not completed',
  withdrawn: 'Withdrawn',
  incomplete: 'Incomplete',
  unknown: 'Unknown',
};

function newId(prefix: string): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}

function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, ' ').replace(/^([A-Z]{2,4})\s?(\d)/, '$1 $2');
}

export function RecordPage() {
  const record = useRecord();
  const cache = useResourceCache();
  const { api, user } = useSession();
  const [editing, setEditing] = useState<CourseAttempt | null>(null);
  const [adding, setAdding] = useState(false);
  const [source, setSource] = useState<CourseAttempt | null>(null);
  usePublishView({ ruleVersion: record.data?.profile.curriculum_version ?? null, dataMode: 'actual', recordRevision: record.data?.revision ?? null });

  const onSaved = (next: AcademicRecord) => {
    cache.set(`record:${user?.id}`, { data: next, issues: [] });
    cache.invalidate('analysis:');
  };

  if (record.loading) return <StatePanel kind="loading" title="Loading your record…" />;
  if (record.error || !record.data) return record.error ? <ErrorPanel error={record.error} onRetry={record.reload} /> : null;
  const data = record.data;
  const completed = data.attempts;
  const terms = [...new Set(completed.map((a) => a.term_id))].sort(compareTerms);
  const latestCompleted = latestCompletedTerm(completed);

  const submitAttempts = async (attempts: CourseAttempt[], justifications?: Record<string, string>) => {
    const result = await endpoints.patchRecord(api, { expected_revision: data.revision, attempts, ...(justifications ? { correction_justifications: justifications } : {}) });
    onSaved(result.data);
    record.reload();
  };

  return (
    <div>
      <SubNav label="My record" items={RECORD_TABS} />
      <h1>My record</h1>
      <dl className="summary-grid">
        <div>
          <dt>Record revision</dt>
          <dd>{data.revision}</dd>
        </div>
        <div>
          <dt>Last updated</dt>
          <dd>{data.updated_at ? formatTimestamp(data.updated_at) : <small>Update time not reported by the server</small>}</dd>
        </div>
        <div>
          <dt>Latest completed term</dt>
          <dd>{latestCompleted ? formatTerm(latestCompleted) : 'None'}</dd>
        </div>
        <div>
          <dt>Attempts</dt>
          <dd>{completed.length}</dd>
        </div>
      </dl>
      {data.reported_controls.length > 0 ? (
        <p className="muted">
          Imported from {data.reported_controls.length} source document(s); the latest import was accepted at record revision{' '}
          {data.reported_controls.at(-1)?.record_revision_at_import}.
        </p>
      ) : null}

      {completed.length === 0 ? (
        <div className="panel panel-row">
          <p style={{ margin: 0 }}>No accepted attempts yet.</p>
          <Link className="btn btn-primary" to="/record/import">
            Import transcript or IMS grades
          </Link>
          <button type="button" className="btn" onClick={() => setAdding(true)}>
            Add an attempt
          </button>
        </div>
      ) : null}

      <section aria-label="Completed history" className="stack">
        <div className="panel-row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Completed history</h2>
          {completed.length > 0 ? (
            <div className="panel-row">
              <Link className="btn" to="/record/import">
                Import again
              </Link>
              <button type="button" className="btn" onClick={() => setAdding(true)}>
                Add an attempt
              </button>
            </div>
          ) : null}
        </div>
        <p className="muted">Every attempt is kept, including failed attempts and repeated registrations. Corrections keep the original source text.</p>
        {terms.map((term) => (
          <DataTable
            key={term}
            caption={formatTerm(term)}
            rows={completed.filter((a) => a.term_id === term)}
            rowKey={(a) => a.id}
            rowProps={(a) => ({ 'data-changed': a.user_corrections.length > 0 ? 'true' : undefined })}
            columns={[
              { key: 'code', header: 'Code', rowHeader: true, render: (a) => <span className="mono">{a.normalized_code}</span> },
              { key: 'title', header: 'Title', render: (a) => a.title },
              { key: 'credits', header: 'Credits', numeric: true, render: (a) => formatCredits(a.credits) },
              { key: 'grade', header: 'Grade', render: (a) => a.grade || <span className="muted">Blank</span> },
              { key: 'status', header: 'Status', render: (a) => STATUS_LABEL[a.completion_status] ?? a.completion_status },
              {
                key: 'class',
                header: 'Classification',
                render: (a) => (
                  <>
                    {a.course_version_id ? <Badge tone="success">Catalogue matched</Badge> : <Badge tone="unknown" symbol="?">Not matched to a reviewed catalogue</Badge>}{' '}
                    {a.learning_designation === 'unknown' ? <span className="muted">Designation unknown</span> : humanize(a.learning_designation)}
                    {a.user_corrections.length > 0 ? (
                      <>
                        {' '}
                        <Badge tone="warning" symbol="✎">{`Corrected (${a.user_corrections.length})`}</Badge>
                      </>
                    ) : null}
                  </>
                ),
              },
              {
                key: 'actions',
                header: 'Actions',
                render: (a) => (
                  <div className="panel-row">
                    <button type="button" className="btn btn-small" aria-label={`Correct ${a.normalized_code} (${formatTerm(a.term_id)})`} onClick={() => setEditing(a)}>
                      Correct
                    </button>
                    <button type="button" className="btn btn-small btn-quiet" aria-label={`Source for ${a.normalized_code} (${formatTerm(a.term_id)})`} onClick={() => setSource(a)}>
                      Source
                    </button>
                  </div>
                ),
              },
            ]}
          />
        ))}
      </section>

      <CurrentEnrolmentSection record={data} onSaved={onSaved} latestCompleted={latestCompleted} />

      {editing ? (
        <AttemptDialog
          title={`Correct ${editing.normalized_code}`}
          initial={editing}
          requireJustification
          submitLabel="Save correction"
          onClose={() => setEditing(null)}
          onSubmit={async (next, justification) => {
            await submitAttempts(
              data.attempts.map((a) => (a.id === editing.id ? next : a)),
              { [editing.id]: justification },
            );
            setEditing(null);
          }}
        />
      ) : null}
      {adding ? (
        <AttemptDialog
          title="Add an attempt"
          submitLabel="Add attempt"
          initial={null}
          defaultTerm={latestCompleted ?? `${data.profile.admission_year}-${String((data.profile.admission_year + 1) % 100).padStart(2, '0')}-I`}
          onClose={() => setAdding(false)}
          onSubmit={async (next) => {
            await submitAttempts([...data.attempts, next]);
            setAdding(false);
          }}
        />
      ) : null}
      <Dialog open={source !== null} title={source ? `Source for ${source.normalized_code}` : 'Source'} onClose={() => setSource(null)} variant="drawer">
        {source ? (
          <>
            <SourcePanel refs={source.source_refs} />
            {source.original ? (
              <p>
                Original values: code <span className="mono">{source.original.code ?? '—'}</span>, title “{source.original.title ?? '—'}”, credits {formatCredits(source.original.credits)}, grade{' '}
                {source.original.grade || 'blank'}.
              </p>
            ) : null}
            {source.user_corrections.length > 0 ? (
              <>
                <h3>Corrections</h3>
                <ul>
                  {source.user_corrections.map((c, i) => (
                    <li key={i}>
                      {describeCorrection(c)} — {c.justification}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            <p className="muted">A correction fixes a transcription error. It does not approve a course equivalence or substitution.</p>
          </>
        ) : null}
      </Dialog>
    </div>
  );
}

function AttemptDialog({
  title,
  initial,
  requireJustification,
  submitLabel,
  onClose,
  onSubmit,
  defaultTerm,
}: {
  title: string;
  initial: CourseAttempt | null;
  requireJustification?: boolean;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (attempt: CourseAttempt, justification: string) => Promise<void>;
  defaultTerm?: string;
}) {
  const id = useId();
  const [code, setCode] = useState(initial?.normalized_code ?? '');
  const [titleText, setTitleText] = useState(initial?.title ?? '');
  const [credits, setCredits] = useState(initial?.credits ?? '');
  const [grade, setGrade] = useState(initial?.grade ?? '');
  const [term, setTerm] = useState(initial?.term_id ?? defaultTerm ?? '');
  const [status, setStatus] = useState<CompletionStatus>(initial?.completion_status ?? 'completed');
  const [justification, setJustification] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^[A-Z]{2,4} \d{3}[A-Z]?(\([A-Z]\))?$/.test(normalizeCode(code))) return setError('Enter a course code such as "CS 330".');
    if (!titleText.trim()) return setError('Enter the course title.');
    if (!/^\d+(\.\d+)?$/.test(credits.trim())) return setError('Enter credits as a number, for example 4 or 1.5.');
    if (!/^\d{4}-\d{2}-(I|II|SUMMER)$/.test(term)) return setError('Enter the term as, for example, 2025-26-II.');
    if (requireJustification && !justification.trim()) return setError('Explain what you checked before correcting a record.');
    setError(null);
    const next: CourseAttempt = initial
      ? { ...initial, normalized_code: normalizeCode(code), title: titleText.trim(), credits: credits.trim(), grade: grade.trim(), term_id: term, completion_status: status }
      : {
          id: newId('manual'),
          normalized_code: normalizeCode(code),
          original_code: normalizeCode(code),
          title: titleText.trim(),
          credits: credits.trim(),
          grade: grade.trim().toUpperCase(),
          term_id: term,
          completion_status: status,
          learning_designation: 'unknown',
          course_version_id: null,
          instance_id: null,
          source_refs: [],
          user_corrections: [],
          approval_refs: [],
        };
    setPending(true);
    try {
      await onSubmit(next, justification.trim());
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.kind === 'conflict'
            ? 'Your record was changed elsewhere. Close this dialog, reload the page and try again; your typed values are still shown here.'
            : `The server did not accept this change: ${e.message}`
          : String(e),
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open title={title} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="inline-fields">
          <div className="field">
            <label htmlFor={`${id}-code`}>Course code</label>
            <input id={`${id}-code`} type="text" value={code} onChange={(e) => setCode(e.target.value)} data-changed={initial && code !== initial.normalized_code ? 'true' : undefined} />
          </div>
          <div className="field">
            <label htmlFor={`${id}-credits`}>Credits</label>
            <input id={`${id}-credits`} type="text" inputMode="decimal" value={credits} onChange={(e) => setCredits(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor={`${id}-title`}>Title</label>
          <input id={`${id}-title`} type="text" value={titleText} onChange={(e) => setTitleText(e.target.value)} />
        </div>
        <div className="inline-fields">
          <div className="field">
            <label htmlFor={`${id}-term`}>Term</label>
            <input id={`${id}-term`} type="text" value={term} onChange={(e) => setTerm(e.target.value.toUpperCase().replace('SEMESTER', '').trim())} placeholder="2025-26-II" />
          </div>
          <div className="field">
            <label htmlFor={`${id}-status`}>Status</label>
            <select id={`${id}-status`} value={status} onChange={(e) => setStatus(e.target.value as CompletionStatus)}>
              <option value="completed">Completed</option>
              <option value="in_progress">In progress</option>
              <option value="failed">Failed / not completed</option>
              <option value="withdrawn">Withdrawn</option>
              <option value="incomplete">Incomplete</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor={`${id}-grade`}>Grade</label>
            <input id={`${id}-grade`} type="text" value={grade} onChange={(e) => setGrade(e.target.value)} />
          </div>
        </div>
        {requireJustification ? (
          <div className="field">
            <label htmlFor={`${id}-why`}>Justification (what did you check?)</label>
            <textarea id={`${id}-why`} value={justification} onChange={(e) => setJustification(e.target.value)} style={{ minHeight: '5rem' }} />
          </div>
        ) : null}
        <p className="muted">The server decides whether the grade and status are consistent and how the attempt counts.</p>
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="dialog-actions" style={{ padding: 0, border: 'none' }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? 'Saving…' : submitLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function CurrentEnrolmentSection({ record, onSaved, latestCompleted }: { record: AcademicRecord; onSaved: (r: AcademicRecord) => void; latestCompleted: string | null }) {
  const { api, user } = useSession();
  const id = useId();
  const defaultTerm = (latestCompleted && nextRegularTerm(latestCompleted)) ?? '';
  const queue = useSaveQueue<CurrentEnrolment[]>(
    user ? `enrolment:${user.id}` : null,
    { value: record.current_enrolment, revision: record.revision },
    async (draft, revision, signal) => {
      const result = await endpoints.patchRecord(api, { expected_revision: revision, current_enrolment: draft }, { signal });
      onSaved(result.data);
      return { value: result.data.current_enrolment, revision: result.data.revision };
    },
  );
  const [code, setCode] = useState('');
  const [credits, setCredits] = useState('');
  const [term, setTerm] = useState(defaultTerm);
  const [sections, setSections] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Adopt newer server revisions (e.g. after a correction) when no local draft is pending.
  useEffect(() => {
    if (queue.state && queue.state.draft === null && record.revision > queue.state.revision) queue.reload(record.current_enrolment, record.revision);
  }, [record.revision, record.current_enrolment, queue]);

  const items = useMemo(() => queue.value ?? record.current_enrolment, [queue.value, record.current_enrolment]);

  const add = (event: FormEvent) => {
    event.preventDefault();
    const normalized = normalizeCode(code);
    if (!/^[A-Z]{2,4} \d{3}[A-Z]?(\([A-Z]\))?$/.test(normalized)) return setError('Enter a course code such as "CS 330".');
    if (!/^\d+(\.\d+)?$/.test(credits.trim())) return setError('Enter credits as a number, for example 4.');
    if (!/^\d{4}-\d{2}-(I|II|SUMMER)$/.test(term)) return setError('Enter the term, for example 2026-27-I.');
    if (!confirmed) return setError('Confirm that you are enrolled in this course this term.');
    setError(null);
    const sectionIds = sections
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    queue.edit([...items, { id: newId('enrol'), normalized_code: normalized, term_id: term, credits: credits.trim(), confirmed: true, ...(sectionIds.length ? { section_ids: sectionIds } : {}) }]);
    setCode('');
    setCredits('');
    setSections('');
    setConfirmed(false);
  };

  const reloadFromServer = async () => {
    const fresh = await endpoints.record(api);
    onSaved(fresh.data);
    queue.reload(fresh.data.current_enrolment, fresh.data.revision);
  };

  const summary = (list: CurrentEnrolment[]) =>
    list.length === 0 ? (
      <p className="muted">No courses.</p>
    ) : (
      <ul>
        {list.map((e) => (
          <li key={e.id}>
            <span className="mono">{e.normalized_code}</span> · {formatTerm(e.term_id)} · {formatCredits(e.credits)} credits
          </li>
        ))}
      </ul>
    );

  return (
    <section aria-label="Current enrolment" className="panel">
      <div className="panel-row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Current enrolment</h2>
        {queue.state ? <SaveStatusIndicator status={queue.state.status} revision={queue.state.revision} savedAt={queue.state.savedAt} /> : null}
      </div>
      <p className="muted">
        Current enrolment is never filled in automatically from a transcript or example plan. Add only courses you are actually registered for this term.
      </p>
      {queue.state?.status === 'conflict' ? (
        <ConflictPanel
          conflictRevision={queue.state.conflictRevision}
          draftSummary={summary(items)}
          onCompare={async () => summary((await endpoints.record(api)).data.current_enrolment)}
          onReload={reloadFromServer}
          onKeepMine={async () => {
            const fresh = await endpoints.record(api);
            queue.keepMineOver(fresh.data.revision);
          }}
        />
      ) : null}
      {queue.state?.status === 'error' || queue.state?.status === 'offline' ? (
        <div className="callout" data-tone="warning" role="alert">
          {queue.state.error?.message ?? 'Not saved.'}{' '}
          <button type="button" className="btn btn-small" onClick={() => queue.retry()}>
            Retry save
          </button>
        </div>
      ) : null}
      {items.length === 0 ? (
        <p>No confirmed current courses.</p>
      ) : (
        <DataTable
          caption="Confirmed current courses"
          rows={items}
          rowKey={(e) => e.id}
          columns={[
            { key: 'code', header: 'Code', rowHeader: true, render: (e) => <span className="mono">{e.normalized_code}</span> },
            { key: 'term', header: 'Term', render: (e) => formatTerm(e.term_id) },
            { key: 'credits', header: 'Credits', numeric: true, render: (e) => formatCredits(e.credits) },
            { key: 'sections', header: 'Sections', render: (e) => (e.section_ids?.length ? e.section_ids.join(', ') : <span className="muted">Not specified</span>) },
            {
              key: 'remove',
              header: 'Actions',
              render: (e) => (
                <button type="button" className="btn btn-small" aria-label={`Remove ${e.normalized_code} from current enrolment`} onClick={() => queue.edit(items.filter((x) => x.id !== e.id))}>
                  Remove
                </button>
              ),
            },
          ]}
        />
      )}
      <form onSubmit={add} noValidate aria-label="Add current course">
        <div className="inline-fields">
          <div className="field">
            <label htmlFor={`${id}-code`}>Course code</label>
            <input id={`${id}-code`} type="text" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
          </div>
          <div className="field">
            <label htmlFor={`${id}-credits`}>Credits</label>
            <input id={`${id}-credits`} type="text" inputMode="decimal" value={credits} onChange={(e) => setCredits(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={`${id}-term`}>Term</label>
            <input id={`${id}-term`} type="text" value={term} onChange={(e) => setTerm(e.target.value.trim().toUpperCase())} />
          </div>
          <div className="field">
            <label htmlFor={`${id}-sec`}>Sections (optional, comma separated)</label>
            <input id={`${id}-sec`} type="text" value={sections} onChange={(e) => setSections(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> I confirm I am enrolled in this course this term
          </label>
        </div>
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="btn btn-primary">
          Add to current enrolment
        </button>
      </form>
    </section>
  );
}
