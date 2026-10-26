import { useState, type FormEvent } from 'react';
import { endpoints } from '../../api/endpoints';
import { useRecord } from '../../api/hooks';
import { useSession } from '../../app/session';
import { usePublishView } from '../../app/viewContext';
import { failureMessage, PasswordField } from '../auth/AuthPages';

export function AccountPage() {
  const session = useSession();
  const record = useRecord();
  const [oldPassword, setOld] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ old?: string; next?: string; confirm?: string }>({});
  const [message, setMessage] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  usePublishView({ dataMode: 'none', recordRevision: record.data?.revision ?? null });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next = {
      old: oldPassword ? undefined : 'Enter your current password.',
      next: newPassword.length >= 8 ? undefined : 'Use at least 8 characters.',
      confirm: confirm === newPassword ? undefined : 'Passwords do not match.',
    };
    setErrors(next);
    if (next.old || next.next || next.confirm) return;
    setPending(true);
    setMessage(null);
    try {
      await endpoints.changePassword(session.api, { old_password: oldPassword, new_password: newPassword });
      setOld('');
      setNew('');
      setConfirm('');
      setMessage({ tone: 'success', text: 'Password changed. Other devices signed in with the old password are signed out.' });
    } catch (error) {
      setMessage({ tone: 'danger', text: failureMessage(error, 'password') });
    } finally {
      setPending(false);
    }
  };

  return (
    <div>
      <h1>Account</h1>
      <section className="panel" aria-label="Account details">
        <h2>Signed in</h2>
        <p>
          Username: <span className="mono">{session.user?.username}</span>
        </p>
        <p className="muted">
          Your CoursePath account is separate from IITGN systems. It does not verify your identity or academic standing.
          {record.data ? ` Your saved record is at revision ${record.data.revision}.` : ''}
        </p>
      </section>

      <section className="panel" aria-label="Change password" style={{ maxWidth: '36rem' }}>
        <h2>Change password</h2>
        {message ? (
          <p className="callout" data-tone={message.tone === 'danger' ? 'danger' : undefined} role={message.tone === 'danger' ? 'alert' : 'status'}>
            {message.text}
          </p>
        ) : null}
        <form onSubmit={submit} noValidate>
          <PasswordField label="Current password" value={oldPassword} onChange={setOld} autoComplete="current-password" error={errors.old} />
          <PasswordField label="New password" value={newPassword} onChange={setNew} autoComplete="new-password" error={errors.next} hint="At least 8 characters; avoid common and all-number passwords." />
          <PasswordField label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" error={errors.confirm} />
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? 'Changing…' : 'Change password'}
          </button>
        </form>
      </section>

      <section className="panel" aria-label="Your data">
        <h2>Your data</h2>
        <p>
          Export and deletion are not available yet. The server does not provide export or account-data deletion routes in this release; they are planned
          for the 3 November release (A11/H14). Until then, signing out removes your personal data from this browser tab.
        </p>
        <p className="muted">Password recovery is not available in this release, so keep your password somewhere safe.</p>
      </section>
    </div>
  );
}
