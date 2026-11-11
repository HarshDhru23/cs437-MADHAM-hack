import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { endpoints } from '../../api/endpoints';
import { useRecord } from '../../api/hooks';
import { useResourceCache } from '../../api/resources';
import { useSession } from '../../app/session';
import { SYNTHETIC_SAMPLE } from './syntheticSample';

/**
 * CP-45: shown on every page to a signed-in student whose record is empty. A reviewer with no data of their own can load a made-up student (real course codes,
 * invented grades) in one click: the same import the page offers (preview, then commit of every row), so a real import later replaces it.
 */
export function SyntheticExampleBanner() {
  const { api, user } = useSession();
  const record = useRecord();
  const cache = useResourceCache();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const data = record.data;
  const empty = data !== null && data.attempts.length === 0 && data.current_enrolment.length === 0;
  if (!user || !empty || pathname.startsWith('/record/review')) return null;

  const load = async () => {
    setPending(true);
    setFailed(false);
    try {
      const preview = await endpoints.previewIms(api, SYNTHETIC_SAMPLE, data.revision);
      const committed = await endpoints.commitImport(api, preview.data.id, {
        expected_revision: data.revision,
        accepted_candidate_ids: preview.data.candidate_attempts.map((a) => a.id),
        resolutions: {},
      });
      cache.set(`record:${user.id}`, { data: committed.data, issues: [] });
      cache.invalidate('analysis:');
      navigate('/');
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="example-banner" aria-label="Synthetic example">
      <div>
        <h2>No data yet? Try the synthetic example</h2>
        <p>
          A made-up student with real course codes and invented grades (92 credits, four semesters done). Load it to explore the requirements, your performance, planning and
          scenarios without your own transcript. Importing your own data later replaces it.
        </p>
        {failed ? (
          <p role="alert" className="field-error">
            The synthetic example could not be loaded. Try again, or import your own data.
          </p>
        ) : null}
      </div>
      <div className="panel-row">
        <button type="button" className="btn btn-primary" onClick={() => void load()} disabled={pending}>
          {pending ? 'Loading…' : 'Load the synthetic example'}
        </button>
        <Link className="btn" to="/record/import">
          Import my own data
        </Link>
      </div>
    </section>
  );
}
