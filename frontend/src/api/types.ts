/**
 * Types for contracts v1 (`docs/team/contracts.md` section 7) and the shapes
 * returned by Harsh's Django routes (`server/README.md`). Credits are decimal
 * strings and are never converted to numbers for arithmetic in the browser.
 * Fields that the server may omit or report as unknown are nullable/optional;
 * the UI must render them as unknown rather than as healthy zero values.
 */

export const SCHEMA_VERSION = '1';

export type DecimalString = string;
export type Severity = 'error' | 'warning' | 'info' | 'unknown' | 'approval_required';

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
  /**
   * How THIS account proves itself before deleting data (D-46): `password` sends its password; `google` (no usable password) sends a fresh Google
   * credential. It follows the account, not `sign_in`, which is site-wide: a legacy password account stays `password` while Google is configured.
   */
  reauth: 'password' | 'google';
}

/** What the sign-in page offers (D-46). With a Google client ID only IITGN Google accounts sign in and the password forms are off. */
export interface SignInOptions {
  /** The public OAuth client ID for Google sign-in, or null when it is not configured. */
  google_client_id: string | null;
  google_domain: string;
  /** Whether username and password sign-up and sign-in are offered. */
  password: boolean;
}

export interface SessionData {
  csrf_token: string;
  user: SessionUser | null;
  sign_in?: SignInOptions;
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
  /** null for a saved imported course the new import no longer has (status 'removed'). */
  candidate_id: string | null;
  attempt_id?: string | null;
  /** 'replaced': a saved imported course the new import changes; the new import replaces it. 'removed': it is not in the new import. */
  status: 'new' | 'unchanged' | 'conflicting' | 'replaced' | 'removed' | string;
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
  /** Any course not needed elsewhere can fill this requirement (open electives). */
  any_course?: boolean;
  course_prefixes?: string[];
  course_patterns?: string[];
  source_refs: string[];
  /** Where in the source the rule sits, e.g. "p. 14; codes from p. 23". */
  source_locator?: string;
  /** A TEAM decision in docs/academic-decisions.md, e.g. "D-03". */
  decision?: string;
  children?: RequirementDefinition[];
}

export interface NoncreditObligation {
  id: string;
  label?: string;
  decision?: string;
  source_locator?: string;
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
  /** Credits counted beyond the requirement (D-07); never reused elsewhere. */
  surplus_credits?: DecimalString | null;
  /** Viva: active semesters still without a recorded P (D-16). */
  missing_terms?: string[];
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

export interface DegreeProgress {
  total_credits: DecimalString;
  counted_credits: DecimalString;
  remaining_credits: DecimalString;
}

export interface AuditResult {
  /** Credits counted toward the degree total (170 for CSE 2024) in each view; the server computes them. */
  degree?: { actual: DegreeProgress; current: DegreeProgress; projected: DegreeProgress };
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
  /** An online course (taken in a semester or a break): it counts against the pool of 16 online credits. */
  online?: boolean;
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

/** D-45: a plan is valid when its check finds no error and no degree requirement is left uncovered. The server decides; a plan that is not valid can still be saved. */
export interface PlanStatus {
  valid: boolean;
  /** Error-severity problems in the plan's check. */
  problems: number;
  /** Degree credits the plan leaves uncovered. */
  uncovered_credits: DecimalString;
}

export interface AcademicPlan extends PlanPayload {
  id: string;
  revision: number;
  /** Computed by the server from the plan and the current record whenever plans are read or saved. */
  status?: PlanStatus;
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
  /** Confirmed current enrolment in this term that is not also in the plan; included in `target_credits`. */
  enrolled_credits?: DecimalString;
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

// A08: term offering snapshots, meeting groups and per-term clash checks
// (`GET /offerings?term_id=`, plan validation `meeting_checks`). Interface
// merging adds the server's extra validation fields without editing above.

/** Snapshot cell reference, for example `{ id: 'SRC-X', locator: 'Time table!K3' }`. */
export interface SnapshotSourceRef {
  id: string;
  locator?: string | null;
}

/** Times are minutes from midnight (end-exclusive); weekday 0 is Monday. */
export interface OfferingMeeting {
  id: string;
  kind?: string | null;
  weekday: number;
  start_minute: number;
  end_minute: number;
  active_start_date?: string | null;
  active_end_date?: string | null;
  room?: string | null;
  room_options?: string[];
  delivery_note?: string | null;
  original_slot?: string | null;
  source_refs?: SnapshotSourceRef[];
  offering_id?: string;
  group_id?: string;
}

export interface MeetingGroup {
  id: string;
  kind?: string | null;
  raw_text?: string | null;
  /** `all_required`, `choose_one` or `unknown`; any other value is treated as unknown. */
  selection_semantics: string;
  section_labels?: string[];
  notes?: string[];
  unresolved?: string[];
  meetings: OfferingMeeting[];
  source_refs?: SnapshotSourceRef[];
}

export interface CourseOffering {
  id: string;
  term_id?: string;
  code: string;
  display_code?: string;
  raw_label?: string | null;
  suffix?: string | null;
  title?: string | null;
  credits?: DecimalString | null;
  section_labels?: string[];
  meeting_groups: MeetingGroup[];
  availability_status?: string;
  remarks?: string | null;
  source_refs?: SnapshotSourceRef[];
}

export interface TermOfferingSnapshot {
  id: string | null;
  term_id: string;
  coverage: 'complete' | 'partial' | 'unknown' | string;
  review_status: 'draft' | 'reviewed' | 'conflicted' | string | null;
  publication_status?: string | null;
  revision_date?: string | null;
  offerings: CourseOffering[];
  slot_map?: Record<string, unknown>;
  source_refs?: SourceReference[];
}

export interface MeetingConflict {
  id: string;
  item_ids: string[];
  meeting_ids: string[];
  kinds: (string | null)[];
  weekday: number;
  start_minute: number;
  end_minute: number;
  certain: boolean;
  assumptions: string[];
  source_refs: SnapshotSourceRef[];
}

export type MeetingCheckStatus = 'clear' | 'conflicts' | 'not_checked';

export interface TermMeetingCheck {
  status: MeetingCheckStatus;
  conflicts: MeetingConflict[];
}

export interface PlanValidation {
  meeting_checks?: Record<string, TermMeetingCheck>;
}

export interface PerCourseValidation {
  offering_ids?: string[];
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

/** Ready-made internship dates from the academic calendar (GET /calendar): the student picks one instead of typing dates. */
export interface InternshipPresetOption {
  duration_choice: Exclude<DurationChoice, 'none'>;
  preset: Exclude<InternshipPreset, 'custom'>;
  term_id: string;
  start_date: string;
  end_date_exclusive: string;
}

export interface CalendarData {
  terms: { id: string }[];
  internship_presets: InternshipPresetOption[];
}

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

// A11: backup export/restore, account-data deletion and the report's scenario
// lookup. Shapes follow server/api/views.py (export, backup_preview,
// _restore_backup, account_data, scenario_detail) and server/README.md.

/** `GET /export?kind=json` data. Saved to disk inside its envelope, exactly as served. */
export interface BackupData {
  kind: string;
  backup_version: string;
  exported_at: string;
  account: { username: string };
  rule_version: string;
  rule_review_status: string;
  sources: SourceReference[];
  missing_sources: string[];
  grading_policy: { id: string; review_status: string };
  record: AcademicRecord;
  plans: AcademicPlan[];
  scenarios: Scenario[];
}

/** Restore diff as the server computes it. Extra keys the server adds are shown as reported. */
export interface BackupDiff {
  attempts_added: string[];
  attempts_removed: string[];
  attempts_changed: string[];
  attempts_unchanged: number;
  current_enrolment_changed: boolean;
  plans_to_create: number;
  scenarios_not_restored: number;
  [key: string]: unknown;
}

export interface BackupPreview {
  id: string;
  kind: 'backup';
  base_record_revision: number;
  expires_at: string;
  diff: BackupDiff;
}

export interface BackupCommitPayload {
  expected_revision: number;
  confirm: true;
}

export interface DeleteDataPayload {
  expected_revision: number;
  /** A password account confirms with its password; a Google-only account (no password) sends `google_credential` instead. */
  password?: string;
  google_credential?: string;
  /** The typed phrase; the server accepts only "delete my data". */
  confirm: string;
  delete_account: boolean;
}

export interface DeleteDataResult {
  deleted: Record<string, number>;
  account_deleted: boolean;
  record_revision: number | null;
  retention: string;
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

/** 409 body for a stale baseline on apply: the schema's `scenario_stale` (examples/scenario-stale.json). */
export interface ScenarioStaleData {
  action: 'rebase';
  scenario_revision: number;
  current_record_revision: number;
  current_plan_revision: number;
  current_rule_version: string;
  baseline_record_revision: number;
  baseline_plan_revision: number;
  rule_version: string;
}

/** 409 body: `reload_compare` for a stale scenario or plan revision, `rebase` for a stale baseline. */
export type ScenarioConflictData = RevisionConflictData | ScenarioStaleData;

// D-35 / CP-35 — POST /plans/generate (schemas `plan_generation`, examples/plan-generation.json).
// A draft plan for the remaining degree. Nothing is saved by generating; the client saves `semesters` through POST /plans.

export type PlacementBasis = 'confirmed_offering' | 'expected_pattern' | 'student_choice' | string;

export interface GeneratedPlacement {
  item_id: string;
  kind: 'course' | 'placeholder' | string;
  term_id: string;
  normalized_code?: string | null;
  title?: string | null;
  credits: DecimalString;
  requirement_id: string;
  requirement_label: string;
  basis: PlacementBasis;
  reason: string;
  offering_ids?: string[];
}

export interface GeneratedUnmet {
  requirement_id: string;
  label: string;
  remaining_credits: DecimalString;
  remaining_courses?: number;
  reason_code: string;
  reason: string;
  placeholder_ids?: string[];
}

export interface GenerationOptions {
  terms?: string[];
  target_credits_per_term?: DecimalString;
  max_credits_per_term?: DecimalString;
  skip_terms?: string[];
  /** A term spent on an internship: it holds internship modules and online courses, and may allow finishing a semester early. */
  internship_term?: string | null;
  /** Spread the work evenly over the same semesters and use online credits in the breaks to lower each semester's load. */
  lighten_with_online?: boolean;
  /** false: plan from the completed courses alone and plan the running semester again; true (the default): count the confirmed current courses as taken. */
  include_current?: boolean;
}

/** What online courses in the breaks and the internship semester could do for a plan. */
export interface OnlinePotential {
  /** Online credits still available to this plan (at most 16). */
  credits_available: DecimalString;
  break_terms: string[];
  /** The plan's busiest regular semester. */
  busiest_semester_credits: DecimalString;
  /** The busiest semester before the plan was lightened with online credits, when it was. */
  busiest_before: DecimalString | null;
  lightened: boolean;
}

export interface PlanGraduation {
  internship_term: string | null;
  /** true: finishes a semester early; false: tried and not possible; null: not tried. */
  early: boolean | null;
  last_term: string | null;
  /** The last semester of the usual eight-semester horizon; `early` means the plan ends before it. */
  usual_last_term: string | null;
  /** Credits of online courses the plan uses (taken in the breaks) to end earlier; '0' when none. */
  online_credits: DecimalString;
  message: string | null;
}

/** POST /plans/check: an unsaved plan checked like a saved one. Saves nothing. */
export interface PlanCheckRequirement {
  id: string;
  label: string;
  /** The top-level group it belongs to, for example 'Humanities and Social Sciences (GE included)'. */
  group: string;
  required_credits: DecimalString;
  counted_credits: DecimalString;
  remaining_credits: DecimalString;
  /** Credits placeholders hold for it, never more than it still needs. */
  held_credits: DecimalString;
  /** Still needed after the plan's courses and placeholders. */
  uncovered_credits: DecimalString;
}

export interface PlanCheck {
  status: PlanStatus;
  validation: PlanValidation;
  degree: DegreeProgress;
  placeholder_credits: DecimalString;
  /** Credits still needed after courses and placeholders: the 'credits left for graduation'. */
  uncovered_credits: DecimalString;
  requirements: PlanCheckRequirement[];
  /** Online courses in the plan: credits planned and how many count toward the degree. */
  online: { planned_credits: DecimalString; counted_credits: DecimalString };
  /** Per semester: planned credits (courses and placeholders), the limit (28) and how many more fit. */
  load: Record<string, { planned_credits: DecimalString; limit_credits: DecimalString; available_credits: DecimalString }>;
}

export interface PlanGeneration {
  record_revision: number;
  rule_version: string;
  semesters: PlannedSemester[];
  placements: GeneratedPlacement[];
  unmet: GeneratedUnmet[];
  summary: {
    terms: string[];
    total_credits: DecimalString;
    remaining_before: DecimalString;
    remaining_after: DecimalString;
    placed_credits: DecimalString;
    placeholder_credits: DecimalString;
    credits_by_term: Record<string, DecimalString>;
    busiest_semester_credits: DecimalString;
    complete: boolean;
  };
  assumptions: string[];
  options: GenerationOptions;
  graduation: PlanGraduation;
  online_potential: OnlinePotential;
  notice: string;
  validation: PlanValidation;
}
