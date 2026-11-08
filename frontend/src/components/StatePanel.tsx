import type { ReactNode } from 'react';
import type { ApiError } from '../api/client';

interface StatePanelProps {
  kind: 'loading' | 'empty' | 'error';
  title: string;
  detail?: ReactNode;
  action?: ReactNode;
}

export function StatePanel({ kind, title, detail, action }: StatePanelProps) {
  const role = kind === 'error' ? 'alert' : kind === 'loading' ? 'status' : undefined;
  return (
    <div className="state-panel" data-kind={kind} role={role}>
      <p>
        <strong>{title}</strong>
      </p>
      {detail ? <div className="muted">{detail}</div> : null}
      {action ? <div className="panel-row">{action}</div> : null}
    </div>
  );
}

export function errorTitle(error: ApiError): string {
  switch (error.kind) {
    case 'network':
      return 'CoursePath could not be reached';
    case 'auth':
      return 'Sign in to continue';
    case 'not_found':
      return 'Not found';
    case 'schema':
      return 'This page is out of date';
    case 'conflict':
      return 'Saved elsewhere';
    default:
      return 'Something went wrong';
  }
}

export function ErrorPanel({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  return (
    <StatePanel
      kind="error"
      title={errorTitle(error)}
      detail={<p>{error.message}</p>}
      action={
        onRetry ? (
          <button type="button" className="btn" onClick={onRetry}>
            Try again
          </button>
        ) : undefined
      }
    />
  );
}
