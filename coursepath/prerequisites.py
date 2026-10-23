from coursepath.eligibility import evaluate_prerequisite


def explain_unsatisfied_prerequisites(
    course_id, semester_id, catalogue, academic_history, plan
):
    """Compatibility wrapper over the same ordering/exposure evaluator."""
    expression = {'type': 'and', 'children': [{'type': 'course', 'course_id': code} for code in catalogue[course_id]['prerequisites']]}
    attempts = [{'id': str(i), 'normalized_code': a['course_id'], 'completion_status': a['status'].lower(), 'term_id': a.get('semester_id', -1)} for i, a in enumerate(academic_history)]
    planned = [{'normalized_code': code, 'term_id': term['semester_id']} for term in plan['semesters'] for code in term['course_ids']]
    result = evaluate_prerequisite(expression, semester_id, attempts, planned)
    return [{'course_id': course_id, 'prerequisite_id': code, 'reason': f'{code} is neither completed nor planned in an earlier semester.'} for code in result['missing']]
