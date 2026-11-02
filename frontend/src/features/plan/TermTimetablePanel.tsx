import { useState } from 'react';
import { offeringEndpoints } from '../../api/endpoints';
import { useResource } from '../../api/resources';
import type { Issue, MeetingCheckStatus, MeetingConflict, OfferingMeeting, PlannedSemester, PlanValidation, TermOfferingSnapshot } from '../../api/types';
import { useSession } from '../../app/session';
import { Dialog } from '../../components/Dialog';
import { SourcePanel } from '../../components/SourcePanel';
import { ErrorPanel, StatePanel } from '../../components/StatePanel';
import { Badge, SeverityBadge } from '../../components/StatusBadge';
import { formatTerm } from '../../lib/format';
import { SectionPicker, type SectionChoice } from './SectionPicker';
import { chosenOffering, describeMeeting, kindLabel, offeringsFor, semantics, timeRange, weekdayName } from './timetableFormat';
import { WeeklyDetail, type WeeklyEntry } from './WeeklyDetail';

export function useTermOfferings(termId: string) {
  const { api } = useSession();
  return useResource(`public:offerings:${termId}`, (signal) => offeringEndpoints.offerings(api, termId, { signal }));
}

const CHECK: Record<MeetingCheckStatus, { tone: 'success' | 'danger' | 'unknown'; symbol: string; label: string }> = {
  not_checked: { tone: 'unknown', symbol: '?', label: 'Not checked' },
  clear: { tone: 'success', symbol: '✓', label: 'No clashes found' },
  conflicts: { tone: 'danger', symbol: '✕', label: 'Clashes' },
};

export function MeetingCheckBadge({ status }: { status: string | null | undefined }) {
  const meta = CHECK[(status ?? 'not_checked') as MeetingCheckStatus] ?? CHECK.not_checked;
  return (
    <Badge tone={meta.tone} symbol={meta.symbol}>
      {meta.label}
    </Badge>
  );
}

const OFFERING: Record<string, { tone: 'success' | 'warning' | 'danger' | 'unknown' | 'neutral'; symbol: string; label: string; explain: string }> = {
  confirmed_in_snapshot: { tone: 'success', symbol: '✓', label: 'Confirmed in snapshot', explain: 'Listed in a reviewed snapshot for this term. Not a registration guarantee.' },
  tentative: { tone: 'warning', symbol: '~', label: 'Tentative (draft snapshot)', explain: 'Listed in a snapshot nobody has reviewed yet.' },
  historical: { tone: 'neutral', symbol: '↺', label: 'Historical hint', explain: 'Only an earlier pattern; not a confirmed offering.' },
  not_offered: { tone: 'danger', symbol: '✕', label: 'Not offered', explain: 'Absent from a complete, reviewed snapshot for this term.' },
  unknown: { tone: 'unknown', symbol: '?', label: 'Unknown', explain: 'No snapshot, or absent from a partial or unreviewed one: unknown, not unavailable.' },
};

export function OfferingStatusBadge({ status }: { status: string | null | undefined }) {
  const meta = status ? OFFERING[status] : undefined;
  if (!meta)
    return (
      <Badge tone="unknown" symbol="?">
        {status ? `Unrecognised status (${status})` : 'Not checked'}
      </Badge>
    );
  return (
    <Badge tone={meta.tone} symbol={meta.symbol}>
      {meta.label}
    </Badge>
  );
}

/** Timetable-related server issues, rendered generically by code and message. */
const TIMETABLE_CODE = /^(MEETING|OFFERING|SECTION|TIMETABLE)/;

function meetingIndex(snapshot: TermOfferingSnapshot | null): Map<string, { code: string; meeting: OfferingMeeting }> {
  const index = new Map<string, { code: string; meeting: OfferingMeeting }>();
  for (const o of snapshot?.offerings ?? []) for (const g of o.meeting_groups) for (const m of g.meetings) index.set(m.id, { code: o.display_code ?? o.code, meeting: { kind: g.kind, ...m } });
  return index;
}

/**
 * A08 per-term timetable panel (CP-23, CP-24): the server's clash-check status
 * for the term, why it is "Not checked" when it is, the term snapshot's label,
 * date, review status and coverage, the per-course offering status, the
 * server's conflicts with source cells, a section picker and a weekly detail.
 */
export function TermTimetablePanel({
  semester,
  validation,
  issues,
  stale,
  onChooseSections,
}: {
  semester: PlannedSemester;
  /** Null while loading or while the plan has unsaved/unvalidated edits. */
  validation: PlanValidation | null;
  issues: Issue[];
  stale: boolean;
  onChooseSections: (itemId: string, choice: SectionChoice) => void;
}) {
  const term = semester.term_id;
  const label = formatTerm(term);
  const offerings = useTermOfferings(term);
  const snapshot = offerings.data && offerings.data.id ? offerings.data : null;
  const noSnapshot = offerings.data !== null && !offerings.data.id;
  const [picking, setPicking] = useState<string | null>(null);
  const perCourse = new Map((validation?.per_course ?? []).filter((p) => p.term_id === term).map((p) => [p.id, p]));
  const check = validation?.meeting_checks?.[term];
  const empty = semester.courses.length === 0 && semester.placeholders.length === 0;
  const status: MeetingCheckStatus = validation ? (check?.status ?? 'not_checked') : 'not_checked';
  const conflicts = validation ? (check?.conflicts ?? []) : [];
  const conflictMeetings = new Set(conflicts.flatMap((c) => c.meeting_ids));
  const meetings = meetingIndex(snapshot);
  const codeOf = (itemId: string) => semester.courses.find((c) => c.id === itemId)?.normalized_code ?? itemId;
  const itemIssues = (itemId: string) => issues.filter((i) => i.entity_refs.includes(itemId) && TIMETABLE_CODE.test(i.code) && i.code !== 'TIMETABLE_CONFLICT');

  const reasons: { key: string; text: React.ReactNode }[] = [];
  if (status === 'not_checked' && !empty) {
    if (!validation) reasons.push({ key: 'stale', text: stale ? 'Your latest changes have not been validated by the server yet.' : 'The server has not validated this plan yet.' });
    else if (!check) reasons.push({ key: 'missing', text: 'The server did not report a timetable check for this term.' });
    if (noSnapshot) reasons.push({ key: 'snapshot', text: `No timetable snapshot is stored for ${label}, so clashes cannot be checked. This does not mean there are none.` });
    if (semester.placeholders.length > 0)
      reasons.push({ key: 'placeholders', text: `${semester.placeholders.length} placeholder(s) must be replaced by actual courses before this term can be checked.` });
    if (validation && !noSnapshot) {
      for (const c of semester.courses) {
        const row = perCourse.get(c.id);
        if (row && row.meeting_check_status !== 'not_checked') continue;
        const why = [...new Map(itemIssues(c.id).map((i) => [`${i.code}:${i.message}`, i])).values()];
        reasons.push({
          key: c.id,
          text: (
            <>
              <span className="mono">{c.normalized_code}</span>:{' '}
              {why.length
                ? why.map((i, n) => (
                    <span key={n}>
                      {i.message} <span className="issue-code">{i.code}</span>
                      {i.suggested_action ? ` ${i.suggested_action}` : ''}{' '}
                    </span>
                  ))
                : 'its meetings could not be checked.'}
            </>
          ),
        });
      }
    }
    if (reasons.length === 0) reasons.push({ key: 'other', text: 'The server could not check every meeting in this term.' });
  }

  const entries: WeeklyEntry[] = [];
  for (const c of semester.courses) {
    const offering = chosenOffering(c, offeringsFor(c, snapshot, perCourse.get(c.id)));
    if (!offering) continue;
    const chosen = new Set(c.section_ids ?? []);
    for (const g of offering.meeting_groups) {
      const mode = semantics(g.selection_semantics);
      const pick = mode === 'choose_one' ? g.meetings.find((m) => chosen.has(m.id)) : undefined;
      for (const m of pick ? [pick] : g.meetings)
        entries.push({
          code: c.normalized_code,
          meeting: { kind: g.kind, ...m },
          role: mode === 'all_required' ? 'required' : pick ? 'chosen' : mode === 'choose_one' ? 'option' : 'unclear',
          inServerConflict: conflictMeetings.has(m.id),
        });
    }
  }

  const pickingCourse = semester.courses.find((c) => c.id === picking) ?? null;

  return (
    <section className="panel timetable-panel" aria-label={`Timetable check for ${label}`}>
      <h3>Timetable and offerings</h3>
      <p>
        Clash check:{' '}
        {empty ? (
          <Badge tone="neutral">Nothing to check</Badge>
        ) : (
          <MeetingCheckBadge status={status} />
        )}
        {empty ? <span className="muted"> No courses are planned for this term.</span> : null}
        {status === 'clear' && !empty ? <span className="muted"> Among the meetings the snapshot lists for your planned courses and chosen sections.</span> : null}
      </p>
      {reasons.length > 0 ? (
        <div className="callout" role="note" aria-label={`Why ${label} is not checked`}>
          <strong>Why it is not checked:</strong>
          <ul>
            {reasons.map((r) => (
              <li key={r.key}>{r.text}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <SnapshotSummary label={label} loading={offerings.loading} error={offerings.error} reload={offerings.reload} snapshot={snapshot} noSnapshot={noSnapshot} issues={offerings.issues} />

      {conflicts.length > 0 ? (
        <div>
          <h4>Clashes reported by the server ({conflicts.length})</h4>
          <p className="muted">Different rooms do not resolve a clash: you cannot attend two meetings at the same time.</p>
          <ul className="issue-list">
            {conflicts.map((c, n) => (
              <ConflictItem key={`${c.id}-${n}`} conflict={c} codeOf={codeOf} meetings={meetings} />
            ))}
          </ul>
        </div>
      ) : null}

      {semester.courses.length > 0 ? (
        <div className="table-wrap">
          <table className="data stack-mobile">
            <caption>Offering status and sections in {label}</caption>
            <thead>
              <tr>
                <th scope="col">Course</th>
                <th scope="col">Offering status</th>
                <th scope="col">Clash check</th>
                <th scope="col">Sections</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {semester.courses.map((c) => {
                const row = validation ? perCourse.get(c.id) : undefined;
                const matched = offeringsFor(c, snapshot, row);
                const variantRequired = issues.some((i) => i.code === 'OFFERING_SECTION_REQUIRED' && i.entity_refs.includes(c.id));
                const offering = chosenOffering(c, matched);
                const chosenText = (c.section_ids ?? []).map((id) => (meetings.get(id) ? `${kindLabel(meetings.get(id)!.meeting.kind)} ${describeMeeting(meetings.get(id)!.meeting)}` : `${id} (not in snapshot)`));
                const status = row?.offering_status;
                return (
                  <tr key={c.id}>
                    <th scope="row" data-label="Course">
                      <span className="mono">{c.normalized_code}</span>
                    </th>
                    <td data-label="Offering status">
                      <OfferingStatusBadge status={row ? status : null} />
                      {status && OFFERING[status] ? <div className="muted">{OFFERING[status]!.explain}</div> : null}
                    </td>
                    <td data-label="Clash check">
                      <MeetingCheckBadge status={row?.meeting_check_status} />
                    </td>
                    <td data-label="Sections">
                      {matched.length > 1 ? <div>{offering ? `Variant: ${offering.raw_label ?? offering.display_code ?? offering.id}` : 'Variant not chosen'}</div> : null}
                      {chosenText.length ? chosenText.map((t) => <div key={t}>{t}</div>) : <span className="muted">No section chosen</span>}
                    </td>
                    <td data-label="Actions">
                      {matched.length > 0 ? (
                        <button type="button" className="btn btn-small" aria-label={`Choose sections for ${c.normalized_code}`} onClick={() => setPicking(c.id)}>
                          {variantRequired ? 'Choose variant and sections' : 'Choose sections'}
                        </button>
                      ) : (
                        <span className="muted">No meetings in snapshot</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {entries.length > 0 ? (
        <details>
          <summary>Weekly detail for {label}</summary>
          <p className="muted">A supplement to the clash list above, which is the server's result.</p>
          <WeeklyDetail label={label} entries={entries} />
        </details>
      ) : null}

      {pickingCourse ? (
        <Dialog open title={`Sections for ${pickingCourse.normalized_code} in ${label}`} onClose={() => setPicking(null)} variant="drawer">
          <SectionPicker
            course={pickingCourse}
            offerings={offeringsFor(pickingCourse, snapshot, validation ? perCourse.get(pickingCourse.id) : undefined)}
            variantRequired={issues.some((i) => i.code === 'OFFERING_SECTION_REQUIRED' && i.entity_refs.includes(pickingCourse.id))}
            onCancel={() => setPicking(null)}
            onSave={(choice) => {
              onChooseSections(pickingCourse.id, choice);
              setPicking(null);
            }}
          />
        </Dialog>
      ) : null}
    </section>
  );
}

function ConflictItem({ conflict, codeOf, meetings }: { conflict: MeetingConflict; codeOf: (id: string) => string; meetings: Map<string, { code: string; meeting: OfferingMeeting }> }) {
  const [a, b] = conflict.item_ids;
  const kinds = conflict.kinds.map((k) => kindLabel(k));
  return (
    <li data-severity={conflict.certain ? 'error' : 'warning'}>
      <div className="issue-head">
        <SeverityBadge severity={conflict.certain ? 'error' : 'warning'} />
        <strong>{conflict.certain ? 'Clash' : 'Possible clash'}</strong>
      </div>
      <p>
        <span className="mono">{a ? codeOf(a) : '?'}</span> {kinds[0]} and <span className="mono">{b ? codeOf(b) : '?'}</span> {kinds[1]} overlap on{' '}
        {weekdayName(conflict.weekday)} {timeRange(conflict.start_minute, conflict.end_minute)}.
      </p>
      <ul>
        {conflict.meeting_ids.map((id, n) => {
          const found = meetings.get(id);
          const item = conflict.item_ids[n];
          return (
            <li key={`${id}-${n}`}>
              {item ? <span className="mono">{codeOf(item)}</span> : null} {kinds[n] ?? ''}: {found ? describeMeeting(found.meeting) : <span className="mono">{id}</span>}
            </li>
          );
        })}
      </ul>
      {conflict.assumptions.length > 0 ? (
        <div>
          <strong>Why it is only possible:</strong>
          <ul>
            {conflict.assumptions.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <SourcePanel title="Source cells" refs={conflict.source_refs.map((r) => ({ id: r.id, ...(r.locator ? { locator: r.locator } : {}) }))} />
    </li>
  );
}

function SnapshotSummary({
  label,
  loading,
  error,
  reload,
  snapshot,
  noSnapshot,
  issues,
}: {
  label: string;
  loading: boolean;
  error: Parameters<typeof ErrorPanel>[0]['error'] | null;
  reload: () => void;
  snapshot: TermOfferingSnapshot | null;
  noSnapshot: boolean;
  issues: Issue[];
}) {
  if (loading && !snapshot && !noSnapshot) return <StatePanel kind="loading" title={`Loading the ${label} timetable snapshot…`} />;
  if (error) return <ErrorPanel error={error} onRetry={reload} />;
  if (noSnapshot)
    return (
      <p>
        <Badge tone="unknown" symbol="?">
          No timetable snapshot
        </Badge>{' '}
        No timetable snapshot is stored for {label}. Course availability is unknown and clashes are not checked; no timetable is inferred from another term.
      </p>
    );
  if (!snapshot) return null;
  const sources = snapshot.source_refs ?? [];
  const review =
    snapshot.review_status === 'reviewed'
      ? 'Reviewed against its source by staff'
      : snapshot.review_status === 'draft'
        ? 'Draft, not reviewed: offerings are tentative'
        : `Review status: ${snapshot.review_status ?? 'not stated'}`;
  const coverage =
    snapshot.coverage === 'complete'
      ? 'Complete'
      : snapshot.coverage === 'partial'
        ? 'Partial'
        : snapshot.coverage === 'unknown'
          ? 'Unknown'
          : String(snapshot.coverage);
  return (
    <div className="source-panel">
      <dl className="snapshot-facts">
        <div>
          <dt>Timetable snapshot</dt>
          <dd>
            <span className="mono">{snapshot.id}</span>
            {sources.length ? ` (${sources.map((s) => s.title ?? s.id).join(', ')})` : ''}
          </dd>
        </div>
        <div>
          <dt>Date</dt>
          <dd>{snapshot.revision_date ?? sources.find((s) => s.effective_date)?.effective_date ?? 'Not stated by the source'}</dd>
        </div>
        <div>
          <dt>Review</dt>
          <dd>{review}</dd>
        </div>
        <div>
          <dt>Coverage</dt>
          <dd>{coverage}</dd>
        </div>
      </dl>
      <p className="muted">A timetable snapshot is not a registration guarantee: courses, sections, slots and rooms can still change.</p>
      {snapshot.coverage !== 'complete' ? (
        <p className="muted">This snapshot may not list every course. A course absent from it is unknown, not unavailable.</p>
      ) : null}
      {issues.length > 0 ? (
        <ul className="snapshot-issues">
          {issues.map((i, n) => (
            <li key={`${i.code}-${n}`}>
              <SeverityBadge severity={i.severity} /> {i.message} <span className="issue-code">{i.code}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
