"""Isolated what-if scenarios against an exact baseline (roadmap section 5).

Changes run on copies. Hypothetical grades and failures enter only a separately
labelled performance projection, never the record the audit reads, so the
actual view cannot change. Applying a scenario writes plan edits only.
"""
from copy import deepcopy
from coursepath.degree_audit import evaluate_audit
from coursepath.imports.grades import POINTS, grade_status
from coursepath.internships import evaluate_internship
from coursepath.issues import issue
from coursepath.models import term_key, validate_term_id
from coursepath.performance import calculate_performance
from coursepath.semester_plan import validate_plan
from coursepath.serialization import decimal_value, decimal_string
from coursepath.validation import course_code

PLAN_OPS = {'drop', 'postpone', 'replace'}
OPS = PLAN_OPS | {'fail', 'grade', 'cap'}


def _locate(plan, item_id):
    for semester in plan['semesters']:
        for course in semester['courses']:
            if course['id'] == item_id:
                return semester, course
    raise ValueError(f'Unknown planned item {item_id}')


def _semester(plan, term_id):
    validate_term_id(term_id)
    existing = next((s for s in plan['semesters'] if s['term_id'] == term_id), None)
    if existing is None:
        existing = {'term_id': term_id, 'courses': [], 'placeholders': []}
        plan['semesters'].append(existing)
        plan['semesters'].sort(key=lambda s: term_key(s['term_id']))
    return existing


def apply_changes(plan, changes, ops=OPS):
    """Return (plan copy, term caps, hypothetical attempts, skipped changes)."""
    plan = deepcopy(plan)
    caps, hypothetical, skipped = {}, [], []
    if not isinstance(changes, list) or len(changes) > 100:
        raise ValueError('Expected at most 100 scenario changes')
    for change in changes:
        op = change.get('op') if isinstance(change, dict) else None
        if op not in OPS:
            raise ValueError('Unsupported scenario change')
        if op == 'cap':
            validate_term_id(change['term_id'])
            credits = decimal_string(decimal_value(change['credits']))
        else:
            semester, course = _locate(plan, change.get('item_id'))
        if op == 'grade' and str(change.get('grade', '')).upper() not in POINTS:
            raise ValueError('Hypothetical grades must be letter grades')
        if op == 'postpone' and term_key(validate_term_id(change['term_id'])) <= term_key(semester['term_id']):
            raise ValueError('Postpone moves a course to a later term')
        if op not in ops:
            skipped.append({'op': op, 'item_id': change.get('item_id'), 'term_id': change.get('term_id'),
                            'reason': 'Hypothetical grades, failures and caps never enter a saved plan or the record.'})
            continue
        if op == 'cap':
            caps[change['term_id']] = credits
        elif op == 'postpone':
            semester['courses'].remove(course)
            _semester(plan, change['term_id'])['courses'].append(course)
        elif op == 'replace':
            replacement = change.get('course') or {}
            course.update(normalized_code=course_code(replacement['normalized_code']), credits=decimal_string(decimal_value(replacement['credits'])))
            for stale in ('course_id', 'course_version_id', 'offering_id', 'section_ids', 'instance_id'):
                course.pop(stale, None)
        else:
            semester['courses'].remove(course)
            if op in {'fail', 'grade'}:
                grade = 'F' if op == 'fail' else change['grade'].upper()
                hypothetical.append({'id': 'hypothetical:' + course['id'], 'normalized_code': course['normalized_code'], 'credits': course['credits'],
                                     'grade': grade, 'term_id': semester['term_id'], 'completion_status': grade_status(grade),
                                     'learning_designation': course.get('learning_designation', 'unknown'), 'hypothetical': True})
    return plan, caps, hypothetical, skipped


def evaluate(context, record, plan, caps=None, hypothetical=(), internship=None, award_ids=()):
    audit = evaluate_audit(context['curriculum'], context.get('catalogue', {}), record, plan, awards=tuple(award_ids))
    performance = calculate_performance(record.get('attempts', []) + list(hypothetical), context['grading_policy'])
    planning = {'attempts': record.get('attempts', []), 'catalogue': context.get('catalogue', {}), 'standing': context.get('standing', 'unknown'),
                'advisor_cap': context.get('advisor_cap'), 'term_caps': caps or {}}
    validation = validate_plan(planning, plan, context.get('offering_snapshots'), context.get('calendar'))
    stay = None
    if internship:
        stay = evaluate_internship({**planning, 'approvals': context.get('approvals', []), 'record_revision': record.get('revision'),
                                    'current_enrolment': record.get('current_enrolment', [])}, internship, plan, context.get('calendar'))
    issues = audit['issues'] + performance['issues'] + validation['issues'] + (stay['issues'] if stay else [])
    return {'audit': audit, 'performance': {**performance, 'hypothetical': bool(hypothetical)}, 'validation': validation,
            'internship': stay, 'completion_term': None, 'issues': issues}


def _requirements(tree, result=None):
    result = {} if result is None else result
    for node in tree:
        result[node['id']] = node
        _requirements(node.get('children', []), result)
    return result


def _deltas(base, other):
    before, after = _requirements(base['audit']['projected']), _requirements(other['audit']['projected'])
    requirements = [{'id': key, 'label': after[key]['label'],
                     'baseline': {'status': before[key]['status'], 'remaining_credits': before[key]['remaining_credits']},
                     'scenario': {'status': after[key]['status'], 'remaining_credits': after[key]['remaining_credits']}}
                    for key in after if key in before and (before[key]['status'], before[key]['remaining_credits']) != (after[key]['status'], after[key]['remaining_credits'])]
    key = lambda i: (i['code'], tuple(i['entity_refs']))
    old, new = {key(i) for i in base['issues']}, {key(i) for i in other['issues']}
    added = [i for i in other['issues'] if key(i) not in old]
    terms = sorted(set(base['validation']['workload']) | set(other['validation']['workload']), key=term_key)
    load = lambda result, term: result['validation']['workload'].get(term, {}).get('target_credits', '0')
    return {'requirements': requirements, 'new_issues': added, 'resolved_issues': [i for i in base['issues'] if key(i) not in new],
            'downstream_affected': sorted({e for i in added if i['code'] == 'PREREQUISITE_MISSING' for e in i['entity_refs']}),
            'workload': {t: {'baseline': load(base, t), 'scenario': load(other, t)} for t in terms if load(base, t) != load(other, t)},
            'cpi': {'baseline': base['performance']['cumulative']['unrounded_value'], 'scenario': other['performance']['cumulative']['unrounded_value'],
                    'hypothetical': other['performance']['hypothetical']},
            'meeting_checks': {t: {'baseline': base['validation']['meeting_checks'].get(t, {}).get('status'), 'scenario': c['status']}
                               for t, c in other['validation']['meeting_checks'].items() if base['validation']['meeting_checks'].get(t, {}).get('status') != c['status']}}


def compare_scenario(context, baseline, scenario):
    """Evaluate baseline and scenario with the same engine. A stale scenario is not evaluated."""
    record, plan = deepcopy(baseline['record']), deepcopy(baseline['plan'])
    stale = (scenario['baseline_record_revision'], scenario['baseline_plan_revision'], scenario['rule_version']) != (record.get('revision'), plan.get('revision'), baseline['rule_version'])
    result = {'scenario_id': scenario.get('id'), 'baseline_record_revision': record.get('revision'), 'baseline_plan_revision': plan.get('revision'),
              'rule_version': baseline['rule_version'], 'stale': stale}
    if stale:
        return {**result, 'baseline': None, 'scenario': None, 'deltas': None,
                'issues': [issue('SCENARIO_STALE', 'The saved record, plan or rules changed after this scenario was created.', 'error', [scenario.get('id') or ''],
                                 action='Rebase the scenario on the current record and plan, then compare again.')]}
    changed, caps, hypothetical, _ = apply_changes(plan, scenario.get('changes', []))
    base = evaluate(context, record, plan)
    other = evaluate(context, record, changed, caps, hypothetical, scenario.get('internship'), scenario.get('award_ids', ()))
    return {**result, 'baseline': base, 'scenario': other, 'deltas': _deltas(base, other), 'issues': []}


def plan_edits(plan, scenario):
    """Plan payload with only drop/postpone/replace applied, and the changes left out."""
    edited, _, _, skipped = apply_changes(plan, scenario.get('changes', []), PLAN_OPS)
    if scenario.get('internship'):
        skipped.append({'op': 'internship', 'item_id': None, 'term_id': None, 'reason': 'Internship choices stay in the scenario.'})
    return {k: v for k, v in edited.items() if k not in {'id', 'revision'}}, skipped
