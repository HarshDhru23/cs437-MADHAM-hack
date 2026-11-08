import { useId, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { scenarioEndpoints } from '../../api/endpoints';
import { usePlans } from '../../api/hooks';
import { useResource, useResourceCache } from '../../api/resources';
import { PLAN_TABS, SubNav } from '../../app/AppShell';
import { useSession } from '../../app/session';
import { usePublishView } from '../../app/viewContext';
import { ErrorPanel, StatePanel } from '../../components/StatePanel';
import { useDeleteScenario } from './deleteScenario';
import { durationLabel } from './model';
import './scenarios.css';

export function useScenarios() {
  const { api, user } = useSession();
  return useResource(user ? `scenarios:${user.id}` : null, (signal) => scenarioEndpoints.list(api, { signal }));
}

/** /scenarios — list the owner's scenarios and create a named clone of a saved plan. */
export function ScenariosPage() {
  const session = useSession();
  const location = useLocation();
  const notice = (location.state as { notice?: string } | null)?.notice ?? null;
  usePublishView({ dataMode: session.user ? 'scenario' : 'none' });
  return (
    <div>
      <SubNav label="Plan" items={PLAN_TABS} />
      <h1>Scenarios</h1>
      <p className="muted">
        A scenario is a hypothetical copy of one saved plan. Changes and internship choices in a scenario never change your accepted record, and they reach your
        plan only if you apply them explicitly.
      </p>
      {notice ? (
        <p className="callout" role="status">
          {notice}
        </p>
      ) : null}
      {session.status === 'loading' ? <StatePanel kind="loading" title="Checking your session…" /> : null}
      {session.status !== 'loading' && !session.user ? (
        <section className="panel">
          <h2>Sign in required</h2>
          <p>Scenarios use your personal record and plans.</p>
          <div className="panel-row">
            <Link className="btn btn-primary" to={`/login?next=${encodeURIComponent('/scenarios')}`}>
              Sign in
            </Link>
            <Link className="btn" to={`/signup?next=${encodeURIComponent('/scenarios')}`}>
              Create account
            </Link>
          </div>
        </section>
      ) : null}
      {session.user ? <ScenarioList /> : null}
    </div>
  );
}

function ScenarioList() {
  const session = useSession();
  const plans = usePlans();
  const scenarios = useScenarios();
  const cache = useResourceCache();
  const navigate = useNavigate();
  const formId = useId();
  const [label, setLabel] = useState('');
  const [planId, setPlanId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);
  const removal = useDeleteScenario({ onDeleted: () => undefined });

  if (plans.loading || scenarios.loading) return <StatePanel kind="loading" title="Loading your scenarios…" />;
  if (plans.error) return <ErrorPanel error={plans.error} onRetry={plans.reload} />;
  if (scenarios.error) return <ErrorPanel error={scenarios.error} onRetry={scenarios.reload} />;
  const planList = plans.data ?? [];
  const list = scenarios.data?.scenarios ?? [];
  const chosen = planList.length === 1 ? planList[0]!.id : planId;
  const planName = (id: string) => planList.find((p) => p.id === id)?.label || 'Untitled plan';

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!label.trim()) return setError('Give the scenario a name.');
    if (!chosen) return setError('Choose the plan to copy.');
    setError(null);
    setApiError(null);
    setPending(true);
    try {
      const created = await scenarioEndpoints.create(session.api, { plan_id: chosen, label: label.trim(), changes: [] });
      cache.invalidate('scenarios:');
      navigate(`/scenarios/${encodeURIComponent(created.data.id)}`);
    } catch (e) {
      setApiError(e instanceof ApiError ? e : new ApiError('server', 0, String(e), []));
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <section className="panel" aria-labelledby={`${formId}-list`}>
        <h2 id={`${formId}-list`}>Your scenarios</h2>
        {removal.notice}
        {list.length === 0 ? (
          <p>You have no scenarios yet.</p>
        ) : (
          <ul className="scenario-list" aria-label="Your scenarios">
            {list.map((s) => (
              <li key={s.id} className="chip scenario-row">
                <Link to={`/scenarios/${encodeURIComponent(s.id)}`}>{s.label || 'Untitled scenario'}</Link>{' '}
                <span className="muted">
                  · copy of {planName(s.plan_id)} · {s.changes.length === 1 ? '1 change' : `${s.changes.length} changes`} · internship:{' '}
                  {s.internship ? durationLabel(s.internship.duration_choice) : 'not chosen'}
                </span>{' '}
                <button
                  type="button"
                  className="btn btn-small btn-danger"
                  aria-label={`Delete scenario ${s.label || 'Untitled scenario'}`}
                  disabled={removal.busyId !== null}
                  onClick={() => removal.ask({ id: s.id, label: s.label || 'Untitled scenario', revision: s.revision })}
                >
                  {removal.busyId === s.id ? 'Deleting…' : 'Delete'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {removal.confirmation}
      <section className="panel" aria-labelledby={`${formId}-new`}>
        <h2 id={`${formId}-new`}>New scenario</h2>
        {planList.length === 0 ? (
          <p>
            A scenario copies a saved plan. <Link to="/plan">Create a plan first</Link>.
          </p>
        ) : (
          <form onSubmit={create} noValidate>
            <div className="field">
              <label htmlFor={`${formId}-label`}>Scenario name</label>
              <input id={`${formId}-label`} type="text" value={label} maxLength={200} onChange={(e) => setLabel(e.target.value)} />
            </div>
            {planList.length > 1 ? (
              <div className="field">
                <label htmlFor={`${formId}-plan`}>Plan to copy</label>
                <select id={`${formId}-plan`} value={planId} onChange={(e) => setPlanId(e.target.value)}>
                  <option value="">Choose a plan</option>
                  {planList.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label || 'Untitled plan'}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="muted">Copies your saved plan “{planName(chosen)}” as it is now.</p>
            )}
            {error ? (
              <p className="field-error" role="alert">
                {error}
              </p>
            ) : null}
            {apiError ? <ErrorPanel error={apiError} /> : null}
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? 'Creating…' : 'Create scenario'}
            </button>
          </form>
        )}
      </section>
    </>
  );
}
