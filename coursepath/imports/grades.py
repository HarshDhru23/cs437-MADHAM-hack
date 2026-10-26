"""Reported grade semantics from the committed roadmap, not an approved policy."""
from decimal import Decimal

POINTS = {grade: Decimal(points) for grade, points in {'A+': 11, 'A': 10, 'A-': 9, 'B': 8, 'B-': 7,
          'C': 6, 'C-': 5, 'D': 4, 'E': 2, 'F': 0}.items()}


def grade_status(grade):
    grade = grade.strip().upper()
    if grade in {'E', 'F'}:
        return 'failed'
    if grade in POINTS or grade == 'P':
        return 'completed'
    return 'unknown'


def classify_grade(grade, exposure_policy=None):
    grade = grade.strip().upper()
    return {'completion_status': grade_status(grade), 'performance_points': POINTS.get(grade),
            'prerequisite_exposure': None if exposure_policy is None else grade in exposure_policy.get('accepted_grades', [])}
