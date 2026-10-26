from copy import deepcopy
from decimal import Decimal
from coursepath.rules.allocation import allocate
from coursepath.rules.loader import validate_curriculum
from coursepath.issues import issue


def evaluate_audit(curriculum, catalogue, record, plan=None, awards=(), approvals=(), **limits):
    curriculum = validate_curriculum(curriculum)
    actual = allocate(curriculum, catalogue, record.get('attempts', []), **limits)
    current_rows = deepcopy(record.get('attempts', []))
    for row in record.get('current_enrolment', []):
        if row.get('confirmed'):
            current_rows.append({**row, 'completion_status': 'completed', 'learning_designation': row.get('learning_designation', 'unknown')})
    current = allocate(curriculum, catalogue, current_rows, **limits)
    projected_rows = deepcopy(current_rows)
    for semester in (plan or {}).get('semesters', []):
        for row in semester.get('courses', []):
            projected_rows.append({**row, 'normalized_code': row.get('normalized_code', row.get('course_id')), 'completion_status': 'completed', 'learning_designation': row.get('learning_designation', 'unknown')})
    projected = allocate(curriculum, catalogue, projected_rows, **limits)
    if len(current_rows) > len(record.get('attempts', [])):
        _conditional(current['requirements'])
    if len(projected_rows) > len(record.get('attempts', [])):
        _conditional(projected['requirements'])
    issues = actual['issues'] + [i for i in current['issues'] + projected['issues'] if i not in actual['issues']]
    if awards:
        issues.append(issue('AWARD_POLICY_MISSING', 'Joint award evaluation awaits the full reviewed award definitions.'))
    return {'actual': actual['requirements'], 'current': current['requirements'], 'projected': projected['requirements'],
            'ledger': actual['ledger'], 'current_ledger': current['ledger'], 'projected_ledger': projected['ledger'],
            'excluded_attempts': actual['excluded_attempts'], 'issues': issues, 'complete': actual['complete'] and not awards,
            'rule_version': curriculum['version'], 'record_revision': record.get('revision', 0), 'search_nodes': actual['search_nodes']}


def _conditional(tree):
    for result in tree:
        if result['status'] == 'satisfied':
            result['status'] = 'conditional'
        _conditional(result.get('children', []))


def explain_degree_audit(curriculum, catalogue, academic_history):
    """Historical synthetic contract adapted to the same exclusive allocator."""
    requirements = [{**r, 'type': 'minimum_credits', 'minimum_credits': str(sum(Decimal(str(catalogue[c]['credits'])) for c in r['course_ids']))} for r in curriculum['requirements']]
    rows = [{'id': str(i), 'normalized_code': a['course_id'], 'credits': str(catalogue[a['course_id']]['credits']),
             'completion_status': a['status'].lower(), 'learning_designation': 'degree'} for i, a in enumerate(academic_history)]
    result = allocate({'requirements': requirements, 'review_status': 'reviewed'}, catalogue, rows)
    by_id = {a['id']: a for a in rows}
    return [{'requirement_id': r['id'], 'counted_courses': [{'course_id': by_id[a['attempt_id']]['normalized_code'], 'credits': Decimal(a['credits'])} for a in result['ledger'] if a['requirement_id'] == r['id']],
             'completed_credits': sum((Decimal(a['credits']) for a in result['ledger'] if a['requirement_id'] == r['id']), Decimal(0))} for r in requirements]
