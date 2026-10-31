"""Ownership-free immutable values. Academic dates are never guessed."""
from __future__ import annotations
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
import re
from coursepath.serialization import decimal_value

STATUSES = frozenset({'completed', 'in_progress', 'failed', 'withdrawn', 'incomplete', 'unknown'})


def validate_term_id(value):
    match = re.fullmatch(r'(20\d{2})-(\d{2})-(I|II|SUMMER)', value)
    if not match or (int(match[1]) + 1) % 100 != int(match[2]):
        raise ValueError('Invalid academic term')
    return value


def term_key(value):
    validate_term_id(value)
    year, _, part = value.split('-')
    return int(year), {'I': 0, 'II': 1, 'SUMMER': 2}[part]


@dataclass(frozen=True)
class Term:
    id: str
    start_date: date | None = None
    end_date_exclusive: date | None = None
    semester_index: int | None = None

    def __post_init__(self):
        validate_term_id(self.id)
        if bool(self.start_date) != bool(self.end_date_exclusive):
            raise ValueError('Both interval bounds required')
        if self.start_date and self.start_date >= self.end_date_exclusive:
            raise ValueError('Empty/reversed interval')


@dataclass(frozen=True)
class CourseAttempt:
    id: str
    normalized_code: str
    original_code: str
    title: str
    credits: Decimal
    grade: str
    term_id: str
    completion_status: str
    learning_designation: str = 'unknown'
    course_version_id: str | None = None
    instance_id: str | None = None
    source_refs: tuple = ()
    user_corrections: tuple = ()
    approval_refs: tuple = ()

    def __post_init__(self):
        object.__setattr__(self, 'credits', decimal_value(self.credits))
        validate_term_id(self.term_id)
        if not self.id or not self.normalized_code or self.completion_status not in STATUSES:
            raise ValueError('Invalid attempt')
        if self.learning_designation not in {'degree', 'additional', 'unknown'}:
            raise ValueError('Invalid learning designation')


@dataclass(frozen=True)
class SourceReference:
    id: str
    kind: str
    title: str
    version: str
    locator: str
    applicable_cohorts: tuple[str, ...]
    effective_date: date | None = None
    review_status: str = 'draft'
    authority: str = 'example'
    file_sha256: str | None = None
    url: str | None = None
    retrieved_at: datetime | None = None
    notes: str = ''

    def __post_init__(self):
        if not self.id or not self.locator or not self.version:
            raise ValueError('Source identity/version/locator are required')
        if self.kind not in {'advisory', 'transcript', 'paste', 'timetable', 'course_plan', 'approval', 'student_example', 'team_decision'}:
            raise ValueError('Invalid source kind')
        if self.review_status not in {'draft', 'reviewed', 'conflicted'} or self.authority not in {'institutional', 'student_provided', 'example', 'team'}:
            raise ValueError('Invalid source review/authority')


@dataclass(frozen=True)
class StudentProfile:
    id: str
    programme: str = 'BTECH_CSE'
    admission_year: int = 2024
    curriculum_version: str = 'cse-2024-v1'
    selected_award_ids: tuple = ()
    standing: str = 'unknown'
    advisor_cap: Decimal | None = None
    active_semesters: tuple | None = None
    approval_refs: tuple = ()

    def __post_init__(self):
        if self.programme != 'BTECH_CSE' or self.admission_year != 2024 or self.standing not in {'normal', 'GPS', 'unknown'}:
            raise ValueError('Unsupported profile')
        if self.advisor_cap is not None:
            decimal_value(self.advisor_cap)


@dataclass(frozen=True)
class CourseVersion:
    id: str
    official_code: str
    title: str
    credits: Decimal | None
    prerequisite_known: bool = False
    prerequisites: RequirementExpression | None = None
    source_refs: tuple = ()


@dataclass(frozen=True)
class PlannedCourse:
    id: str
    normalized_code: str
    term_id: str
    credits: Decimal
    offering_id: str | None = None
    section_ids: tuple | None = None
    assumptions: tuple = ()

    def __post_init__(self):
        validate_term_id(self.term_id)
        decimal_value(self.credits)


@dataclass(frozen=True)
class RequirementPlaceholder:
    id: str
    requirement_id: str
    term_id: str
    desired_credits: Decimal
    label: str

    def __post_init__(self):
        validate_term_id(self.term_id)
        decimal_value(self.desired_credits)


@dataclass(frozen=True)
class RequirementExpression:
    id: str
    kind: str
    children: tuple = ()
    course_ids: tuple[str, ...] = ()
    minimum_credits: Decimal = Decimal(0)
    source_refs: tuple = ()


@dataclass(frozen=True)
class Allocation:
    id: str
    attempt_id: str
    requirement_id: str
    credits: Decimal
    counting_context: str = 'base'
    shared_with: tuple = ()
    source_refs: tuple = ()


@dataclass(frozen=True)
class Plan:
    id: str
    revision: int
    semesters: tuple = ()


@dataclass(frozen=True)
class Scenario:
    id: str
    baseline_record_revision: int
    baseline_plan_revision: int
    rule_version: str
    changes: tuple = ()


@dataclass(frozen=True)
class Award:
    id: str
    version: str
    requirements: tuple
    source_refs: tuple


@dataclass(frozen=True)
class MeetingGroup:
    id: str
    selection_semantics: str
    meetings: tuple | None

    def __post_init__(self):
        if self.selection_semantics not in {'all_required', 'choose_one', 'unknown'}:
            raise ValueError('Invalid meeting-group semantics')


@dataclass(frozen=True)
class Meeting:
    id: str
    offering_id: str
    group_id: str
    kind: str
    weekday: int
    start_minutes: int
    end_minutes: int
    start_date: date
    end_date_exclusive: date
    source_refs: tuple

    def __post_init__(self):
        if self.kind not in {'lecture', 'tutorial', 'lab', 'exam'} or not 0 <= self.weekday <= 6:
            raise ValueError('Invalid meeting kind/day')
        if not 0 <= self.start_minutes < self.end_minutes <= 1440 or self.start_date >= self.end_date_exclusive:
            raise ValueError('Invalid meeting interval')


@dataclass(frozen=True)
class Offering:
    id: str
    term_id: str
    normalized_code: str
    meeting_groups: tuple | None


@dataclass(frozen=True)
class Internship:
    id: str
    duration_choice: str
    start_date: date | None
    end_date_exclusive: date | None
    module_ids: tuple = ()
