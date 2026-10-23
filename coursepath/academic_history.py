from copy import deepcopy


def record_course_attempts(academic_history, attempts):
    """Historical manual-entry wrapper; preserve every registration instance."""
    for attempt in attempts:
        if attempt.get('status') not in {'COMPLETED', 'IN_PROGRESS', 'FAILED'}:
            raise ValueError('Unsupported historical attempt status')
    return deepcopy(academic_history + list(attempts))
