import json
from pathlib import Path
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


def _check_expression(expression):
    if not isinstance(expression, dict) or expression.get('type') not in {'course', 'and', 'or'}:
        raise ValueError('Unsupported recommendation expression')
    if expression['type'] == 'course':
        if not isinstance(expression.get('course_id'), str):
            raise ValueError('A course recommendation names a course')
    else:
        if not expression.get('children'):
            raise ValueError('Empty recommendation expression')
        for child in expression['children']:
            _check_expression(child)


def load_recommended_prerequisites(path=None):
    """Team-recommended preparation (D-17) as a catalogue: {code: {prerequisite_known, prerequisites, ...}}.

    These are warnings that never block a plan. A course without an entry is absent here and stays unknown."""
    path = path or Path(__file__).resolve().parents[1] / 'data/prerequisites/cse-2024-recommended.json'
    data = json.loads(Path(path).read_text(encoding='utf-8'))
    if data.get('cohort') != 'BTECH_CSE-2024' or data.get('authority') != 'team_recommendation' or data.get('severity') != 'warning':
        raise ValueError('Recommended preparation must be a CSE 2024 team recommendation shown as warnings')
    catalogue = {}
    for entry in data.get('courses', []):
        code = entry.get('course_id')
        if not code or code in catalogue:
            raise ValueError('Each course has at most one recommendation')
        _check_expression(entry.get('expression'))
        catalogue[code] = {'prerequisite_known': True, 'prerequisites': entry['expression'], 'authority': data['authority'],
                           'review_status': data.get('review_status', 'draft'), 'version': data.get('version'), 'rationale': entry.get('rationale')}
    return catalogue
