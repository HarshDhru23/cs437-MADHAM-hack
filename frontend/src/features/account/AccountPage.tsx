import { useState, type FormEvent } from 'react';
import { endpoints } from '../../api/endpoints';
import { useSession } from '../../app/session';
import { usePublishView } from '../../app/viewContext';
import { failureMessage, PasswordField } from '../auth/AuthPages';
import { YourData } from './YourData';
import './account.css';

export function AccountPage() {
  const session = useSession();
  const [oldPassword, setOld] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ old?: string; next?: string; confirm?: string }>({});
  const [message, setMessage] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  usePublishView({ dataMode: 'none' });

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
    <div className="account-grid">
      <h1>Account</h1>
      <section className="panel" aria-label="Account details">
        <h2>Signed in</h2>
        <p>
          {session.signIn.password ? 'Username' : 'IITGN account'}: <span className="mono account-name">{session.user?.username}</span>
        </p>
        <p className="muted">
          {session.signIn.password ? 'Your CoursePath account is separate from IITGN systems.' : 'You sign in with Google, so there is no CoursePath password to change.'}
        </p>
      </section>

      {session.signIn.password ? (
      <section className="panel" aria-label="Change password">
        <h2>Change password</h2>
        {message ? (
          <p className="callout" data-tone={message.tone === 'danger' ? 'danger' : undefined} role={message.tone === 'danger' ? 'alert' : 'status'}>
            {message.text}
          </p>
        ) : null}
        <form onSubmit={submit} noValidate className="form-narrow">
          <PasswordField label="Current password" value={oldPassword} onChange={setOld} autoComplete="current-password" error={errors.old} />
          <PasswordField label="New password" value={newPassword} onChange={setNew} autoComplete="new-password" error={errors.next} hint="At least 8 characters; avoid common and all-number passwords." />
          <PasswordField label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" error={errors.confirm} />
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? 'Changing…' : 'Change password'}
          </button>
        </form>
      </section>
      ) : null}

      <YourData />
      {session.signIn.password ? <p className="muted">Password recovery is not available in this release, so keep your password somewhere safe.</p> : null}
    </div>
  );
}
