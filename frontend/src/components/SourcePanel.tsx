import type { AttemptSourceRef, SourceReference } from '../api/types';

type AnyRef = AttemptSourceRef | SourceReference | string;

function locator(ref: AttemptSourceRef | SourceReference): string[] {
  const parts: string[] = [];
  const r = ref as AttemptSourceRef & SourceReference;
  if (typeof r.page === 'number') parts.push(`Page ${r.page}`);
  if (typeof r.line === 'number') parts.push(`Line ${r.line}`);
  if (typeof r.cell === 'string') parts.push(`Cell ${r.cell}`);
  if (typeof r.locator === 'string') parts.push(r.locator);
  return parts;
}

/** Shows where a value came from. Raw text is rendered as text, never as HTML. */
export function SourcePanel({ title = 'Source evidence', refs, catalog }: { title?: string; refs: AnyRef[]; catalog?: SourceReference[] }) {
  if (refs.length === 0) {
    return (
      <div className="source-panel">
        <strong>{title}</strong>
        <p className="muted">No source reference was provided by the server.</p>
      </div>
    );
  }
  return (
    <div className="source-panel">
      <strong>{title}</strong>
      <ul>
        {refs.map((ref, index) => {
          if (typeof ref === 'string') {
            const known = catalog?.find((s) => s.id === ref);
            return (
              <li key={`${ref}-${index}`}>
                <span className="mono">{ref}</span>
                {known ? (
                  <>
                    {' — '}
                    {known.title}
                    {known.version ? ` (version ${known.version})` : ''}
                    {known.review_status ? `, review status: ${known.review_status}` : ''}
                    {known.locator ? <div className="muted">{known.locator}</div> : null}
                  </>
                ) : null}
              </li>
            );
          }
          const raw = (ref as AttemptSourceRef).raw;
          return (
            <li key={`${ref.id}-${index}`}>
              <span className="mono">{ref.id}</span> {locator(ref).join(' · ')}
              {typeof raw === 'string' ? <pre aria-label="Original source text">{raw.replace(/\t/g, '  ⇥  ')}</pre> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
