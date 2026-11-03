import { createBrowserRouter, createMemoryRouter, Link, RouterProvider, useLocation, type RouteObject } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { ApiClient } from '../api/client';
import { ResourceCacheProvider } from '../api/resources';
import { AccountPage } from '../features/account/AccountPage';
import { LoginPage, SignupPage } from '../features/auth/AuthPages';
import { ImportPage } from '../features/import/ImportPage';
import { ReviewPage } from '../features/import/ReviewPage';
import { PerformancePage } from '../features/performance/PerformancePage';
import { PlanIndexPage, PlanPage } from '../features/plan/PlanPage';
import { RecordPage } from '../features/record/RecordPage';
import { RequirementsPage } from '../features/requirements/RequirementsPage';
import { ReportPage } from '../features/report/ReportPage';
import { StatePanel } from '../components/StatePanel';
import { AppShell, PLAN_TABS, RECORD_TABS, SubNav } from './AppShell';
import { SessionProvider, useSession } from './session';
import { usePublishView, ViewContextProvider } from './viewContext';

/** Panels shown instead of a protected page publish "no data"; the page itself publishes its own context. */
function NoData({ children }: { children: ReactNode }) {
  usePublishView({ dataMode: 'none' });
  return <>{children}</>;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const session = useSession();
  const location = useLocation();
  if (session.status === 'loading')
    return (
      <NoData>
        <StatePanel kind="loading" title="Checking your session…" />
      </NoData>
    );
  if (session.status === 'error' && session.error)
    return (
      <NoData>
        <StatePanel
          kind="error"
          title="The CoursePath server could not be reached"
          detail={session.error.message}
          action={
            <button type="button" className="btn" onClick={session.retryBootstrap}>
              Try again
            </button>
          }
        />
      </NoData>
    );
  if (!session.user) {
    const next = location.pathname;
    return (
      <NoData>
        <section className="panel">
          <h1>Sign in required</h1>
          <p>This page shows your personal record or plans. Sign in or create an account to continue. The public requirements stay available without an account.</p>
          <div className="panel-row">
            <Link className="btn btn-primary" to={`/login?next=${encodeURIComponent(next)}`}>
              Sign in
            </Link>
            <Link className="btn" to={`/signup?next=${encodeURIComponent(next)}`}>
              Create account
            </Link>
            <Link to="/">Browse requirements</Link>
          </div>
        </section>
      </NoData>
    );
  }
  // The protected page publishes its own data context; publishing here too would overwrite it.
  return <>{children}</>;
}

function NotYet({ title, task, detail, tabs }: { title: string; task: string; detail: string; tabs?: { to: string; label: string }[] }) {
  usePublishView({ dataMode: 'none' });
  return (
    <div>
      {tabs ? <SubNav label="Section" items={tabs} /> : null}
      <h1>{title}</h1>
      <div className="callout">
        <p>
          <strong>Not available in this release.</strong> {detail}
        </p>
        <p className="muted">Planned for the 3 November full-feature release ({task}). No results are simulated here.</p>
      </div>
    </div>
  );
}

function NotFound() {
  usePublishView({ dataMode: 'none' });
  return (
    <section className="panel">
      <h1>Page not found</h1>
      <p>
        <Link to="/">Go to requirements</Link>
      </p>
    </section>
  );
}

export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <RequirementsPage /> },
      { path: '/login', element: <LoginPage /> },
      { path: '/signup', element: <SignupPage /> },
      { path: '/record/import', element: <ImportPage /> },
      {
        path: '/record/review/:preview_id',
        element: (
          <RequireAuth>
            <ReviewPage />
          </RequireAuth>
        ),
      },
      {
        path: '/record',
        element: (
          <RequireAuth>
            <RecordPage />
          </RequireAuth>
        ),
      },
      {
        path: '/performance',
        element: (
          <RequireAuth>
            <PerformancePage />
          </RequireAuth>
        ),
      },
      {
        path: '/awards',
        element: (
          <NotYet
            title="Awards"
            task="A09/H10"
            tabs={RECORD_TABS}
            detail="CSE honours and AI minor evaluation need the reviewed award definitions; the server currently reports these awards as unsupported."
          />
        ),
      },
      {
        path: '/plan',
        element: (
          <RequireAuth>
            <PlanIndexPage />
          </RequireAuth>
        ),
      },
      {
        path: '/plan/:plan_id',
        element: (
          <RequireAuth>
            <PlanPage />
          </RequireAuth>
        ),
      },
      {
        path: '/scenarios',
        element: <NotYet title="Scenarios" task="A09/H13" tabs={PLAN_TABS} detail="What-if and internship comparisons need the scenario API, which is not served yet." />,
      },
      {
        path: '/report/:plan_id',
        element: (
          <RequireAuth>
            <ReportPage />
          </RequireAuth>
        ),
      },
      {
        path: '/account',
        element: (
          <RequireAuth>
            <AccountPage />
          </RequireAuth>
        ),
      },
      { path: '*', element: <NotFound /> },
    ],
  },
];

interface AppRootProps {
  createClient: (onAuthExpired: () => void) => ApiClient;
  mock?: boolean;
  router?: 'browser' | 'memory';
  initialPath?: string;
}

export function AppRoot({ createClient, mock = false, router = 'browser', initialPath = '/' }: AppRootProps) {
  const instance = router === 'memory' ? createMemoryRouter(routes, { initialEntries: [initialPath] }) : createBrowserRouter(routes);
  return (
    <ResourceCacheProvider>
      <SessionProvider createClient={createClient} mock={mock}>
        <ViewContextProvider>
          <RouterProvider router={instance} />
        </ViewContextProvider>
      </SessionProvider>
    </ResourceCacheProvider>
  );
}
