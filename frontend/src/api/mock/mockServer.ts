/**
 * DEVELOPMENT-ONLY synthetic API used by `npm run dev:mock`. It exists so UI
 * states can be explored without the Django server. It is never bundled into
 * `npm run build` (see main.tsx) and the shell shows a visible banner while it
 * is active. It does not parse, audit or calculate anything: responses are
 * fixed synthetic examples. Unimplemented routes return 404, never success.
 */
import checkExample from '../../../../examples/plan-check.json';
import generationExample from '../../../../examples/plan-generation.json';
import { analysis, curriculum, plan, preview, record } from '../../test/fixtures';
import type { AcademicPlan, AcademicRecord } from '../types';

export function createMockFetch(): typeof fetch {
  let user: { id: string; username: string } | null = null;
  let rec: AcademicRecord = { ...structuredClone(record), attempts: [], revision: 0, reported_controls: [] };
  let plans: AcademicPlan[] = [structuredClone(plan)];
  const reply = (data: unknown, status = 200, issues: unknown[] = []) =>
    new Response(JSON.stringify({ data, issues, schema_version: '1' }), { status, headers: { 'Content-Type': 'application/json' } });
  const mockIssue = (code: string, message: string) => ({ code, severity: 'unknown', message, entity_refs: [], source_refs: [], suggested_action: 'Development mock only.' });

  return async (input, init) => {
    await new Promise((r) => setTimeout(r, 150));
    const url = new URL(String(input), 'http://mock.local');
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    const key = `${method} ${path}`;
    if (key === 'GET /session') return reply({ csrf_token: 'mock-token', user });
    if (key === 'POST /auth/signup' || key === 'POST /auth/login') {
      user = { id: 'mock-1', username: String(body.username ?? 'mock-student') };
      return reply(user, key.endsWith('signup') ? 201 : 200);
    }
    if (key === 'POST /auth/logout') {
      user = null;
      return reply(null);
    }
    if (key === 'GET /curricula/cse-2024') return reply(curriculum, 200, [mockIssue('SOURCE_MISSING', 'Mock curriculum (synthetic).')]);
    if (key === 'GET /catalogue') return reply({ courses: [], coverage: 'unknown', review_status: 'draft' }, 200, [mockIssue('CATALOGUE_MISSING', 'No catalogue in mock mode.')]);
    if (!user) return reply(null, 401, [mockIssue('AUTHENTICATION_REQUIRED', 'Sign in (mock).')]);
    if (key === 'GET /record') return reply(rec);
    if (key === 'PATCH /record') {
      if (body.expected_revision !== rec.revision) return reply({ current_revision: rec.revision, action: 'reload_compare' }, 409, [mockIssue('REVISION_CONFLICT', 'Stale (mock).')]);
      rec = { ...rec, revision: rec.revision + 1, ...(body.attempts ? { attempts: body.attempts } : {}), ...(body.current_enrolment ? { current_enrolment: body.current_enrolment } : {}) };
      return reply(rec);
    }
    if (key === 'POST /imports/preview') return reply({ ...preview, base_record_revision: rec.revision }, 201, [mockIssue('UNMATCHED_COURSE', 'Mock preview: fixed synthetic rows regardless of input.')]);
    if (method === 'POST' && /^\/imports\/[^/]+\/commit$/.test(path)) {
      const ids: string[] = body.accepted_candidate_ids ?? [];
      rec = { ...rec, revision: rec.revision + 1, attempts: [...rec.attempts, ...preview.candidate_attempts.filter((c) => ids.includes(c.id))] };
      return reply(rec);
    }
    // The generate route answers with the contract example verbatim (examples/plan-generation.json), never a look-alike.
    if (key === 'POST /plans/generate') {
      if (body.record_revision !== rec.revision) return reply({ current_revision: rec.revision, action: 'reload_compare' }, 409, [mockIssue('REVISION_CONFLICT', 'Stale (mock).')]);
      return reply(generationExample.data, 200, generationExample.issues);
    }
    if (key === 'POST /plans/check') {
      if (body.record_revision !== rec.revision) return reply({ current_revision: rec.revision, action: 'reload_compare' }, 409, [mockIssue('REVISION_CONFLICT', 'Stale (mock).')]);
      return reply(checkExample.data, 200, checkExample.issues);
    }
    if (key === 'GET /plans') return reply(plans);
    if (key === 'POST /plans') {
      const created = { id: `mock-plan-${plans.length + 1}`, revision: 0, label: body.label, semesters: body.semesters };
      plans = [...plans, created];
      return reply({ ...created, validation: analysis.validation ?? { workload: {}, per_course: [], issues: [], meeting_check_status: 'not_checked', completion_term: null } }, 201);
    }
    const planMatch = /^\/plans\/([^/]+)(\/validate)?$/.exec(path);
    if (planMatch) {
      const found = plans.find((p) => p.id === planMatch[1]);
      if (!found) return reply(null, 404, [mockIssue('NOT_FOUND', 'No such plan (mock).')]);
      const validation = { workload: {}, per_course: [], issues: [mockIssue('MOCK_VALIDATION', 'Mock mode does not validate plans.')], meeting_check_status: 'not_checked', completion_term: null };
      if (planMatch[2]) return reply(validation);
      if (method === 'GET') return reply(found);
      if (method === 'PATCH') {
        if (body.expected_revision !== found.revision) return reply({ current_revision: found.revision, action: 'reload_compare' }, 409, [mockIssue('REVISION_CONFLICT', 'Stale (mock).')]);
        const updated = { ...found, revision: found.revision + 1, label: body.label, semesters: body.semesters };
        plans = plans.map((p) => (p.id === found.id ? updated : p));
        return reply({ ...updated, validation });
      }
    }
    if (key === 'POST /analysis') return reply({ ...analysis, record_revision: rec.revision }, 200, analysis.audit.issues);
    return reply(null, 404, [mockIssue('MOCK_ROUTE_MISSING', `The development mock does not implement ${key}.`)]);
  };
}
