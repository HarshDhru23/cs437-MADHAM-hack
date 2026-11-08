import type { PlanStatus } from '../../api/types';
import { Badge } from '../../components/StatusBadge';
import { creditsWord } from './PlanProgress';

/** The short label beside a plan's name: "Valid" or "Not valid". */
export function PlanStatusBadge({ status }: { status: PlanStatus | undefined }) {
  if (!status) return null;
  return status.valid ? (
    <Badge tone="success" symbol="✓">
      Valid
    </Badge>
  ) : (
    <Badge tone="danger" symbol="✕">
      Not valid
    </Badge>
  );
}

/** Why a plan is not valid, in the student's words: the problems to fix and the credits it still leaves uncovered. */
export function notValidReason(status: PlanStatus): string {
  const parts: string[] = [];
  if (status.problems > 0) parts.push(status.problems === 1 ? '1 problem to fix' : `${status.problems} problems to fix`);
  if (Number(status.uncovered_credits) > 0) parts.push(`${creditsWord(status.uncovered_credits)} of your degree not covered yet`);
  return parts.join(' and ');
}

/**
 * Shown where the student saves a plan: whether the plan as it stands is valid. Saving is allowed either way; a plan that is not valid
 * is marked "Not valid" in the list of plans until it is fixed.
 */
export function PlanStatusNote({ status, pending }: { status: PlanStatus | undefined; pending: boolean }) {
  if (!status) {
    return pending ? (
      <p className="callout pb-validity" aria-live="polite" data-testid="plan-validity">
        Checking whether this plan is valid…
      </p>
    ) : null;
  }
  return (
    <p className="callout pb-validity" aria-live="polite" data-tone={status.valid ? 'success' : 'warning'} data-updating={pending ? 'true' : undefined} data-testid="plan-validity">
      {status.valid ? (
        <>
          <strong>Valid plan.</strong> It has no problems and covers everything you still need for your degree.
        </>
      ) : (
        <>
          <strong>Not a valid plan yet:</strong> {notValidReason(status)}. You can still save it; it will show as “Not valid” in your plans until it is fixed.
        </>
      )}
    </p>
  );
}
