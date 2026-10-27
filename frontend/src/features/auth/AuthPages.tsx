import { useId, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { useSession } from '../../app/session';
import { usePublishView } from '../../app/viewContext';

/** Only same-app relative paths are allowed as a post-login destination. */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return '/record';
  return next;
}

function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  error,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  error?: string;
  hint?: string;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint ? (
        <span className="hint" id={`${id}-hint`}>
          {hint}
        </span>
      ) : null}
      <div className="panel-row" style={{ flexWrap: 'nowrap' }}>
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          aria-invalid={Boolean(error)}
          aria-describedby={[hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined}
          spellCheck={false}
        />
        <button type="button" className="btn" onClick={() => setVisible((v) => !v)} aria-pressed={visible}>
          {visible ? 'Hide password' : 'Show password'}
        </button>
      </div>
      {error ? (
        <span className="field-error" id={`${id}-err`}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

function TextField({ label, value, onChange, autoComplete, error }: { label: string; value: string; onChange: (v: string) => void; autoComplete: string; error?: string }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        autoCapitalize="none"
        spellCheck={false}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-err` : undefined}
        maxLength={150}
      />
      {error ? (
        <span className="field-error" id={`${id}-err`}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

function failureMessage(error: unknown, action: 'login' | 'signup' | 'password'): string {
  if (!(error instanceof ApiError)) return 'Something went wrong. Try again.';
  if (error.kind === 'throttled') return 'Too many attempts. Wait 15 minutes, then try again.';
  if (error.kind === 'network') return 'The CoursePath server could not be reached.';
  if (action === 'login') return 'Sign-in details were not accepted.';
  if (action === 'signup') return 'The username or password was not accepted. Choose a different username, or a longer, less common password that is not all numbers.';
  return 'The password change was not accepted. Check your current password and choose a longer, less common new password.';
}

export function LoginPage() {
  const session = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ username?: string; password?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  usePublishView({ dataMode: 'none' });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next = { username: username.trim() ? undefined : 'Enter your username.', password: password ? undefined : 'Enter your password.' };
    setErrors(next);
    if (next.username || next.password) return;
    setPending(true);
    setFailure(null);
    try {
      await session.login({ username: username.trim(), password });
      navigate(safeNext(params.get('next')), { replace: true });
    } catch (error) {
      setFailure(failureMessage(error, 'login'));
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="panel" style={{ maxWidth: '32rem' }}>
      <h1>Sign in</h1>
      <p className="muted">Sign in to your CoursePath account to save and load your record and plans on any device.</p>
      {failure ? (
        <p className="callout" data-tone="danger" role="alert">
          {failure}
        </p>
      ) : null}
      <form onSubmit={submit} noValidate>
        <TextField label="Username" value={username} onChange={setUsername} autoComplete="username" error={errors.username} />
        <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="current-password" error={errors.password} />
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p style={{ marginTop: '1rem' }}>
        New here? <Link to={`/signup${params.get('next') ? `?next=${encodeURIComponent(safeNext(params.get('next')))}` : ''}`}>Create an account</Link>
      </p>
    </section>
  );
}

export function SignupPage() {
  const session = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ username?: string; password?: string; confirm?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  usePublishView({ dataMode: 'none' });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next = {
      username: username.trim() ? undefined : 'Choose a username.',
      password: password.length >= 8 ? undefined : 'Use at least 8 characters.',
      confirm: confirm === password ? undefined : 'Passwords do not match.',
    };
    setErrors(next);
    if (next.username || next.password || next.confirm) return;
    setPending(true);
    setFailure(null);
    try {
      await session.signup({ username: username.trim(), password });
      navigate(safeNext(params.get('next') ?? '/record/import'), { replace: true });
    } catch (error) {
      setFailure(failureMessage(error, 'signup'));
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="panel" style={{ maxWidth: '32rem' }}>
      <h1>Create account</h1>
      <p className="muted">
        A CoursePath account stores your record and plans so they follow you across devices. It does not verify your IITGN identity, and CoursePath
        never asks for your IMS password.
      </p>
      {failure ? (
        <p className="callout" data-tone="danger" role="alert">
          {failure}
        </p>
      ) : null}
      <form onSubmit={submit} noValidate>
        <TextField label="Username" value={username} onChange={setUsername} autoComplete="username" error={errors.username} />
        <PasswordField
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          error={errors.password}
          hint="At least 8 characters; avoid common passwords and all-number passwords."
        />
        <PasswordField label="Confirm password" value={confirm} onChange={setConfirm} autoComplete="new-password" error={errors.confirm} />
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p style={{ marginTop: '1rem' }}>
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </section>
  );
}

export { PasswordField, failureMessage };
