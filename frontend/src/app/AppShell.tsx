import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { CommandBar } from '../components/CommandBar';
import { SyntheticExampleBanner } from '../features/import/SyntheticExample';
import { useSession } from './session';
import { useTheme } from './theme';
import { DATA_MODE_LABEL, useViewInfo } from './viewContext';

const MAIN_NAV = [
  { to: '/', label: 'Requirements', match: (p: string) => p === '/' },
  { to: '/record', label: 'My record', match: (p: string) => p.startsWith('/record') || p.startsWith('/performance') },
  { to: '/plan', label: 'Plan', match: (p: string) => p.startsWith('/plan') || p.startsWith('/scenarios') || p.startsWith('/report') },
];

export function AppShell() {
  const session = useSession();
  const view = useViewInfo();
  const location = useLocation();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const { theme, toggle } = useTheme();

  const sample = session.user?.demo === true;
  const signOut = async () => {
    setSigningOut(true);
    try {
      await session.logout();
      navigate(sample ? '/login' : '/');   // a sample student is removed on leaving; the visitor lands where they can sign in for real
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
          Development mock data — synthetic responses. Nothing here is saved.
        </div>
      ) : null}
      {sample ? (
        <div className="sample-banner" role="status" aria-label="Sample student">
          <p>You are looking at a sample student. Every course and grade here is made up and nothing is saved to a real account.</p>
          <button type="button" className="btn" onClick={signOut} disabled={signingOut}>
            {signingOut ? 'Leaving…' : 'Leave the sample'}
          </button>
        </div>
      ) : null}
      <header className="shell-header">
        <div className="shell-bar">
          <NavLink to="/" className="brand">
            <span className="brand-mark" aria-hidden="true" />
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
            <button type="button" className="cmd-trigger" aria-haspopup="dialog" onClick={() => setCommandOpen(true)}>
              Search or jump to…
              <span className="kbd" aria-hidden="true">
                /
              </span>
            </button>
            <button type="button" className="icon-btn" onClick={toggle} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
              {theme === 'dark' ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
                </svg>
              )}
            </button>
            {session.user ? (
              <>
                {sample ? (
                  <NavLink to="/account" className="btn btn-quiet" aria-label="Account (sample student)">
                    Account <span className="mono">sample student</span>
                  </NavLink>
                ) : (
                  <>
                    <NavLink to="/account" className="btn btn-quiet" aria-label={`Account (${session.user.username})`}>
                      Account <span className="mono">{session.user.username}</span>
                    </NavLink>
                    <button type="button" className="btn" onClick={signOut} disabled={signingOut}>
                      {signingOut ? 'Signing out…' : 'Sign out'}
                    </button>
                  </>
                )}
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
          {view.dataMode !== 'none' && view.dataMode !== 'public' ? (
            <div>
              <dt>Showing:</dt>
              <dd>{DATA_MODE_LABEL[view.dataMode]}</dd>
            </div>
          ) : null}
        </dl>
      </section>
      {session.user && !sample ? <SyntheticExampleBanner /> : null}
      {session.expired ? (
        <div className="callout" data-tone="warning" role="alert" style={{ maxWidth: '72rem', margin: '1rem auto 0' }}>
          Your session ended. Unsaved plan, enrolment and import changes are kept in this tab (not if you close or reload it).{' '}
          <NavLink to={`/login?next=${encodeURIComponent(location.pathname)}`}>Sign in again</NavLink> with the same account to save them; another account
          starts without them.
        </div>
      ) : null}
      <main id="main" tabIndex={-1}>
        {session.notice ? (
          <div className="callout" role="status">
            {session.notice}
            <button type="button" className="btn btn-small" onClick={session.dismissNotice}>
              Dismiss
            </button>
          </div>
        ) : null}
        <Outlet />
      </main>
      <CommandBar open={commandOpen} onOpenChange={setCommandOpen} />
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
];

export const PLAN_TABS = [
  { to: '/plan', label: 'Plans' },
  { to: '/scenarios', label: 'Scenarios' },
];
