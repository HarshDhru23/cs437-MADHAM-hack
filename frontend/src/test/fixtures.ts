/**
 * Synthetic fixtures shaped like the real `/api/v1` responses observed from
 * Harsh's backend (de7a0ab, merged to main in a51399e). Codes use ZZ/YY
 * prefixes or explicitly synthetic titles; no real student data.
 */
import type { AcademicPlan, AcademicRecord, AnalysisResult, CourseAttempt, Curriculum, ImportPreview, RequirementResult } from '../api/types';

export const curriculum: Curriculum = {
  id: 'cse-2024',
  version: 'cse-2024-draft-v1',
  cohort: 'BTECH_CSE-2024',
  review_status: 'draft',
  total_credits: '170',
  sources: [
    {
      id: 'committed-roadmap',
      kind: 'student_example',
      title: 'Committed implementation roadmap (secondary planning evidence)',
      version: 'a53e7d3',
      locator: 'docs/implementation-roadmap.md sections 3.1-3.2',
      review_status: 'draft',
      authority: 'example',
    },
  ],
  missing_sources: ['Reviewed catalogue and basket memberships', 'Equivalence/substitution decisions'],
  requirements: [
    {
      id: 'hss',
      label: 'HSS (GE included)',
      type: 'all_of',
      minimum_credits: '28',
      source_refs: ['committed-roadmap'],
      children: [
        { id: 'hs191', type: 'mandatory_course', course_id: 'HS 191', minimum_credits: '2', source_refs: ['committed-roadmap'] },
        { id: 'ge', type: 'choose_courses', minimum_courses: 2, minimum_credits: '4', course_ids: null, source_refs: ['committed-roadmap'] },
      ],
    },
    { id: 'science-basket', type: 'minimum_credits', minimum_credits: '8', course_ids: null, source_refs: ['committed-roadmap'] },
    { id: 'bs-elective', type: 'minimum_credits', minimum_credits: '4', course_ids: null, source_refs: ['committed-roadmap'] },
    {
      id: 'cse-core',
      type: 'all_of',
      minimum_credits: '36',
      source_refs: ['committed-roadmap'],
      children: [
        { id: 'dsa', type: 'mandatory_course', course_id: 'ES 242', minimum_credits: '4', source_refs: ['committed-roadmap'] },
        { id: 'tools', type: 'mandatory_course', course_id: 'CS 202', minimum_credits: '4', source_refs: ['committed-roadmap'] },
      ],
    },
    {
      id: 'cse-electives',
      type: 'all_of',
      minimum_credits: '26',
      source_refs: ['committed-roadmap'],
      children: [
        { id: 'theory', type: 'minimum_credits', minimum_credits: '8', course_ids: ['ZZ 301', 'ZZ 614'], source_refs: ['committed-roadmap'] },
        { id: 'systems', type: 'minimum_credits', minimum_credits: '8', course_ids: ['ZZ 327'], source_refs: ['committed-roadmap'] },
        { id: 'cse-general', type: 'minimum_credits', minimum_credits: '10', course_ids: null, source_refs: ['committed-roadmap'] },
      ],
    },
  ],
  noncredit_obligations: [
    { id: 'pe', required_semesters: 4, completion_policy: null, source_refs: ['committed-roadmap'] },
    { id: 'viva', required_each_active_semester: true, recorded_grades: ['P', 'F'], completion_policy: null, source_refs: ['committed-roadmap'] },
  ],
  caps: [],
};

export function attempt(over: Partial<CourseAttempt> & Pick<CourseAttempt, 'id' | 'normalized_code'>): CourseAttempt {
  return {
    title: 'Synthetic course',
    credits: '4',
    grade: 'A',
    term_id: '2024-25-I',
    completion_status: 'completed',
    learning_designation: 'unknown',
    course_version_id: null,
    instance_id: null,
    source_refs: [{ id: 'ims-v1', line: 2, raw: `2024-25 Semester I\t${over.normalized_code}\tSynthetic course\t4\tA` }],
    user_corrections: [],
    approval_refs: [],
    original: { code: over.normalized_code, title: 'Synthetic course', credits: '4', grade: 'A' },
    ...over,
  };
}

export const record: AcademicRecord = {
  profile: { programme: 'BTECH_CSE', admission_year: 2024, curriculum_version: 'cse-2024-draft-v1' },
  revision: 3,
  attempts: [
    attempt({ id: 'a-dsa', normalized_code: 'ES 242(N)', title: 'Synthetic data structures', term_id: '2024-25-I' }),
    attempt({ id: 'a-fail', normalized_code: 'ZZ 103', title: 'Synthetic failed maths', grade: 'F', completion_status: 'failed', term_id: '2024-25-II' }),
    attempt({ id: 'a-tools', normalized_code: 'CS 203', title: 'Synthetic tools course', term_id: '2025-26-II' }),
    attempt({ id: 'a-proj-1', normalized_code: 'ZZ 299', title: 'Synthetic project', grade: 'P', term_id: '2025-26-I' }),
    attempt({ id: 'a-proj-2', normalized_code: 'ZZ 299', title: 'Synthetic project', grade: 'A', term_id: '2025-26-II' }),
  ],
  current_enrolment: [],
  reported_controls: [{ preview_id: 'p1', record_revision_at_import: 1, controls: { earned_credits: '104', cpi: '9.23' }, source_refs: ['pdf-v1'] }],
};

function node(id: string, status: RequirementResult['status'], required: string, counted: string, children: RequirementResult[] = [], allocation_ids: string[] = [], label?: string): RequirementResult {
  return {
    id,
    label: label ?? id,
    status,
    required_credits: required,
    counted_credits: counted,
    remaining_credits: String(Math.max(0, Number(required) - Number(counted))),
    counted_courses: allocation_ids.length,
    required_courses: null,
    allocation_ids,
    source_refs: ['committed-roadmap'],
    children,
  };
}

const actualTree: RequirementResult[] = [
  node('hss', 'needs_review', '28', '0', [node('hs191', 'needs_review', '2', '0'), node('ge', 'needs_review', '4', '0')], [], 'HSS (GE included)'),
  node('science-basket', 'needs_review', '8', '0'),
  node('bs-elective', 'needs_review', '4', '0'),
  node('cse-core', 'pending', '36', '4', [node('dsa', 'satisfied', '4', '4', [], ['allocation:a-dsa:dsa']), node('tools', 'needs_review', '4', '0')]),
  node('cse-electives', 'needs_review', '26', '26', [node('theory', 'needs_review', '8', '8'), node('systems', 'needs_review', '8', '8'), node('cse-general', 'needs_review', '10', '10')]),
];

export const analysis: AnalysisResult = {
  audit: {
    actual: actualTree,
    current: actualTree.map((n) => (n.id === 'cse-core' ? { ...n, status: 'conditional', counted_credits: '8' } : n)),
    projected: actualTree.map((n) => (n.id === 'hss' ? { ...n, status: 'conditional' } : n)),
    ledger: [
      {
        id: 'allocation:a-dsa:dsa',
        attempt_id: 'a-dsa',
        requirement_id: 'dsa',
        credits: '4',
        counting_context: 'base',
        source_refs: ['committed-roadmap'],
        shared_with: [],
        explanation: 'One indivisible eligible completed instance, allocated once.',
      },
    ],
    current_ledger: [],
    projected_ledger: [],
    excluded_attempts: [
      { attempt_id: 'a-fail', reason: 'NOT_COMPLETED' },
      { attempt_id: 'a-tools', reason: 'LEARNING_DESIGNATION_UNKNOWN' },
    ],
    issues: [
      {
        code: 'EQUIVALENCE_UNCONFIRMED',
        severity: 'unknown',
        message: 'CS 203 does not establish CS 202 completion.',
        entity_refs: ['a-tools'],
        source_refs: [],
        suggested_action: 'Obtain an applicable reviewed equivalence decision.',
      },
      { code: 'SOURCE_MISSING', severity: 'unknown', message: 'Curriculum is draft; no official completion verdict is available.', entity_refs: [], source_refs: [], suggested_action: 'Review.' },
    ],
    complete: false,
    rule_version: 'cse-2024-draft-v1',
    record_revision: 3,
  },
  performance: {
    cumulative: {
      grade_points: '849',
      performance_credits: '92',
      unrounded_value: '9.228260869565217391304347826086956521739',
      display_value: '9.23',
      source_reported_value: '9.23',
      complete: false,
      contributing_attempts: [
        { attempt_id: 'a-dsa', credits: '4', grade: 'A', grade_points: '40' },
        { attempt_id: 'a-fail', credits: '4', grade: 'F', grade_points: '0' },
      ],
      excluded_attempts: [{ attempt_id: 'a-proj-1', reason: 'PERFORMANCE_EXCLUDED_GRADE' }],
      source_refs: ['docs/implementation-roadmap.md#cpi-and-spi'],
      policy_id: 'synthetic-policy',
      issues: [],
      hypothetical: false,
    },
    terms: [
      {
        term_id: '2024-25-I',
        grade_points: '40',
        performance_credits: '4',
        unrounded_value: '10',
        display_value: '10.00',
        source_reported_value: null,
        complete: true,
        contributing_attempts: [{ attempt_id: 'a-dsa', credits: '4', grade: 'A', grade_points: '40' }],
        excluded_attempts: [],
        source_refs: [],
        issues: [],
        hypothetical: false,
      },
      {
        term_id: '2025-26-I',
        grade_points: '0',
        performance_credits: '0',
        unrounded_value: null,
        display_value: null,
        source_reported_value: null,
        complete: false,
        contributing_attempts: [],
        excluded_attempts: [{ attempt_id: 'a-proj-1', reason: 'PERFORMANCE_EXCLUDED_GRADE' }],
        source_refs: [],
        issues: [],
        hypothetical: false,
      },
    ],
    source_reported_controls: [],
  },
  validation: null,
  record_revision: 3,
  plan_revision: null,
  rule_version: 'cse-2024-draft-v1',
};

export const plan: AcademicPlan = {
  id: 'plan-1',
  revision: 2,
  label: 'Main plan',
  semesters: [
    { term_id: '2026-27-I', courses: [{ id: 'c-os', normalized_code: 'ZZ 330', credits: '4' }], placeholders: [] },
    { term_id: '2026-27-II', courses: [{ id: 'c-net', normalized_code: 'ZZ 331', credits: '4' }], placeholders: [{ id: 'ph-1', requirement_id: 'hss', desired_credits: '4', label: 'HSS elective' }] },
    { term_id: '2027-28-I', courses: [], placeholders: [] },
    { term_id: '2027-28-II', courses: [], placeholders: [] },
  ],
};

export const preview: ImportPreview = {
  id: '6f4a43e3-8ad7-4db6-a624-c71da99cd27e',
  base_record_revision: 0,
  expires_at: '2026-10-24T08:47:04+00:00',
  candidate_attempts: [
    attempt({ id: 'cand-1', normalized_code: 'ZZ 242(N)', title: 'Synthetic data structures', term_id: '2024-25-I', grade: 'A-' }),
    attempt({ id: 'cand-2', normalized_code: 'ZZ 372', title: 'Synthetic short course', credits: '1', grade: 'B', term_id: '2024-25-II' }),
    attempt({ id: 'cand-3', normalized_code: 'CS 203', title: 'Synthetic tools', term_id: '2025-26-II' }),
  ],
  reported_controls: {},
  extracted_controls: {
    attempt_count: 3,
    raw_credits: '9',
    performance_credits: '9',
    grade_points: '85',
    degree_allocated_credits: null,
    status: 'arithmetic_only',
    terms: { '2024-25-I': { attempt_count: 1, raw_credits: '4' }, '2024-25-II': { attempt_count: 1, raw_credits: '1' }, '2025-26-II': { attempt_count: 1, raw_credits: '4' } },
  },
  unparsed_rows: [{ line: 8, raw: 'garbage row here' }],
  diff: [
    { candidate_id: 'cand-1', attempt_id: 'cand-1', status: 'new' },
    { candidate_id: 'cand-2', attempt_id: 'cand-2', status: 'new' },
    { candidate_id: 'cand-3', attempt_id: 'cand-3', status: 'new' },
  ],
};
