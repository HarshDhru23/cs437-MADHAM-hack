import { Fragment, useId, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { endpoints } from '../../api/endpoints';
import { useRecord } from '../../api/hooks';
import { useResourceCache } from '../../api/resources';
import type { CandidateResolution, CourseAttempt, DiffEntry, Issue } from '../../api/types';
import { useSession } from '../../app/session';
import { usePublishView } from '../../app/viewContext';
import { IssueList, visibleIssues } from '../../components/IssueList';
import { Badge, SeverityBadge } from '../../components/StatusBadge';
import { compareTerms, describeCorrection, formatCredits, formatTerm, humanize, plainMessage } from '../../lib/format';
import { isDecimalString } from '../../lib/validation';
import { importDraftStore } from './draftStore';
import { Steps } from './ImportPage';
import { previewStore } from './previewStore';
import './import.css';

type EditableField = 'normalized_code' | 'title' | 'credits' | 'grade' | 'term_id';
const FIELDS: { key: EditableField; label: string }[] = [
  { key: 'normalized_code', label: 'Code' },
  { key: 'title', label: 'Title' },
  { key: 'credits', label: 'Credits' },
  { key: 'grade', label: 'Grade' },
  { key: 'term_id', label: 'Term' },
];

interface Correction {
  fields: Partial<Record<EditableField, string>>;
  justification: string;
}

export function ReviewPage() {
  const { preview_id: previewId = '' } = useParams();
  const session = useSession();
  const stored = previewStore.get(previewId, session.user?.id);
  usePublishView({ dataMode: 'none' });
  if (!stored) {
    return (
      <section className="panel">
        <Steps current="review" />
        <h1>This review is no longer available</h1>
        <p>
          Import previews are kept only in the tab that created them and expire after an hour. After a reload, sign-out or expiry, or for a preview from
          another account, start again. Your saved record has not been changed.
        </p>
        <Link className="btn btn-primary" to="/record/import">
          Start a new import
        </Link>
      </section>
    );
  }
  return <Review key={previewId} previewId={previewId} stored={stored} />;
}

function Review({ previewId, stored }: { previewId: string; stored: NonNullable<ReturnType<typeof previewStore.get>> }) {
  const { preview, issues: previewIssues } = stored;
  const session = useSession();
  const cache = useResourceCache();
  const navigate = useNavigate();
  const record = useRecord();
  const candidates = preview.candidate_attempts;
  const [included, setIncluded] = useState<Set<string>>(() => new Set(candidates.map((c) => c.id)));
  const [corrections, setCorrections] = useState<Record<string, Correction>>({});
  const [decisions, setDecisions] = useState<Record<string, { action: 'keep_existing' | 'accept_incoming'; justification: string }>>({});
  const [omitUnparsed, setOmitUnparsed] = useState(false);
  const [unparsedReason, setUnparsedReason] = useState('');
  const [totalsAck, setTotalsAck] = useState(false);
  const [totalsReason, setTotalsReason] = useState('');
  const [filter, setFilter] = useState<'all' | 'review'>('all');
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [commitError, setCommitError] = useState<ApiError | null>(null);

  const diffById = useMemo(() => new Map(preview.diff.map((d) => [d.candidate_id, d])), [preview.diff]);
  // The server's diff names the saved attempt; its values come from the accepted record.
  const savedById = useMemo(() => new Map((record.data?.attempts ?? []).map((a) => [a.id, a])), [record.data]);
  const allIssues: Issue[] = [...previewIssues, ...(commitError?.issues ?? [])];
  const issuesFor = (id: string) => visibleIssues(allIssues.filter((i) => i.entity_refs.includes(id)));
  const conflicts = preview.diff.filter((d) => d.status === 'conflicting');
  const needsTotalsAck = allIssues.some((i) => i.code === 'IMPORT_TOTAL_MISMATCH');
  const flagged = (c: CourseAttempt) => issuesFor(c.id).length > 0 || diffById.get(c.id)?.status === 'conflicting' || !included.has(c.id) || Boolean(corrections[c.id]);
  const visible = filter === 'all' ? candidates : candidates.filter(flagged);
  const terms = [...new Set(candidates.map((c) => c.term_id))].sort(compareTerms);
  const counts = { new: 0, unchanged: 0, conflicting: 0 } as Record<string, number>;
  for (const d of preview.diff) counts[d.status] = (counts[d.status] ?? 0) + 1;

  const blockers: string[] = [];
  if (preview.unparsed_rows.length > 0 && !(omitUnparsed && unparsedReason.trim()))
    blockers.push(`Decide what to do with ${preview.unparsed_rows.length} unreadable line${preview.unparsed_rows.length === 1 ? '' : 's'} (omit with a reason, or fix the input and import again).`);
  for (const d of conflicts) {
    if (!included.has(d.candidate_id)) continue; // an excluded incoming row leaves the saved attempt as it is
    const decision = decisions[d.candidate_id];
    if (!decision) blockers.push(`Resolve the conflict for ${candidates.find((c) => c.id === d.candidate_id)?.normalized_code ?? d.candidate_id}.`);
    else if (decision.action === 'accept_incoming' && !decision.justification.trim()) blockers.push('Give a reason for accepting each changed incoming row.');
  }
  if (needsTotalsAck && !(totalsAck && totalsReason.trim())) blockers.push('Acknowledge the totals discrepancy with a reason.');
  if (included.size === 0) blockers.push('Include at least one row.');

  const confirm = async () => {
    if (!session.user) return;
    const resolutions: Record<string, CandidateResolution> = {};
    for (const [id, c] of Object.entries(corrections)) if (included.has(id)) resolutions[id] = { fields: c.fields, justification: c.justification };
    for (const [id, d] of Object.entries(decisions)) {
      if (!included.has(id)) continue;
      resolutions[id] = { ...(resolutions[id] ?? {}), action: d.action, ...(d.action === 'accept_incoming' ? { justification: d.justification } : {}) };
    }
    if (preview.unparsed_rows.length > 0 && omitUnparsed) resolutions._unparsed = { action: 'omit', justification: unparsedReason.trim() };
    if (needsTotalsAck && totalsAck) resolutions._totals = { action: 'acknowledge', justification: totalsReason.trim() };
    setPending(true);
    setCommitError(null);
    try {
      const result = await endpoints.commitImport(session.api, previewId, {
        expected_revision: preview.base_record_revision,
        accepted_candidate_ids: candidates.filter((c) => included.has(c.id)).map((c) => c.id),
        resolutions,
      });
      cache.set(`record:${session.user.id}`, { data: result.data, issues: result.issues });
      cache.invalidate('analysis:');
      previewStore.remove(previewId);
      importDraftStore.clear();
      navigate('/', { replace: true });
    } catch (e) {
      setCommitError(e instanceof ApiError ? e : new ApiError('server', 0, String(e), []));
    } finally {
      setPending(false);
    }
  };

  const restart = commitError && (commitError.kind === 'conflict' || commitError.kind === 'not_found' || commitError.code === 'PREVIEW_EXPIRED');

  return (
    <div className="import-flow">
      <Steps current="review" />
      <h1>Review imported rows</h1>
      <p>Check the courses below, fix anything that is wrong, then confirm. Nothing is saved until you confirm.</p>
      {preview.diff.length > 0 && (counts.unchanged || counts.conflicting) ? (
        <p className="muted">
          Compared with your saved record:{' '}
          {[counts.new ? `${counts.new} new` : '', counts.unchanged ? `${counts.unchanged} already saved` : '', counts.conflicting ? `${counts.conflicting} changed` : ''].filter(Boolean).join(', ')}.
        </p>
      ) : null}

      {commitError ? (
        <div className="callout" data-tone="danger" role="alert">
          <p>
            <strong>
              {commitError.kind === 'conflict'
                ? 'Your record changed since this preview was created (another tab or device saved).'
                : commitError.code === 'PREVIEW_EXPIRED'
                  ? 'This preview has expired.'
                  : commitError.kind === 'not_found'
                    ? 'This preview is not available for your account.'
                    : 'This import could not be saved.'}
            </strong>{' '}
            Your saved record was not changed.
          </p>
          <IssueList issues={commitError.issues} grouped={false} />
          {restart ? (
            <Link className="btn btn-primary" to="/record/import">
              Start a new import
            </Link>
          ) : null}
        </div>
      ) : null}

      {visibleIssues(previewIssues).length > 0 ? (
        <section className="panel" aria-label="Import issues">
          <h2>Check before confirming</h2>
          <IssueList issues={previewIssues} headingLevel={3} />
        </section>
      ) : null}

      {preview.unparsed_rows.length > 0 ? (
        <section className="panel" aria-label="Lines that could not be read">
          <h2>Lines that could not be read</h2>
          <ul>
            {preview.unparsed_rows.map((r, i) => (
              <li key={i}>
                {typeof r.page === 'number' ? `Page ${r.page} · ` : ''}
                {typeof r.line === 'number' ? `Line ${r.line}: ` : ''}
                <span className="mono">{r.raw ?? '(no text)'}</span>
                {r.reason ? ` — ${r.reason}` : ''}
              </li>
            ))}
          </ul>
          <div className="field">
            <label>
              <input type="checkbox" checked={omitUnparsed} onChange={(e) => setOmitUnparsed(e.target.checked)} /> Omit these lines from the import
            </label>
          </div>
          <div className="field">
            <label htmlFor="unparsed-reason">Reason for omitting</label>
            <input id="unparsed-reason" type="text" value={unparsedReason} onChange={(e) => setUnparsedReason(e.target.value)} />
          </div>
          <p className="muted">If a line is a real course, fix the source text and import again, or add the attempt manually after confirming.</p>
        </section>
      ) : null}

      {needsTotalsAck ? (
        <section className="panel" aria-label="Totals discrepancy">
          <h2>Totals do not match</h2>
          <p>The totals printed in your document differ from the courses read from it. Compare them before you confirm.</p>
          <div className="field">
            <label>
              <input type="checkbox" checked={totalsAck} onChange={(e) => setTotalsAck(e.target.checked)} /> I have compared the totals with my source document
            </label>
          </div>
          <div className="field">
            <label htmlFor="totals-reason">Reason</label>
            <input id="totals-reason" type="text" value={totalsReason} onChange={(e) => setTotalsReason(e.target.value)} />
          </div>
        </section>
      ) : null}

      <fieldset className="rv-filter">
        <legend className="visually-hidden">Show</legend>
        <div className="rv-seg" role="radiogroup" aria-label="Row filter">
          <label data-checked={filter === 'all' ? 'true' : undefined}>
            <input type="radio" name="row-filter" checked={filter === 'all'} onChange={() => setFilter('all')} /> All rows ({candidates.length})
          </label>
          <label data-checked={filter === 'review' ? 'true' : undefined}>
            <input type="radio" name="row-filter" checked={filter === 'review'} onChange={() => setFilter('review')} /> Rows needing review ({candidates.filter(flagged).length})
          </label>
        </div>
        {filter === 'review' && visible.length < candidates.length ? (
          <p className="muted">
            {candidates.length - visible.length} row{candidates.length - visible.length === 1 ? '' : 's'} hidden by this filter. Choose “All rows” to see them.
          </p>
        ) : null}
        {included.size < candidates.length ? (
          <p className="muted">
            {candidates.length - included.size} row{candidates.length - included.size === 1 ? '' : 's'} excluded; excluded rows stay listed so you can include them again.
          </p>
        ) : null}
      </fieldset>

      {terms.map((term) => {
        const rows = visible.filter((c) => c.term_id === term);
        if (rows.length === 0) return null;
        return (
          <div className="table-wrap review-table" key={term}>
            <table className="data stack-mobile">
              <caption>{formatTerm(term)}</caption>
              <thead>
                <tr>
                  <th scope="col">Include</th>
                  <th scope="col">Code / title</th>
                  <th scope="col" className="num">
                    Credits
                  </th>
                  <th scope="col">Grade / status</th>
                  <th scope="col">Status</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <CandidateRow
                    key={c.id}
                    candidate={c}
                    diff={diffById.get(c.id)}
                    saved={savedById.get(diffById.get(c.id)?.attempt_id ?? '')}
                    issues={issuesFor(c.id)}
                    included={included.has(c.id)}
                    correction={corrections[c.id]}
                    decision={decisions[c.id]}
                    editing={editing === c.id}
                    onToggle={(on) =>
                      setIncluded((s) => {
                        const n = new Set(s);
                        if (on) n.add(c.id);
                        else n.delete(c.id);
                        return n;
                      })
                    }
                    onEdit={() => setEditing(editing === c.id ? null : c.id)}
                    onApply={(corr) => {
                      setCorrections((all) => {
                        const next = { ...all };
                        if (Object.keys(corr.fields).length === 0) delete next[c.id];
                        else next[c.id] = corr;
                        return next;
                      });
                      setEditing(null);
                    }}
                    onDecide={(d) => setDecisions((all) => ({ ...all, [c.id]: d }))}
                  />
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      <section className="panel" aria-label="Confirm">
        <h2>Confirm record</h2>
        {blockers.length > 0 ? (
          <ul>
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        ) : (
          <p>Everything looks ready. Confirm to save these courses to your record.</p>
        )}
        <div className="panel-row">
          <button type="button" className="btn btn-primary" disabled={blockers.length > 0 || pending} onClick={confirm}>
            {pending ? 'Confirming…' : 'Confirm record'}
          </button>
          <Link to="/record/import">Back to import</Link>
        </div>
      </section>
    </div>
  );
}

function CandidateRow({
  candidate,
  diff,
  saved,
  issues,
  included,
  correction,
  decision,
  editing,
  onToggle,
  onEdit,
  onApply,
  onDecide,
}: {
  candidate: CourseAttempt;
  diff?: DiffEntry;
  saved?: CourseAttempt;
  issues: Issue[];
  included: boolean;
  correction?: Correction;
  decision?: { action: 'keep_existing' | 'accept_incoming'; justification: string };
  editing: boolean;
  onToggle: (on: boolean) => void;
  onEdit: () => void;
  onApply: (c: Correction) => void;
  onDecide: (d: { action: 'keep_existing' | 'accept_incoming'; justification: string }) => void;
}) {
  const value = (k: EditableField) => correction?.fields[k] ?? candidate[k] ?? '';
  const changed = (k: EditableField) => correction?.fields[k] !== undefined;
  const raw = (k: EditableField) => String(candidate[k] ?? '');
  const show = (k: EditableField, text: string) =>
    changed(k) ? (
      <>
        <mark>{text}</mark> <span className="muted">(was: {raw(k) || 'blank'})</span>
      </>
    ) : (
      text
    );
  return (
    <Fragment>
      <tr data-changed={correction ? 'true' : undefined} data-excluded={included ? undefined : 'true'} data-flagged={issues.length > 0 || diff?.status === 'conflicting' ? 'true' : undefined}>
        <td data-label="Include">
          <input type="checkbox" checked={included} onChange={(e) => onToggle(e.target.checked)} aria-label={`Include ${candidate.normalized_code}`} />
          {!included ? <span className="muted"> Excluded</span> : null}
        </td>
        <th scope="row" data-label="Code / title">
          <span className="mono">{candidate.normalized_code}</span>
          {changed('normalized_code') ? <> {show('normalized_code', value('normalized_code'))}</> : null}
          <div>{show('title', value('title'))}</div>
          {candidate.original_code && candidate.original_code !== candidate.normalized_code ? <div className="muted">Printed as {candidate.original_code}</div> : null}
        </th>
        <td data-label="Credits" className="num">
          {show('credits', formatCredits(value('credits')))}
        </td>
        <td data-label="Grade / status">
          {show('grade', value('grade') || 'Blank')} · {humanize(candidate.completion_status)}
          {changed('term_id') ? <div>Term: {show('term_id', formatTerm(value('term_id')))}</div> : null}
        </td>
        <td data-label="Status">
          {diff ? <Badge tone={diff.status === 'conflicting' ? 'danger' : 'neutral'} symbol={diff.status === 'new' ? '+' : undefined}>{diff.status === 'conflicting' ? 'Changed' : humanize(diff.status)}</Badge> : null}{' '}
          {issues.some((i) => i.code === 'UNMATCHED_COURSE') ? <Badge tone="unknown" symbol="?">Needs review</Badge> : null}
          {issues.map((i, n) => (
            <div key={n}>
              <SeverityBadge severity={i.severity} /> {plainMessage(i.message)}
            </div>
          ))}
          {diff?.status === 'conflicting' ? (
            included ? (
              <ConflictDecision candidate={candidate} existing={diff.existing ?? saved} decision={decision} onDecide={onDecide} />
            ) : (
              <p className="muted">Excluded — your saved version stays unchanged.</p>
            )
          ) : null}
        </td>
        <td data-label="Actions">
          <div className="panel-row">
            <button type="button" className="btn btn-small" aria-expanded={editing} aria-label={`Edit ${candidate.normalized_code}`} onClick={onEdit}>
              Edit
            </button>
          </div>
        </td>
      </tr>
      {editing ? (
        <tr>
          <td colSpan={6}>
            <InlineEditor candidate={candidate} correction={correction} onApply={onApply} onCancel={onEdit} />
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}

function ConflictDecision({
  candidate,
  existing,
  decision,
  onDecide,
}: {
  candidate: CourseAttempt;
  existing?: Partial<CourseAttempt>;
  decision?: { action: 'keep_existing' | 'accept_incoming'; justification: string };
  onDecide: (d: { action: 'keep_existing' | 'accept_incoming'; justification: string }) => void;
}) {
  const name = `conflict-${candidate.id}`;
  return (
    <div className="callout" data-tone="warning">
      <p>
        <strong>Differs from your saved record.</strong>
        {existing ? (
          <>
            {' '}
            Saved: {existing.title ?? '—'}, {formatCredits(existing.credits)} credits, grade {existing.grade || 'blank'}
            {existing.user_corrections && existing.user_corrections.length > 0 ? ` (includes your correction: ${existing.user_corrections.map(describeCorrection).join('; ')})` : ''}.
          </>
        ) : null}
      </p>
      <div role="radiogroup" aria-label={`Resolve conflict for ${candidate.normalized_code}`}>
        <label>
          <input type="radio" name={name} checked={decision?.action === 'keep_existing'} onChange={() => onDecide({ action: 'keep_existing', justification: '' })} /> Keep my saved version
        </label>{' '}
        <label>
          <input type="radio" name={name} checked={decision?.action === 'accept_incoming'} onChange={() => onDecide({ action: 'accept_incoming', justification: decision?.justification ?? '' })} /> Use the
          imported version
        </label>
      </div>
      {decision?.action === 'accept_incoming' ? (
        <div className="field">
          <label htmlFor={`${name}-why`}>Reason for using the imported version</label>
          <input id={`${name}-why`} type="text" value={decision.justification} onChange={(e) => onDecide({ action: 'accept_incoming', justification: e.target.value })} />
        </div>
      ) : null}
    </div>
  );
}

function InlineEditor({ candidate, correction, onApply, onCancel }: { candidate: CourseAttempt; correction?: Correction; onApply: (c: Correction) => void; onCancel: () => void }) {
  const id = useId();
  const [values, setValues] = useState<Record<EditableField, string>>(() => ({
    normalized_code: correction?.fields.normalized_code ?? candidate.normalized_code,
    title: correction?.fields.title ?? candidate.title,
    credits: correction?.fields.credits ?? candidate.credits,
    grade: correction?.fields.grade ?? candidate.grade,
    term_id: correction?.fields.term_id ?? candidate.term_id,
  }));
  const [justification, setJustification] = useState(correction?.justification ?? '');
  const [error, setError] = useState<string | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const fields: Partial<Record<EditableField, string>> = {};
    for (const { key } of FIELDS) if (values[key].trim() !== String(candidate[key] ?? '')) fields[key] = values[key].trim();
    if (fields.credits !== undefined && !isDecimalString(fields.credits)) return setError('Enter credits as a number, for example 4 or 1.5 (no leading zeros, at most 4 decimal places).');
    if (Object.keys(fields).length > 0 && !justification.trim()) return setError('Explain what you checked before correcting a row.');
    setError(null);
    onApply({ fields, justification: justification.trim() });
  };
  return (
    <form onSubmit={submit} noValidate>
      <fieldset aria-label={`Edit ${candidate.normalized_code}`} style={{ border: 'none', padding: 0, margin: 0 }}>
        <legend className="visually-hidden">Edit {candidate.normalized_code}</legend>
        <div className="inline-fields">
          {FIELDS.map((f) => (
            <div className="field" key={f.key}>
              <label htmlFor={`${id}-${f.key}`}>{f.label}</label>
              <input id={`${id}-${f.key}`} type="text" value={values[f.key]} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
              <span className="hint">Printed: {String(candidate[f.key] ?? '') || 'blank'}</span>
            </div>
          ))}
        </div>
        <div className="field">
          <label htmlFor={`${id}-why`}>Justification (what did you check?)</label>
          <input id={`${id}-why`} type="text" value={justification} onChange={(e) => setJustification(e.target.value)} />
        </div>
        <p className="muted">Correcting a transcription error does not approve a course equivalence.</p>
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="panel-row">
          <button type="submit" className="btn btn-primary">
            Apply correction
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </fieldset>
    </form>
  );
}
