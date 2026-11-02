/**
 * Types for contracts v1 (`docs/team/contracts.md` section 7) and the shapes
 * returned by Harsh's Django routes (`server/README.md`). Credits are decimal
 * strings and are never converted to numbers for arithmetic in the browser.
 * Fields that the server may omit or report as unknown are nullable/optional;
 * the UI must render them as unknown rather than as healthy zero values.
 */

export const SCHEMA_VERSION = '1';

export type DecimalString = string;
export type Severity = 'error' | 'warning' | 'unknown' | 'approval_required';

export interface Issue {
  code: string;
  severity: Severity;
  message: string;
  entity_refs: string[];
  source_refs: string[];
  suggested_action: string;
}

export interface Envelope<T> {
  data: T;
  issues: Issue[];
  schema_version: string;
}

export interface SessionUser {
  id: string;
  username: string;
}

export interface SessionData {
  csrf_token: string;
  user: SessionUser | null;
}

export interface SourceReference {
  id: string;
  kind?: string;
  title?: string;
  version?: string;
  locator?: string;
  applicable_cohorts?: string[];
  effective_date?: string | null;
  review_status?: 'draft' | 'reviewed' | 'conflicted' | string;
  authority?: string;
  notes?: string;
}

/** Row-level provenance attached to imported attempts. */
export interface AttemptSourceRef {
  id: string;
  line?: number;
  page?: number;
  cell?: string;
  raw?: string;
  [key: string]: unknown;
}

export type CompletionStatus = 'completed' | 'in_progress' | 'failed' | 'withdrawn' | 'incomplete' | 'unknown';

export interface UserCorrection {
  field: string;
  raw: unknown;
  accepted: unknown;
  justification: string;
}

export interface CourseAttempt {
  id: string;
  source_key?: string | null;
  normalized_code: string;
  original_code?: string;
  title: string;
  credits: DecimalString;
  grade: string;
  term_id: string;
  completion_status: CompletionStatus;
  learning_designation: 'degree' | 'additional' | 'unknown';
  course_version_id?: string | null;
  instance_id?: string | null;
  source_refs: AttemptSourceRef[];
  user_corrections: UserCorrection[];
  approval_refs: string[];
  original?: { code?: string; title?: string; credits?: DecimalString; grade?: string };
}

export interface CurrentEnrolment {
  id: string;
  normalized_code: string;
  term_id: string;
  credits: DecimalString;
  confirmed: true;
  section_ids?: string[];
  course_version_id?: string | null;
}

export interface Profile {
  programme: string;
  admission_year: number;
  curriculum_version: string;
  standing?: string;
}

export interface ReportedControlsEntry {
  preview_id: string;
  record_revision_at_import: number;
  controls: Record<string, unknown>;
  source_refs: string[];
}

export interface AcademicRecord {
  profile: Profile;
  revision: number;
  attempts: CourseAttempt[];
  current_enrolment: CurrentEnrolment[];
  reported_controls: ReportedControlsEntry[];
  updated_at?: string;
}

export interface RecordPatch {
  expected_revision: number;
  attempts?: CourseAttempt[];
  current_enrolment?: CurrentEnrolment[];
  correction_justifications?: Record<string, string>;
}

export interface ExtractedControls {
  attempt_count?: number;
  raw_credits?: DecimalString | null;
  reported_grade_earned_credits?: DecimalString | null;
  performance_credits?: DecimalString | null;
  grade_points?: DecimalString | null;
  degree_allocated_credits?: DecimalString | null;
  status?: string;
  terms?: Record<string, { attempt_count: number; raw_credits: DecimalString }>;
}

export interface DiffEntry {
  candidate_id: string;
  attempt_id?: string | null;
  status: 'new' | 'unchanged' | 'conflicting' | string;
  existing?: Partial<CourseAttempt>;
  fields?: string[];
}

export interface UnparsedRow {
  line?: number;
  page?: number;
  raw?: string;
  reason?: string;
}

export interface ImportPreview {
  id: string;
  base_record_revision: number;
  expires_at: string;
  candidate_attempts: CourseAttempt[];
  reported_controls: Record<string, unknown>;
  extracted_controls?: ExtractedControls;
  unparsed_rows: UnparsedRow[];
  diff: DiffEntry[];
  profile_candidates?: Record<string, unknown>;
}

export interface CandidateResolution {
  fields?: Partial<Pick<CourseAttempt, 'normalized_code' | 'title' | 'credits' | 'grade' | 'term_id' | 'instance_id'>>;
  justification?: string;
  action?: 'keep_existing' | 'accept_incoming' | 'omit' | 'acknowledge';
}

export interface ImportCommitPayload {
  expected_revision: number;
  accepted_candidate_ids: string[];
  resolutions: Record<string, CandidateResolution>;
}

export interface RequirementDefinition {
  id: string;
  label?: string;
  type: string;
  minimum_credits?: DecimalString | null;
  minimum_courses?: number | null;
  course_id?: string;
  course_ids?: string[] | null;
  source_refs: string[];
  children?: RequirementDefinition[];
}

export interface NoncreditObligation {
  id: string;
  required_semesters?: number;
  required_each_active_semester?: boolean;
  recorded_grades?: string[];
  completion_policy: string | null;
  source_refs: string[];
}

export interface Curriculum {
  id: string;
  version: string;
  cohort: string;
  review_status: string;
  total_credits: DecimalString | null;
  sources: SourceReference[];
  missing_sources: string[];
  requirements: RequirementDefinition[];
  noncredit_obligations?: NoncreditObligation[];
  caps?: unknown[];
}

export interface CatalogueCourse {
  id: string;
  normalized_code: string;
  title?: string;
  credits?: DecimalString | null;
  department?: string;
  baskets?: string[];
  could_satisfy?: string[];
  prerequisite_summary?: string | null;
  offering_status?: string | null;
}

export interface Catalogue {
  courses: CatalogueCourse[];
  coverage: 'complete' | 'partial' | 'unknown' | string;
  review_status: string;
}

export type RequirementStatus = 'satisfied' | 'pending' | 'conditional' | 'needs_review';

export interface RequirementResult {
  id: string;
  label?: string;
  status: RequirementStatus;
  required_credits?: DecimalString | null;
  counted_credits?: DecimalString | null;
  remaining_credits?: DecimalString | null;
  counted_courses?: number | null;
  required_courses?: number | null;
  allocation_ids: string[];
  source_refs: string[];
  children: RequirementResult[];
  excluded_attempts?: { attempt_id: string; reason: string }[];
  issues?: Issue[];
}

export interface Allocation {
  id: string;
  attempt_id: string;
  requirement_id: string;
  credits: DecimalString;
  counting_context: string;
  source_refs: string[];
  shared_with: string[];
  explanation: string;
}

export interface AuditResult {
  actual: RequirementResult[];
  current: RequirementResult[];
  projected: RequirementResult[];
  ledger: Allocation[];
  current_ledger: Allocation[];
  projected_ledger: Allocation[];
  excluded_attempts: { attempt_id: string; reason: string }[];
  issues: Issue[];
  complete: boolean;
  rule_version: string;
  record_revision?: number;
}

export interface ContributingAttempt {
  attempt_id: string;
  credits: DecimalString;
  grade: string;
  grade_points: DecimalString;
}

export interface PerformanceValue {
  grade_points: DecimalString | null;
  performance_credits: DecimalString | null;
  unrounded_value: string | null;
  display_value: string | null;
  source_reported_value: string | null;
  complete: boolean;
  contributing_attempts: ContributingAttempt[];
  excluded_attempts: { attempt_id: string; reason: string }[];
  source_refs: string[];
  policy_id?: string;
  issues: Issue[];
  hypothetical: boolean;
}

export interface TermPerformance extends PerformanceValue {
  term_id: string;
}

export interface PerformanceResult {
  cumulative: PerformanceValue;
  terms: TermPerformance[];
  source_reported_controls?: ReportedControlsEntry[];
  issues?: Issue[];
}

export interface PlannedCourse {
  id: string;
  normalized_code: string;
  credits: DecimalString;
  course_version_id?: string | null;
  offering_id?: string | null;
  section_ids?: string[] | null;
  instance_id?: string | null;
  intended_allocation?: string | null;
  assumptions?: string[];
}

export interface RequirementPlaceholder {
  id: string;
  requirement_id: string;
  desired_credits: DecimalString;
  label?: string;
}

export interface PlannedSemester {
  term_id: string;
  courses: PlannedCourse[];
  placeholders: RequirementPlaceholder[];
}

export interface PlanPayload {
  label?: string;
  semesters: PlannedSemester[];
}

export interface AcademicPlan extends PlanPayload {
  id: string;
  revision: number;
}

export interface PerCourseValidation {
  id: string;
  term_id: string;
  eligibility: 'eligible' | 'ineligible' | 'conditional' | 'unknown';
  prerequisite_proof?: { status: string; missing: unknown[]; proof: unknown[]; source_refs: string[] };
  offering_status: string;
  meeting_check_status: 'clear' | 'conflicts' | 'not_checked';
}

export interface TermWorkload {
  selected_credits: DecimalString;
  placeholder_credits: DecimalString;
  target_credits?: DecimalString;
}

export interface PlanValidation {
  workload: Record<string, TermWorkload>;
  per_course: PerCourseValidation[];
  issues: Issue[];
  meeting_check_status: 'clear' | 'conflicts' | 'not_checked';
  completion_term: string | null;
}

export interface PlanMutationResult extends AcademicPlan {
  validation: PlanValidation;
}

export interface AnalysisRequest {
  record_revision: number;
  plan_id?: string;
  plan_revision?: number;
  award_ids?: string[];
}

export interface AnalysisResult {
  audit: AuditResult;
  performance: PerformanceResult;
  validation: PlanValidation | null;
  record_revision: number;
  plan_revision: number | null;
  rule_version: string;
}

export interface RevisionConflictData {
  current_revision: number;
  action: 'reload_compare';
}

// A09 — what-if scenarios and internship comparison (server/README.md "Scenario changes";
// coursepath/scenarios.py, coursepath/internships.py). Status and issue values are open
// strings: the UI renders unknown values generically instead of failing.

export type ScenarioChange =
  | { op: 'drop' | 'fail'; item_id: string }
  | { op: 'grade'; item_id: string; grade: string }
  | { op: 'postpone'; item_id: string; term_id: string }
  | { op: 'replace'; item_id: string; course: { normalized_code: string; credits: DecimalString } }
  | { op: 'cap'; term_id: string; credits: DecimalString };

export type ScenarioOp = ScenarioChange['op'];
export type DurationChoice = 'none' | 'three_months' | 'six_months';
export type InternshipPreset = 'summer' | 'semester' | 'custom';
export type PlacementMode = 'onsite_full_time' | 'remote_or_part_time' | 'unknown';

/** What the student enters for one IN 498 module. It never carries an approval status. */
export interface InternshipModuleInput {
  id: string;
  credits: DecimalString;
  intended_allocation: string;
  status: string;
  grade?: string | null;
  quad_id?: string | null;
  approval_ref?: string | null;
  registration_id?: string | null;
}

/** Stored internship choice. Dates are ISO strings; the end is exclusive. */
export interface InternshipInput {
  duration_choice: DurationChoice;
  preset?: InternshipPreset;
  start_date?: string | null;
  end_date_exclusive?: string | null;
  placement_mode?: PlacementMode;
  modules?: InternshipModuleInput[];
  notes?: string;
}

export interface Scenario {
  id: string;
  revision: number;
  plan_id: string;
  label: string;
  baseline_record_revision: number;
  baseline_plan_revision: number;
  rule_version: string;
  changes: ScenarioChange[];
  internship: InternshipInput | null;
  award_ids: string[];
  /** Not served yet (scenario_data has no timestamp); shown once the server adds it. */
  baseline_captured_at?: string | null;
}

export interface ScenarioCreate {
  plan_id: string;
  label: string;
  changes: ScenarioChange[];
  internship?: InternshipInput | null;
}

export interface ScenarioPatch {
  expected_revision: number;
  label?: string;
  changes?: ScenarioChange[];
  internship?: InternshipInput | null;
  rebase?: boolean;
}

export interface InternshipOverlap {
  term_id: string;
  overlap_days: number | null;
  exam_overlap: boolean | null;
  course_ids: string[];
}

export interface InternshipModuleResult {
  id: string | null;
  intended_allocation: string | null;
  /** earned / approved / proposed / rejected today; new values (for example failed) render generically. */
  status: string;
  reasons: string[];
}

export interface InternshipCredits {
  earned: DecimalString | null;
  approved: DecimalString | null;
  proposed: DecimalString | null;
  earned_by_target?: Record<string, DecimalString>;
  approved_by_target?: Record<string, DecimalString>;
  proposed_by_target?: Record<string, DecimalString>;
}

export interface InternshipEvaluation {
  id: string | null;
  duration_choice: string;
  placement_mode: string;
  start_date: string | null;
  end_date_exclusive: string | null;
  expected_end_date_exclusive: string | null;
  actual_days: number | null;
  overlapping_terms: InternshipOverlap[];
  affected_courses: string[];
  downstream_courses: string[];
  unchecked_courses: string[];
  modules: InternshipModuleResult[];
  credits: InternshipCredits;
  issues: Issue[];
}

export interface ScenarioEvaluation {
  audit: AuditResult;
  performance: PerformanceResult & { hypothetical: boolean };
  validation: PlanValidation;
  internship: InternshipEvaluation | null;
  completion_term: string | null;
  issues: Issue[];
}

export interface RequirementDelta {
  id: string;
  label?: string;
  baseline: { status: string; remaining_credits: DecimalString | null };
  scenario: { status: string; remaining_credits: DecimalString | null };
}

export interface ScenarioDeltas {
  requirements: RequirementDelta[];
  new_issues: Issue[];
  resolved_issues: Issue[];
  downstream_affected: string[];
  workload: Record<string, { baseline: DecimalString | null; scenario: DecimalString | null }>;
  cpi: { baseline: string | null; scenario: string | null; hypothetical: boolean };
  meeting_checks: Record<string, { baseline: string | null; scenario: string | null }>;
}

export interface ScenarioComparison {
  scenario_id: string;
  baseline_record_revision: number;
  baseline_plan_revision: number;
  rule_version: string;
  stale: boolean;
  baseline: ScenarioEvaluation | null;
  scenario: ScenarioEvaluation | null;
  deltas: ScenarioDeltas | null;
  issues: Issue[];
}

export interface InternshipCase extends InternshipEvaluation {
  approved_credits: DecimalString | null;
  completion_assumptions: string[];
  scenario_id: string;
}

export interface ScenarioCompareResult {
  comparisons: ScenarioComparison[];
  internship_cases: InternshipCase[];
}

export interface ScenarioNotApplied {
  op: string;
  item_id: string | null;
  term_id: string | null;
  reason: string;
}

export interface ScenarioApplyResult {
  plan: PlanMutationResult;
  not_applied: ScenarioNotApplied[];
}

export interface ScenarioApplyRequest {
  expected_plan_revision: number;
  expected_scenario_revision: number;
}

/** 409 body: `reload_compare` for a stale scenario revision, `rebase` for a stale baseline. */
export interface ScenarioConflictData {
  current_revision?: number;
  action?: string;
}
