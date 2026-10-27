import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useSession } from './session';
import { DATA_MODE_LABEL, useViewInfo } from './viewContext';

const MAIN_NAV = [
  { to: '/', label: 'Requirements', match: (p: string) => p === '/' },
  { to: '/record', label: 'My record', match: (p: string) => p.startsWith('/record') || p.startsWith('/performance') || p.startsWith('/awards') },
  { to: '/plan', label: 'Plan', match: (p: string) => p.startsWith('/plan') || p.startsWith('/scenarios') || p.startsWith('/report') },
];

export function AppShell() {
  const session = useSession();
  const view = useViewInfo();
  const location = useLocation();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  const signOut = async () => {
    setSigningOut(true);
    try {
      await session.logout();
      navigate('/');
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      {session.mock ? (
        <div className="mock-banner" role="note">
          Development mock data — synthetic responses, not the CoursePath server. Nothing here is saved.
        </div>
      ) : null}
      <header className="shell-header">
        <div className="shell-bar">
          <NavLink to="/" className="brand">
            CoursePath
          </NavLink>
          <nav className="main-nav" aria-label="Main">
            <ul>
              {MAIN_NAV.map((item) => (
                <li key={item.to}>
                  <Link to={item.to} aria-current={item.match(location.pathname) ? 'page' : undefined}>
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="shell-user">
            {session.user ? (
              <>
                <NavLink to="/account" className="btn btn-quiet" aria-label={`Account (${session.user.username})`}>
                  Account <span className="mono">{session.user.username}</span>
                </NavLink>
                <button type="button" className="btn" onClick={signOut} disabled={signingOut}>
                  {signingOut ? 'Signing out…' : 'Sign out'}
                </button>
              </>
            ) : (
              <>
                <NavLink to={`/login?next=${encodeURIComponent(location.pathname)}`} className="btn">
                  Sign in
                </NavLink>
                <NavLink to="/signup" className="btn btn-primary">
                  Create account
                </NavLink>
              </>
            )}
          </div>
        </div>
      </header>
      <section className="context-bar" aria-label="Data context">
        <dl>
          <div>
            <dt>Programme:</dt>
            <dd>B.Tech CSE, 2024 entry</dd>
          </div>
          <div>
            <dt>Rules:</dt>
            <dd>
              {view.ruleVersion ?? 'Not loaded'}
              {view.reviewStatus ? ` (${view.reviewStatus})` : ''}
            </dd>
          </div>
          <div>
            <dt>Showing:</dt>
            <dd>{DATA_MODE_LABEL[view.dataMode]}</dd>
          </div>
          {view.recordRevision !== null ? (
            <div>
              <dt>Record revision:</dt>
              <dd className="num">{view.recordRevision}</dd>
            </div>
          ) : null}
        </dl>
      </section>
      {session.expired ? (
        <div className="callout" data-tone="warning" role="alert" style={{ maxWidth: '72rem', margin: '1rem auto 0' }}>
          Your session ended. Unsaved plan, enrolment and import changes are kept in this tab (not if you close or reload it).{' '}
          <NavLink to={`/login?next=${encodeURIComponent(location.pathname)}`}>Sign in again</NavLink> with the same account to save them; another account
          starts without them.
        </div>
      ) : null}
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
    </>
  );
}

export function SubNav({ label, items }: { label: string; items: { to: string; label: string }[] }) {
  const location = useLocation();
  return (
    <nav className="subnav" aria-label={label}>
      <ul>
        {items.map((item) => (
          <li key={item.to}>
            <Link to={item.to} aria-current={location.pathname === item.to ? 'page' : undefined}>
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export const RECORD_TABS = [
  { to: '/record', label: 'Record' },
  { to: '/record/import', label: 'Import' },
  { to: '/performance', label: 'Performance' },
  { to: '/awards', label: 'Awards' },
];

export const PLAN_TABS = [
  { to: '/plan', label: 'Plans' },
  { to: '/scenarios', label: 'Scenarios' },
];
