from copy import deepcopy
from decimal import Decimal
from coursepath.rules.allocation import allocate
from coursepath.rules.loader import validate_curriculum
from coursepath.issues import issue
from coursepath.serialization import decimal_string, decimal_value


def evaluate_audit(curriculum, catalogue, record, plan=None, awards=(), approvals=(), **limits):
    curriculum = validate_curriculum(curriculum)
    actual = allocate(curriculum, catalogue, record.get('attempts', []), **limits)
    current_rows = deepcopy(record.get('attempts', []))
    for row in record.get('current_enrolment', []):
        if row.get('confirmed'):
            current_rows.append({**row, 'completion_status': 'completed', 'learning_designation': row.get('learning_designation', 'degree'), 'current': True})
    current = allocate(curriculum, catalogue, current_rows, **limits)
    projected_rows = deepcopy(current_rows)
    for semester in (plan or {}).get('semesters', []):
        for row in semester.get('courses', []):
            projected_rows.append({**row, 'term_id': semester.get('term_id'), 'normalized_code': row.get('normalized_code', row.get('course_id')), 'completion_status': 'completed',
                                   'learning_designation': row.get('learning_designation', 'degree'), 'planned': True})
    projected = allocate(curriculum, catalogue, projected_rows, **limits)
    if len(current_rows) > len(record.get('attempts', [])):
        _conditional(current['requirements'])
    if len(projected_rows) > len(record.get('attempts', [])):
        _conditional(projected['requirements'])
    issues = actual['issues'] + [i for i in current['issues'] + projected['issues'] if i not in actual['issues']]
    if awards:
        issues.append(issue('AWARD_POLICY_MISSING', 'Joint award evaluation awaits the full reviewed award definitions.'))
    degree = {name: degree_progress(curriculum, results['requirements']) for name, results in (('actual', actual), ('current', current), ('projected', projected))}
    return {'degree': degree, 'actual': actual['requirements'], 'current': current['requirements'], 'projected': projected['requirements'],
            'ledger': actual['ledger'], 'current_ledger': current['ledger'], 'projected_ledger': projected['ledger'],
            'excluded_attempts': actual['excluded_attempts'], 'issues': issues, 'complete': actual['complete'] and not awards,
            'rule_version': curriculum['version'], 'record_revision': record.get('revision', 0), 'search_nodes': actual['search_nodes']}


def degree_progress(curriculum, results):
    """Degree credits counted so far against the degree total (170 for CSE 2024): each requirement counts at most what it asks for,
    so surplus in one basket never hides a shortfall in another. Remaining is the total minus that."""
    by_id = {}

    def index(nodes):
        for node in nodes:
            by_id[node['id']] = node
            index(node.get('children', []))
    index(results)

    def walk(rule):
        node = by_id.get(rule['id'])
        children = rule.get('children', [])
        if not children:
            required = decimal_value(node['required_credits']) if node else Decimal(0)
            return min(decimal_value(node['counted_credits']), required) if node else Decimal(0), required
        parts = [walk(child) for child in children]
        if rule['type'] == 'any_of':
            picks = [by_id[c['id']] for c in children if c['id'] in by_id]
            chosen = max(range(len(parts)), key=lambda i: (picks[i]['status'] in {'satisfied', 'conditional'}, parts[i][0]))
            return parts[chosen]
        return sum((p[0] for p in parts), Decimal(0)), sum((p[1] for p in parts), Decimal(0))

    counted = Decimal(0)
    required = Decimal(0)
    for rule in curriculum['requirements']:
        part = walk(rule)
        counted += part[0]
        required += part[1]
    total = decimal_value(curriculum['total_credits']) if curriculum.get('total_credits') else required
    return {'total_credits': decimal_string(total), 'counted_credits': decimal_string(counted), 'remaining_credits': decimal_string(max(Decimal(0), total - counted))}


def _chosen_leaves(curriculum, results):
    """(leaf rule, its result node, its top-level group label) for every leaf of the degree; for an either/or group only the chosen side."""
    by_id = {}

    def index(nodes):
        for node in nodes:
            by_id[node['id']] = node
            index(node.get('children', []))
    index(results)

    def walk(rule, group):
        children = rule.get('children', [])
        if not children:
            yield rule, by_id.get(rule['id']), group
        elif rule['type'] == 'any_of':
            picks = [c for c in children if c['id'] in by_id]
            yield from walk(max(picks, key=lambda c: (by_id[c['id']]['status'] in {'satisfied', 'conditional'}, decimal_value(by_id[c['id']]['counted_credits']))), group)
        else:
            for child in children:
                yield from walk(child, group)

    for rule in curriculum['requirements']:
        yield from walk(rule, rule.get('label', rule['id']))


def requirement_progress(curriculum, results):
    """One row per credit-bearing requirement of the degree (the part of a group a student works on, such as Open electives or the HSS electives):
    what it asks for, what is counted so far and what remains. For an either/or group (the Foundation Programme) only the chosen side is listed."""
    rows = []
    for rule, node, group in _chosen_leaves(curriculum, results):
        required = decimal_value(node['required_credits']) if node else Decimal(0)
        if required > 0:
            counted = min(decimal_value(node['counted_credits']), required)
            rows.append({'id': rule['id'], 'label': rule.get('label', rule['id']), 'group': group, 'required_credits': decimal_string(required),
                         'counted_credits': decimal_string(counted), 'remaining_credits': decimal_string(required - counted)})
    return rows


def course_shortfalls(curriculum, results):
    """Requirements still short of the number of courses they ask for (Physical Education: four courses and no credits; the GE basket: two
    courses), whatever their credits: {'id', 'label', 'remaining_courses'} for each. Same minimum as the allocator's."""
    rows = []
    for rule, node, _group in _chosen_leaves(curriculum, results):
        minimum = rule.get('minimum_courses', 1 if rule['type'] in {'mandatory_course', 'noncredit'} else 0)
        counted = node['counted_courses'] if node else 0
        if counted < minimum:
            rows.append({'id': rule['id'], 'label': rule.get('label', rule['id']), 'remaining_courses': minimum - counted})
    return rows


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
