"""Internship scenarios (contracts section 6; docs/academic-decisions.md D-14).

Dates, attendance and credit are independent. Duration never grants credit:
only IN 498 modules do, 4 credits each, at most 16, toward open electives,
HSS (max 8) or the open project (max 4). Per-quad limits are not modelled
(D-14). A module counts as approved only through verified evidence covering it.
"""
from collections import defaultdict
from copy import deepcopy
from decimal import Decimal
from math import ceil
from coursepath.calendar import MONTHS, add_calendar_months, as_date, term_dates
from coursepath.eligibility import evaluate_prerequisite
from coursepath.imports.grades import grade_status
from coursepath.issues import issue
from coursepath.models import term_key
from coursepath.serialization import decimal_value, decimal_string

MODULE_CREDITS = Decimal(4)
EXPOSURE_CAP = Decimal(16)
TARGET_CAPS = {'open_project': Decimal(4), 'hss': Decimal(8), 'open_elective': None}
DECISION = 'docs/academic-decisions.md#4-external-exposure'
ATTENDANCE_SEVERITY = {'onsite_full_time': 'error', 'remote_or_part_time': 'approval_required'}


def _overlap_days(start, end, other_start, other_end):
    return max(0, (min(end, other_end) - max(start, other_start)).days)


def _items(context, plan):
    rows = [{**c, 'term_id': s['term_id']} for s in (plan or {}).get('semesters', []) for c in s.get('courses', [])]
    rows += [row for row in context.get('current_enrolment', []) if row.get('confirmed')]
    return rows


def _credits(modules):
    totals = {status: defaultdict(Decimal) for status in ['earned', 'approved', 'proposed']}
    for row in modules:
        if row['status'] in totals:
            totals[row['status']][row['intended_allocation']] += MODULE_CREDITS
    result = {}
    for status, by_target in totals.items():
        result[status] = decimal_string(sum(by_target.values(), Decimal(0)))
        result[status + '_by_target'] = {k: decimal_string(v) for k, v in by_target.items()}
    return result


def _modules(context, modules, issues):
    approvals = {a.get('id'): a for a in context.get('approvals', [])}
    registrations = {a.get('id') for a in context.get('attempts', [])} | {a.get('id') for a in context.get('current_enrolment', [])}
    remaining = context.get('remaining')
    seen, total, by_target, rows = set(), Decimal(0), defaultdict(Decimal), []
    for module in modules:
        module_id, target = module.get('id'), module.get('intended_allocation')
        problems = []
        if not module_id or module_id in seen or module.get('registration_id') in registrations - {None}:
            problems.append(('INTERNSHIP_MODULE_DUPLICATE', 'This module or its registration is already counted.'))
        seen.add(module_id)
        try:
            size_ok = decimal_value(module.get('credits')) == MODULE_CREDITS
        except ValueError:
            size_ok = False
        if not size_ok:
            problems.append(('INTERNSHIP_MODULE_INVALID', 'External-exposure modules are exactly 4 credits.'))
        if target not in TARGET_CAPS:
            problems.append(('INTERNSHIP_TARGET_INVALID', 'Exposure credit counts only toward open electives, HSS or the open project.'))
        if not problems:
            if total + MODULE_CREDITS > EXPOSURE_CAP:
                problems.append(('EXPOSURE_CREDIT_CAP', 'At most 16 external-exposure credits count.'))
            elif TARGET_CAPS[target] is not None and by_target[target] + MODULE_CREDITS > TARGET_CAPS[target]:
                problems.append(('EXPOSURE_TARGET_CAP', f'At most {TARGET_CAPS[target]} exposure credits count toward {target}.'))
        for code, message in problems:
            issues.append(issue(code, message, 'error', [module_id or ''], [DECISION]))
        if problems:
            rows.append({'id': module_id, 'intended_allocation': target, 'status': 'rejected', 'reasons': [c for c, _ in problems]})
            continue
        if remaining is not None and by_target[target] >= decimal_value(remaining.get(target, '0')):
            issues.append(issue('INTERNSHIP_TARGET_NOT_NEEDED', f'No remaining {target} credits need this module; its credits would be surplus.', 'warning', [module_id], [DECISION]))
        total += MODULE_CREDITS
        by_target[target] += MODULE_CREDITS
        approval = approvals.get(module.get('approval_ref'))
        verified = bool(approval) and approval.get('status') == 'verified' and module_id in approval.get('covered_entities', [])
        if verified and module.get('status') == 'completed' and grade_status(module.get('grade', '')) == 'completed':
            status = 'earned'
        else:
            status = 'approved' if verified else 'proposed'
        rows.append({'id': module_id, 'intended_allocation': target, 'status': status, 'reasons': []})
    if any(r['status'] == 'proposed' for r in rows):
        issues.append(issue('INTERNSHIP_APPROVAL_REQUIRED', 'Proposed modules earn credit only after recorded institute approval.', 'approval_required',
                            [r['id'] for r in rows if r['status'] == 'proposed'], [DECISION], 'Record the approval evidence for each module.'))
    if any(r['status'] != 'rejected' for r in rows):
        issues.append(issue('INTERNSHIP_LOAD_POLICY_UNKNOWN', 'No reviewed rule says whether exposure credits count toward the term credit load.',
                            entities=[r['id'] for r in rows if r['status'] != 'rejected']))
    return rows


def _downstream(context, plan_items, affected):
    attempts = context.get('attempts', [])
    kept = [row for row in plan_items if row['id'] not in affected]
    downstream = []
    for row in plan_items:
        metadata = context.get('catalogue', {}).get(row.get('normalized_code'))
        if row['id'] in affected or not metadata or not metadata.get('prerequisite_known'):
            continue
        before = evaluate_prerequisite(metadata['prerequisites'], row['term_id'], attempts, plan_items)
        after = evaluate_prerequisite(metadata['prerequisites'], row['term_id'], attempts, kept)
        if before['status'] in {'eligible', 'conditional'} and after['status'] == 'ineligible':
            downstream.append(row['id'])
    return downstream


def evaluate_internship(context, internship, plan, calendar):
    """Return dates, overlapped terms, affected and downstream courses, and module credits. Never mutates inputs."""
    context, plan = deepcopy(context), deepcopy(plan)
    choice = internship.get('duration_choice')
    if choice not in {'none', *MONTHS}:
        raise ValueError('Unsupported internship duration')
    result = {'id': internship.get('id'), 'duration_choice': choice, 'placement_mode': internship.get('placement_mode', 'unknown'),
              'start_date': None, 'end_date_exclusive': None, 'expected_end_date_exclusive': None, 'actual_days': None,
              'overlapping_terms': [], 'affected_courses': [], 'downstream_courses': [], 'unchecked_courses': [], 'modules': []}
    issues = []
    if choice == 'none':
        if internship.get('modules'):
            issues.append(issue('INTERNSHIP_STALE_MODULES', 'No internship is selected; remove its modules from this scenario.', 'error',
                                [m.get('id', '') for m in internship['modules']]))
        return {**result, 'credits': _credits([]), 'issues': issues}
    try:
        start, end = as_date(internship.get('start_date')), as_date(internship.get('end_date_exclusive'))
    except (TypeError, ValueError):
        start = end = None
    if start is None or end is None or start >= end:
        issues.append(issue('INTERNSHIP_DATES_INVALID', 'Enter a real start date before the end date.', 'error', [internship.get('id') or '']))
        return {**result, 'credits': _credits([]), 'issues': issues}
    expected = add_calendar_months(start, MONTHS[choice])
    result.update(start_date=start.isoformat(), end_date_exclusive=end.isoformat(), expected_end_date_exclusive=expected.isoformat(),
                  actual_days=(end - start).days)
    if expected != end:
        issues.append(issue('INTERNSHIP_DURATION_DIFFERS', f'These dates span {(end - start).days} days, not {MONTHS[choice]} calendar months.', 'warning'))
    plan_items = _items(context, plan)
    if not (calendar or {}).get('terms'):
        issues.append(issue('CALENDAR_MISSING', 'No academic calendar is available, so affected terms and courses were not checked.'))
        result['unchecked_courses'] = [row['id'] for row in plan_items]
    else:
        severity = ATTENDANCE_SEVERITY.get(result['placement_mode'], 'unknown')
        for term in sorted(calendar['terms'], key=lambda t: term_key(t['id'])):
            dates = term_dates(calendar, term['id'])
            if dates is None:
                continue
            days = _overlap_days(start, end, *dates)
            if not days:
                continue
            exams = any(_overlap_days(start, end, as_date(e['start_date']), as_date(e['end_date_exclusive'])) for e in term.get('exams', []))
            courses = [row['id'] for row in plan_items if row['term_id'] == term['id']]
            result['overlapping_terms'].append({'term_id': term['id'], 'overlap_days': days, 'exam_overlap': exams, 'course_ids': courses})
            result['affected_courses'] += courses
            if courses:
                issues.append(issue('INTERNSHIP_ATTENDANCE_CONFLICT', f"The internship overlaps {days} days of {term['id']}" + (' including exams' if exams else '') + '.',
                                    severity, courses, [calendar.get('id', 'calendar')], 'Move these courses, change the dates, or record permission. Nothing was moved.'))
        known = {t['id'] for t in calendar['terms'] if term_dates(calendar, t['id'])}
        result['unchecked_courses'] = [row['id'] for row in plan_items if row['term_id'] not in known]
        if result['unchecked_courses']:
            issues.append(issue('CALENDAR_MISSING', 'Some planned terms have no calendar dates; their overlap is unknown.', entities=result['unchecked_courses']))
        result['downstream_courses'] = _downstream(context, plan_items, set(result['affected_courses']))
        if result['downstream_courses']:
            issues.append(issue('INTERNSHIP_DOWNSTREAM_AFFECTED', 'Later courses rely on courses this internship overlaps.', 'warning', result['downstream_courses']))
    result['modules'] = _modules(context, internship.get('modules', []), issues)
    return {**result, 'credits': _credits(result['modules']), 'issues': issues}


def _assumptions(case):
    notes = []
    if case['duration_choice'] != 'none' and not case['modules']:
        notes.append('No IN 498 modules: the internship earns no academic credit by itself.')
    if case['affected_courses']:
        notes.append(f"{len(case['affected_courses'])} planned course(s) overlap the internship; completion assumes they move or are permitted. Nothing was moved.")
    if case['credits']['proposed'] != '0':
        notes.append(f"{case['credits']['proposed']} proposed exposure credits count only after approval.")
    if case['unchecked_courses']:
        notes.append('Some terms have no calendar dates, so their overlap was not checked.')
    return notes


def compare_internships(context, plan, calendar, cases):
    """Evaluate each case against the same untouched baseline."""
    evaluated = []
    for case in cases:
        result = evaluate_internship(context, case, plan, calendar)
        credits = result['credits']
        result['approved_credits'] = decimal_string(decimal_value(credits['approved']) + decimal_value(credits['earned']))
        result['completion_assumptions'] = _assumptions(result)
        evaluated.append(result)
    return {'baseline_record_revision': context.get('record_revision'), 'baseline_plan_revision': (plan or {}).get('revision'), 'cases': evaluated}


def propose_split(remaining, total='16'):
    """One proposal of module targets, narrowest bucket first, using only remaining needs."""
    budget, targets = decimal_value(total), []
    for target, cap in TARGET_CAPS.items():
        need = decimal_value(remaining.get(target, '0'))
        if cap is not None:
            need = min(need, cap)
        count = min(ceil(need / MODULE_CREDITS), int(budget // MODULE_CREDITS))
        targets += [target] * count
        budget -= MODULE_CREDITS * count
    return targets
