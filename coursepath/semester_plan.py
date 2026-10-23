from copy import deepcopy
from decimal import Decimal
from coursepath.serialization import decimal_value, decimal_string
from coursepath.models import term_key
from coursepath.eligibility import evaluate_prerequisite
from coursepath.issues import issue


def edit_semester_plan(plan, semester_id, add_courses=(), remove_course_ids=()):
    """Return a new table; remove+add can move a stable item between terms."""
    updated = deepcopy(plan)
    semester = next((s for s in updated['semesters'] if s.get('semester_id', s.get('term_id')) == semester_id), None)
    if semester is None:
        raise ValueError('Unknown semester')
    semester['courses'] = [c for c in semester['courses'] if c.get('course_id', c.get('normalized_code')) not in remove_course_ids and c.get('id') not in remove_course_ids]
    semester['courses'].extend(deepcopy(list(add_courses)))
    identities = [c.get('id', c.get('course_id', c.get('normalized_code'))) for c in semester['courses']]
    if len(set(identities)) != len(identities):
        raise ValueError('Duplicate planned item')
    semester['total_credits'] = sum((decimal_value(c['credits']) for c in semester['courses']), Decimal(0))
    return updated


def validate_plan(context, plan, offering_snapshot=None, calendar=None):
    catalogue = context.get('catalogue', {})
    attempts = context.get('attempts', [])
    workload, per_course, issues = {}, [], []
    planned = [{**c, 'normalized_code': c.get('normalized_code', c.get('course_id')), 'term_id': semester['term_id']}
               for semester in plan.get('semesters', []) for c in semester.get('courses', [])]
    seen = {}
    for semester in sorted(plan.get('semesters', []), key=lambda s: term_key(s['term_id'])):
        term = semester['term_id']
        selected = sum((decimal_value(c['credits']) for c in semester.get('courses', [])), Decimal(0))
        placeholders = sum((decimal_value(p['desired_credits']) for p in semester.get('placeholders', [])), Decimal(0))
        workload[term] = {'selected_credits': decimal_string(selected), 'placeholder_credits': decimal_string(placeholders), 'target_credits': decimal_string(selected + placeholders)}
        issues.extend(_load_issues(context, term, selected + placeholders))
        if placeholders:
            issues.append(issue('PLACEHOLDER_UNRESOLVED', 'Select actual courses before eligibility or completion can be established.', entities=[p['id'] for p in semester['placeholders']]))
        for course in semester.get('courses', []):
            code = course.get('normalized_code', course.get('course_id'))
            entity = course.get('id', code)
            metadata = catalogue.get(code)
            expression = metadata.get('prerequisites') if metadata and metadata.get('prerequisite_known') else None
            eligibility = evaluate_prerequisite(expression, term, attempts, planned)
            if eligibility['status'] == 'unknown':
                issues.append(issue('PREREQUISITE_UNKNOWN', 'Prerequisite data is unknown.', entities=[entity]))
            elif eligibility['status'] == 'ineligible':
                issues.append(issue('PREREQUISITE_MISSING', 'Missing: ' + ', '.join(eligibility['missing']), 'error', [entity], eligibility['source_refs']))
            elif eligibility['status'] == 'conditional':
                issues.append(issue('PREREQUISITE_CONDITIONAL', 'Earlier planned prerequisite must be passed.', 'warning', [entity], eligibility['source_refs']))
            previous = seen.get(code, [])
            completed = [a for a in attempts if a['normalized_code'] == code and a['completion_status'] == 'completed']
            if previous or completed:
                if metadata is None or metadata.get('repeatable') is None:
                    issues.append(issue('REPEAT_POLICY_UNKNOWN', 'Repeat eligibility requires reviewed policy.', entities=[entity]))
                elif not metadata['repeatable'] or not course.get('instance_id'):
                    issues.append(issue('DUPLICATE_COURSE', 'Already completed/selected or missing repeat instance evidence.', 'error', [entity] + previous))
            seen.setdefault(code, []).append(entity)
            issues.extend([issue('OFFERING_UNKNOWN', 'No reviewed offering check is available for this term.', entities=[entity]),
                           issue('MEETINGS_UNKNOWN', 'Meeting check has not been performed.', entities=[entity])])
            per_course.append({'id': entity, 'term_id': term, 'eligibility': eligibility['status'], 'prerequisite_proof': eligibility,
                               'offering_status': 'unknown', 'meeting_check_status': 'not_checked'})
    return {'workload': workload, 'per_course': per_course, 'issues': issues, 'meeting_check_status': 'not_checked', 'completion_term': None}


def _load_issues(context, term, total):
    issues = []
    summer = term.endswith('SUMMER')
    standing = context.get('standing', 'unknown')
    cap = Decimal(10 if summer else 21 if standing == 'GPS' else 28)
    advisor = context.get('advisor_cap')
    if advisor is not None:
        cap = min(cap, decimal_value(advisor))
    if standing == 'unknown':
        issues.append(issue('STANDING_UNKNOWN', 'Confirm standing and any advisor cap.', entities=[term]))
    if total > cap:
        may_overload = not summer and standing != 'GPS' and (advisor is None or decimal_value(advisor) >= 28) and total <= 32
        if may_overload:
            evidence = context.get('overload', {})
            approved = evidence.get('verified') is True and evidence.get('recommendation_verified') is True and decimal_value(evidence.get('cpi', '0')) >= 7
            if not approved:
                issues.append(issue('OVERLOAD_APPROVAL_REQUIRED', 'Overload requires applicable CPI, recommendation and verified approval.', 'approval_required', [term]))
        else:
            issues.append(issue('LOAD_LIMIT', f'Target workload exceeds the {cap}-credit limit.', 'error', [term]))
    if not summer and total and (total < 20 or total > 24):
        issues.append(issue('LOAD_GUIDANCE', 'Normal regular-term guidance is 20-24 credits.', 'warning', [term]))
    return issues
