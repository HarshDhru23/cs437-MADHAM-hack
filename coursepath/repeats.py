"""D-15 repeated courses: one counted attempt per course identity.

Allocation (credit) and performance (CPI) both call `superseded_attempts`, so
they always agree on which attempt counts.
"""
from decimal import Decimal
from coursepath.identity import canonical_code
from coursepath.imports.grades import POINTS
from coursepath.models import term_key
from coursepath.serialization import decimal_value

GRADED = {'completed', 'failed'}


def rank(attempt, code):
    """A pass beats a fail (E carries points but is a fail), then more grade points (P has none), more credits (D-02),
    the current D-04 code, the later term. The attempt ID only orders exact duplicates, whose outcome is the same."""
    grade = (attempt.get('grade') or '').strip().upper()
    return (attempt.get('completion_status') == 'completed', POINTS.get(grade, Decimal(-1)), decimal_value(attempt['credits']),
            attempt['normalized_code'] == code, term_key(attempt['term_id']), attempt['id'])


def superseded_attempts(attempts, identity, separate):
    """IDs of graded attempts that lose to a better attempt of the same course. `separate(attempt, code)` marks
    registrations that are separate courses, never repeats (projects, D-01; IN 498 modules, A.12)."""
    courses = {}
    for attempt in attempts:
        code = canonical_code(attempt['normalized_code'], identity)
        if attempt.get('completion_status') in GRADED and not separate(attempt, code):
            courses.setdefault(code, []).append((rank(attempt, code), attempt['id']))
    return {attempt_id for items in courses.values() for _, attempt_id in items if attempt_id != max(items)[1]}
