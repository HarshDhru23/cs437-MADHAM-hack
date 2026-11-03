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
  password: string;
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
  changes: Record<string, unknown>[];
  internship: Record<string, unknown> | null;
  award_ids: string[];
}
