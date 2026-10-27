import { useId, useState, type DragEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { endpoints } from '../../api/endpoints';
import { useRecord } from '../../api/hooks';
import type { Issue } from '../../api/types';
import { RECORD_TABS, SubNav } from '../../app/AppShell';
import { useSession } from '../../app/session';
import { usePublishView } from '../../app/viewContext';
import { IssueList } from '../../components/IssueList';
import { Tabs } from '../../components/Tabs';
import { importDraftStore, useImportDraft } from './draftStore';
import { previewStore } from './previewStore';

/** Synthetic sample in the IMS table layout. No real student data. */
export const SYNTHETIC_SAMPLE = [
  'Academic Period\tCourse No\tCourse Name\tCredit\tGrade',
  '2025-26 Semester II\tZZ 299\tSynthetic Project\t4\tA',
  '2025-26 Semester I\tZZ 299\tSynthetic Project\t4\tP',
  '2024-25 Semester II\tZZ 104\tSynthetic Calculus\t2\tB',
  '2024-25 Semester II\tZZ 372\tSynthetic Short Course\t1\tB',
  '2024-25 Semester I\tZZ 242(N)\tSynthetic Data Structures\t4\tA-',
  '2024-25 Semester I\tZZ 101\tSynthetic Physical Activity\t0\tP',
].join('\n');

export function Steps({ current }: { current: 'import' | 'review' | 'analyze' }) {
  const steps = [
    ['import', 'Import'],
    ['review', 'Review'],
    ['analyze', 'Analyze'],
  ] as const;
  return (
    <ol className="steps" aria-label="Steps">
      {steps.map(([id, label], i) => (
        <li key={id} aria-current={id === current ? 'step' : undefined}>
          {i + 1}. {label}
        </li>
      ))}
    </ol>
  );
}

interface Failure {
  message: string;
  issues: Issue[];
  kind: ApiError['kind'] | 'client';
}

export function ImportPage() {
  const session = useSession();
  const record = useRecord();
  const draft = useImportDraft();
  const navigate = useNavigate();
  const fileId = useId();
  const textId = useId();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [dragging, setDragging] = useState(false);
  usePublishView({ dataMode: 'none', recordRevision: record.data?.revision ?? null });

  const chooseFile = (file: File | null | undefined) => {
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setFailure({ kind: 'client', message: 'Only PDF transcripts can be uploaded. For IMS, copy the grade table and use “Paste IMS grades”.', issues: [] });
      return;
    }
    setFailure(null);
    importDraftStore.update({ kind: 'pdf', file, ownerId: session.user?.id ?? null });
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    chooseFile(event.dataTransfer.files?.[0]);
  };

  const parse = async (kind: 'pdf' | 'ims') => {
    if (!session.user || !record.data) return;
    if (kind === 'ims' && !draft.text.trim()) {
      setFailure({ kind: 'client', message: 'Paste the IMS grade table first.', issues: [] });
      return;
    }
    if (kind === 'pdf' && !draft.file) {
      setFailure({ kind: 'client', message: 'Choose a transcript PDF first.', issues: [] });
      return;
    }
    setPending(true);
    setFailure(null);
    try {
      const result =
        kind === 'ims' ? await endpoints.previewIms(session.api, draft.text, record.data.revision) : await endpoints.previewPdf(session.api, draft.file as File, record.data.revision);
      previewStore.put({ preview: result.data, issues: result.issues, ownerId: session.user.id, kind });
      navigate(`/record/review/${encodeURIComponent(result.data.id)}`);
    } catch (error) {
      const e = error instanceof ApiError ? error : new ApiError('server', 0, String(error), []);
      const message =
        e.kind === 'too_large'
          ? 'The file is larger than the accepted limit.'
          : e.kind === 'conflict'
            ? 'Your saved record changed in another tab or device. Reload this page, then parse again.'
            : e.kind === 'uncommittable'
              ? 'No course rows could be read from this input.'
              : e.kind === 'invalid'
                ? 'The server could not read this input.'
                : e.message;
      setFailure({ kind: e.kind, message, issues: e.issues });
      if (e.kind === 'conflict') record.reload();
    } finally {
      setPending(false);
    }
  };

  const signInLink = (label: string) => (
    <Link className="btn btn-primary" to={`/login?next=${encodeURIComponent('/record/import')}`}>
      {label}
    </Link>
  );

  const failurePanel = failure ? (
    <div className="callout" data-tone="danger" role="alert">
      <p>
        <strong>{failure.message}</strong>
      </p>
      {failure.issues.length > 0 ? <IssueList issues={failure.issues} grouped={false} /> : null}
      {failure.kind !== 'client' ? <p>Your saved record was not changed. Your input is still here.</p> : null}
      <div className="panel-row">
        <button
          type="button"
          className="btn"
          onClick={() => {
            importDraftStore.update({ kind: 'ims' });
            setFailure(null);
          }}
        >
          Paste IMS grades instead
        </button>
        <Link to="/record">Add attempts manually</Link>
      </div>
    </div>
  ) : null;

  const pdfPanel = (
    <div className="stack">
      <p>
        Accepted: the IITGN academic transcript PDF as downloaded (text-based, up to 10 MB and 20 pages). Scanned or image-only PDFs, encrypted files and
        other layouts are not supported; use the IMS paste or add attempts manually instead.
      </p>
      <div
        className="dropzone"
        data-active={dragging}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <p>Drag a PDF here, or use the file button.</p>
        <label htmlFor={fileId} className="btn">
          Choose transcript PDF
        </label>
        <input
          id={fileId}
          type="file"
          accept="application/pdf,.pdf"
          className="visually-hidden"
          onChange={(e) => {
            chooseFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <p className="muted" aria-live="polite">
          {draft.file ? `Selected: ${draft.file.name}` : 'No file selected. If you reloaded the page, select the file again.'}
        </p>
      </div>
      {session.user ? (
        <button type="button" className="btn btn-primary" disabled={pending || record.loading} onClick={() => parse('pdf')}>
          {pending ? 'Parsing…' : 'Parse transcript'}
        </button>
      ) : (
        signInLink('Sign in to parse')
      )}
    </div>
  );

  const imsPanel = (
    <div className="stack">
      <p>
        In IMS, select the whole grade table (including the header row Academic Period, Course No, Course Name, Credit, Grade), copy it and paste it below.
      </p>
      <div className="field">
        <label htmlFor={textId}>IMS grade table</label>
        <textarea
          id={textId}
          value={draft.text}
          onChange={(e) => importDraftStore.update({ kind: 'ims', text: e.target.value, ownerId: draft.ownerId ?? session.user?.id ?? null })}
          spellCheck={false}
          autoComplete="off"
        />
      </div>
      <div className="panel-row">
        <button type="button" className="btn" onClick={() => importDraftStore.update({ kind: 'ims', text: SYNTHETIC_SAMPLE })}>
          Use synthetic sample
        </button>
        {session.user ? (
          <button type="button" className="btn btn-primary" disabled={pending || record.loading} onClick={() => parse('ims')}>
            {pending ? 'Parsing…' : 'Parse grades'}
          </button>
        ) : (
          signInLink('Sign in to parse')
        )}
      </div>
    </div>
  );

  return (
    <div>
      {session.user ? <SubNav label="My record" items={RECORD_TABS} /> : null}
      <h1>Add your academic record</h1>
      <Steps current="import" />
      <div className="callout">
        <strong>Privacy:</strong> your file or pasted text is sent to the CoursePath server only to extract course rows for your review. Nothing is added to your
        record until you confirm it. The original PDF is not kept after parsing. CoursePath never asks for your IMS password.
        {!session.user ? ' Sign in to parse; anything you paste or select stays in this tab while you sign in.' : ''}
      </div>
      {failurePanel}
      <Tabs
        label="Import method"
        selected={draft.kind}
        onSelect={(id) => importDraftStore.update({ kind: id as 'pdf' | 'ims' })}
        tabs={[
          { id: 'pdf', label: 'Upload transcript PDF', content: pdfPanel },
          { id: 'ims', label: 'Paste IMS grades', content: imsPanel },
        ]}
      />
    </div>
  );
}
