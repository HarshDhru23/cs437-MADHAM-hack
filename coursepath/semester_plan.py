from copy import deepcopy
from decimal import Decimal
from coursepath.serialization import decimal_value, decimal_string
from coursepath.models import term_key
from coursepath.eligibility import evaluate_prerequisite
from coursepath.issues import issue
from coursepath.offerings import offering_availability, snapshot_for_term
from coursepath.timetable import check_meetings
from coursepath.identity import canonical_code


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
    identity = context.get('identity')
    workload, per_course, issues, meeting_checks = {}, [], [], {}
    planned = [{**c, 'normalized_code': c.get('normalized_code', c.get('course_id')), 'term_id': semester['term_id']}
               for semester in plan.get('semesters', []) for c in semester.get('courses', [])]
    # CP-05: confirmed current enrolment is preparation taken earlier but not yet passed, so like an earlier planned course it is conditional.
    planned += [r for r in context.get('current_enrolment') or [] if r.get('confirmed')]
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
            current = canonical_code(code, identity)  # D-04: catalogue and repeat checks use the resolved identity
            metadata = catalogue.get(current)
            expression = metadata.get('prerequisites') if metadata and metadata.get('prerequisite_known') else None
            eligibility = evaluate_prerequisite(expression, term, attempts, planned, identity)
            # D-17: prerequisites are CoursePath team recommendations; an unmet one warns and never blocks.
            if eligibility['status'] == 'unknown':
                issues.append(issue('PREREQUISITE_UNKNOWN', 'No recommendation recorded for this course in the CoursePath team list. That is not a claim that it has no prerequisites.', 'info', [entity]))
            elif eligibility['status'] == 'ineligible':
                issues.append(issue('PREREQUISITE_MISSING', 'Recommended preparation (CoursePath team) missing: ' + ', '.join(eligibility['missing']), 'warning',
                                    [entity], eligibility['source_refs'], 'Take the recommended course earlier, or keep the plan if you are prepared.'))
            elif eligibility['status'] == 'conditional':
                issues.append(issue('PREREQUISITE_CONDITIONAL', 'Recommended preparation (CoursePath team) is planned earlier; it helps only if passed.', 'warning',
                                    [entity], eligibility['source_refs']))
            previous = seen.get(current, [])
            completed = [a for a in attempts if canonical_code(a['normalized_code'], identity) == current and a['completion_status'] == 'completed']
            if previous or completed:
                if metadata is None or metadata.get('repeatable') is None:
                    # D-32: any non-project course may be retaken and the best grade counts (D-15). Project registrations are separate attempts (D-01).
                    if _is_project(current):
                        pass
                    elif completed:
                        issues.append(issue('RETAKE_PLANNED', f'You already completed {current}; planning it again is a retake and the best grade counts.', 'info', [entity]))
                    else:
                        issues.append(issue('DUPLICATE_COURSE', 'This course is already selected in your plan.', 'warning', [entity] + previous))
                elif not metadata['repeatable'] or not course.get('instance_id'):
                    issues.append(issue('DUPLICATE_COURSE', 'Already completed/selected or missing repeat instance evidence.', 'error', [entity] + previous))
            seen.setdefault(current, []).append(entity)
            availability = offering_availability(offering_snapshot, term, code)
            issues.extend(availability['issues'])
            ids = availability['offering_ids']
            chosen = course.get('offering_id') if course.get('offering_id') in ids else ids[0] if len(ids) == 1 and not course.get('offering_id') else None
            if chosen:
                offered = _offering(snapshot_for_term(offering_snapshot, term), chosen)
                if offered.get('credits') is not None and decimal_value(offered['credits']) != decimal_value(course['credits']):
                    issues.append(issue('OFFERING_CREDITS_DIFFER', f"The {term} offering lists {offered['credits']} credits; earned history keeps its own credits.",
                                        'warning', [entity], [r['id'] for r in offered.get('source_refs', [])[:1]]))
            per_course.append({'id': entity, 'term_id': term, 'eligibility': eligibility['status'], 'prerequisite_proof': eligibility,
                               'offering_status': availability['status'], 'offering_ids': availability['offering_ids']})
        check = check_meetings([{**c, 'id': c.get('id', c.get('normalized_code', c.get('course_id'))), 'normalized_code': c.get('normalized_code', c.get('course_id'))}
                                for c in semester.get('courses', [])], snapshot_for_term(offering_snapshot, term))
        issues.extend(check['issues'])
        status = check['status']
        if status == 'clear' and semester.get('placeholders'):  # placeholders beside clash-free courses are still unchecked
            status = 'not_checked'
        meeting_checks[term] = {'status': status, 'conflicts': check['conflicts']}
        for row in per_course:
            if row['term_id'] == term:
                row['meeting_check_status'] = check['per_item'][row['id']]
    statuses = [c['status'] for c in meeting_checks.values()]
    overall = 'conflicts' if 'conflicts' in statuses else 'clear' if statuses and set(statuses) == {'clear'} else 'not_checked'
    return {'workload': workload, 'per_course': per_course, 'issues': issues, 'meeting_check_status': overall,
            'meeting_checks': meeting_checks, 'completion_term': None}


def _is_project(code):
    import re
    return bool(re.match(r'^[A-Z]{2,4} [234]99', code))


def _offering(snapshot, offering_id):
    return next(o for o in snapshot['offerings'] if o['id'] == offering_id)


def _load_issues(context, term, total):
    issues = []
    summer = term.endswith('SUMMER')
    standing = context.get('standing', 'unknown')
    cap = Decimal(10 if summer else 21 if standing == 'GPS' else 28)  # D-31: regular standing is assumed until the profile says otherwise
    advisor = context.get('advisor_cap')
    if advisor is not None:
        cap = min(cap, decimal_value(advisor))
    term_cap = context.get('term_caps', {}).get(term)
    if term_cap is not None:
        cap = min(cap, decimal_value(term_cap))
    if standing == 'unknown':
        issues.append(issue('STANDING_ASSUMED', 'Assuming regular standing (28-credit cap) until you set your standing and any advisor cap in your profile.', 'info', [term]))
    simple = context.get('simple_load') is True   # D-36: the product limit is 28 credits, with no overload path and no 20-24 guidance
    if simple and not summer:
        cap = min(cap, Decimal(28))
    if total > cap:
        may_overload = not simple and not summer and standing != 'GPS' and cap == 28 and total <= 32
        if may_overload:
            evidence = context.get('overload', {})
            approved = evidence.get('verified') is True and evidence.get('recommendation_verified') is True and decimal_value(evidence.get('cpi', '0')) >= 7
            if not approved:
                issues.append(issue('OVERLOAD_APPROVAL_REQUIRED', 'Overload requires applicable CPI, recommendation and verified approval.', 'approval_required', [term]))
        else:
            issues.append(issue('LOAD_LIMIT', f'Target workload exceeds the {cap}-credit limit.', 'error', [term]))
    if not summer and not simple and total and (total < 20 or total > 24):
        issues.append(issue('LOAD_GUIDANCE', 'Normal regular-term guidance is 20-24 credits.', 'warning', [term]))
    return issues
