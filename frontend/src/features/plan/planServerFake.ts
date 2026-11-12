/** A small fake of the plan API for the tests of the add box and the calmer plan page (CP-49, CP-50). Its numbers are the server's: the page must show them, not sum anything itself. */
import type { AcademicPlan, CatalogueCourse, PlanPayload, PlanValidation } from '../../api/types';
import { curriculum, plan, record } from '../../test/fixtures';
import { fakeApi, issue } from '../../test/harness';

export type Patch = PlanPayload & { expected_revision: number };

export function validationFor(p: AcademicPlan): PlanValidation {
  const workload: PlanValidation['workload'] = {};
  for (const s of p.semesters) {
    const sel = s.courses.reduce((a, c) => a + Number(c.credits), 0);
    const ph = s.placeholders.reduce((a, c) => a + Number(c.desired_credits), 0);
    workload[s.term_id] = { selected_credits: String(sel), placeholder_credits: String(ph), target_credits: String(sel + ph) };
  }
  return {
    workload,
    per_course: p.semesters.flatMap((s) =>
      s.courses.map((c) => ({ id: c.id, term_id: s.term_id, eligibility: 'unknown' as const, prerequisite_proof: { status: 'unknown', missing: [], proof: [], source_refs: [] }, offering_status: 'unknown', meeting_check_status: 'not_checked' as const })),
    ),
    issues: p.semesters.flatMap((s) => s.placeholders.map((ph) => issue('PLACEHOLDER_UNRESOLVED', 'unknown', [ph.id], 'Select actual courses before eligibility or completion can be established.') as PlanValidation['issues'][number])),
    meeting_check_status: 'not_checked',
    completion_term: null,
  };
}

export function planServer(opts: { catalogue?: CatalogueCourse[]; room?: string } = {}) {
  let current: AcademicPlan = structuredClone(plan);
  const patches: Patch[] = [];
  const api = fakeApi({
    'GET /record': () => ({ data: record }),
    'GET /curricula/cse-2024': () => ({ data: curriculum }),
    'GET /catalogue': () => (opts.catalogue ? { data: { courses: opts.catalogue, coverage: 'partial', review_status: 'reviewed' } } : { data: { courses: [], coverage: 'unknown', review_status: 'draft' }, issues: [issue('CATALOGUE_MISSING')] }),
    'GET /plans/:id': () => ({ data: current }),
    'POST /plans/:id/validate': () => ({ data: validationFor(current) }),
    'POST /plans/check': (req) => {
      const body = req.body as { semesters: AcademicPlan['semesters'] };
      const load = Object.fromEntries(body.semesters.map((s) => [s.term_id, { planned_credits: '20', limit_credits: s.term_id.endsWith('SUMMER') ? '10' : '28', available_credits: s.term_id.endsWith('SUMMER') ? '0' : (opts.room ?? '8') }]));
      return {
        data: {
          validation: validationFor(current),
          degree: { total_credits: '170', counted_credits: '150', remaining_credits: '20' },
          placeholder_credits: '4',
          uncovered_credits: '16',
          requirements: [{ id: 'open-electives', label: 'Open electives', group: 'Open electives', required_credits: '16', counted_credits: '0', remaining_credits: '16', held_credits: '4', uncovered_credits: '12' }],
          online: { planned_credits: '6', counted_credits: '4' },
          load,
        },
      };
    },
    'PATCH /plans/:id': (req) => {
      const body = req.body as Patch;
      patches.push(body);
      current = { id: current.id, revision: current.revision + 1, label: body.label, semesters: body.semesters };
      return { data: { ...current, validation: validationFor(current) } };
    },
  });
  return { fetchImpl: api.fetchImpl, patches, get current() { return current; } };
}
