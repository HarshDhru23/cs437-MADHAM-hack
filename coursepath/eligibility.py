from coursepath.models import term_key
from coursepath.imports.grades import POINTS


def _key(term):
    return (term, 0) if isinstance(term, int) else term_key(term)


def evaluate_prerequisite(expression, term_id, attempts, planned=()):
    if expression is None:
        return {'status': 'unknown', 'missing': [], 'proof': [], 'source_refs': []}
    kind = expression['type']
    if kind in {'and', 'or'}:
        children = [evaluate_prerequisite(child, term_id, attempts, planned) for child in expression['children']]
        if kind == 'or':
            if not children:
                return {'status': 'ineligible', 'missing': [], 'proof': [], 'source_refs': expression.get('source_refs', [])}
            rank = {'eligible': 3, 'conditional': 2, 'unknown': 1, 'ineligible': 0}
            return max(children, key=lambda c: (rank[c['status']], -len(c['missing'])))
        statuses = {c['status'] for c in children}
        status = next((s for s in ['ineligible', 'unknown', 'conditional'] if s in statuses), 'eligible')
        return {'status': status, 'missing': sorted({m for c in children for m in c['missing']}),
                'proof': [p for c in children for p in c['proof']], 'source_refs': expression.get('source_refs', [])}
    if kind != 'course':
        raise ValueError('Unsupported prerequisite expression')
    code = expression['course_id']
    minimum = expression.get('minimum_grade')
    if minimum and minimum not in POINTS:
        return {'status': 'unknown', 'missing': [code], 'proof': [], 'source_refs': expression.get('source_refs', [])}
    for attempt in attempts:
        if attempt['normalized_code'] != code:
            continue
        if attempt.get('term_id') is None or _key(attempt['term_id']) >= _key(term_id):
            continue
        grade = attempt.get('grade')
        passed = attempt.get('completion_status') == 'completed'
        exposure = grade is not None and grade in expression.get('allow_exposure_grades', [])
        grade_ok = not minimum or grade in POINTS and POINTS[grade] >= POINTS[minimum]
        if (passed or exposure) and grade_ok:
            return {'status': 'eligible', 'missing': [], 'proof': [attempt['id']], 'source_refs': expression.get('source_refs', [])}
    for row in planned:
        earlier = _key(row['term_id']) < _key(term_id)
        same_coreq = expression.get('co_requisite') is True and row['term_id'] == term_id
        if row['normalized_code'] == code and (earlier or same_coreq):
            return {'status': 'conditional', 'missing': [], 'proof': [row.get('id', code)],
                    'assumption': 'Pass the prerequisite with any required minimum grade.', 'source_refs': expression.get('source_refs', [])}
    return {'status': 'ineligible', 'missing': [code], 'proof': [], 'source_refs': expression.get('source_refs', [])}
