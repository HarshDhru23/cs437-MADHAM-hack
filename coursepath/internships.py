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
from coursepath.identity import canonical_code
from coursepath.imports.grades import grade_status
from coursepath.issues import issue
from coursepath.models import term_key
from coursepath.serialization import decimal_value, decimal_string

MODULE_CREDITS = Decimal(4)
EXPOSURE_CAP = Decimal(16)
TARGET_CAPS = {'open_project': Decimal(4), 'hss': Decimal(8), 'open_elective': None}
TIERS = ('earned', 'approved', 'proposed')
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


def _need(remaining, target):
    """Remaining credits a bucket still needs; None (unknown, never zero) when missing, None or malformed."""
    try:
        return decimal_value(remaining.get(target))
    except ValueError:
        return None


def _record_credits(context):
    """Passing IN 498 attempts already on the record. Their target bucket is not stored, so only the total is known."""
    ids, total = [], Decimal(0)
    for attempt in context.get('attempts', []):
        if attempt.get('normalized_code') != 'IN 498' or attempt.get('completion_status') != 'completed':
            continue
        try:
            credits = decimal_value(attempt.get('credits'))
        except ValueError:
            credits = MODULE_CREDITS  # D-14: exposure credit comes in 4-credit modules
        ids.append(attempt.get('id') or '')
        total += credits
    return ids, total


def _modules(context, modules, issues):
    approvals = {a.get('id'): a for a in context.get('approvals', [])}
    registrations = {a.get('id') for a in context.get('attempts', [])} | {a.get('id') for a in context.get('current_enrolment', [])}
    remaining = context.get('remaining')
    record_ids, record = _record_credits(context)
    unmatched = [i for i in record_ids if i not in {m.get('registration_id') for m in modules}]
    seen, total, by_target, rows, unregistered = set(), record, defaultdict(Decimal), [], set()
    for module in modules:
        module_id, target = module.get('id'), module.get('intended_allocation')
        problems = []
        if not module_id or module_id in seen or module.get('registration_id') in registrations - {None}:
            problems.append(('INTERNSHIP_MODULE_DUPLICATE', 'This module or its registration is already counted.'))
        seen.add(module_id)
        registrations.add(module.get('registration_id'))
        try:
            size_ok = decimal_value(module.get('credits')) == MODULE_CREDITS
        except ValueError:
            size_ok = False
        if not size_ok:
            problems.append(('INTERNSHIP_MODULE_INVALID', 'External-exposure modules are exactly 4 credits.'))
        if target not in TARGET_CAPS:
            problems.append(('INTERNSHIP_TARGET_INVALID', 'Exposure credit counts only toward open electives, HSS or the open project.'))
        for code, message in problems:
            issues.append(issue(code, message, 'error', [module_id or ''], [DECISION]))
        if problems:
            rows.append({'id': module_id, 'intended_allocation': target, 'status': 'rejected', 'reasons': [c for c, _ in problems]})
            continue
        approval = approvals.get(module.get('approval_ref'))
        verified = bool(approval) and approval.get('status') == 'verified' and module_id in approval.get('covered_entities', [])
        completed = module.get('status') == 'completed'
        outcome = grade_status(str(module.get('grade') or ''))  # a missing or unrecognised grade is 'unknown', never a fail
        if completed and outcome == 'unknown':
            issues.append(issue('INTERNSHIP_GRADE_UNKNOWN', 'This module is marked completed but its grade is missing or not recognised, so its credit is not earned yet.',
                                'unknown', [module_id], [DECISION], 'Record the module grade.'))
        if completed and outcome == 'failed':
            issues.append(issue('INTERNSHIP_MODULE_FAILED', 'This module was completed with a failing grade, so it earns no credit.', 'warning', [module_id], [DECISION]))
            rows.append({'id': module_id, 'intended_allocation': target, 'status': 'failed', 'reasons': ['INTERNSHIP_MODULE_FAILED']})
            continue
        status = 'earned' if verified and completed and outcome == 'completed' else 'approved' if verified else 'proposed'
        rows.append({'id': module_id, 'intended_allocation': target, 'status': status, 'reasons': []})
        if completed and outcome == 'completed' and not module.get('registration_id'):
            unregistered.add(module_id)
    # Caps fill by tier, earned then approved then proposed (input order within a tier), so a proposal never pushes out credit already approved.
    # A passed module without a registration may be an unmatched IN 498 attempt already in `record`, so up to that many are not added again.
    on_record = f', including {decimal_string(record)} already on the record' if record else ''
    matched = []
    for row in sorted((r for r in rows if r['status'] in TIERS), key=lambda r: TIERS.index(r['status'])):
        module_id, target = row['id'], row['intended_allocation']
        same = module_id in unregistered and len(matched) < len(unmatched)
        if not same and total + MODULE_CREDITS > EXPOSURE_CAP:
            code, message = 'EXPOSURE_CREDIT_CAP', f'At most 16 external-exposure credits count{on_record}.'
        elif TARGET_CAPS[target] is not None and by_target[target] + MODULE_CREDITS > TARGET_CAPS[target]:
            code, message = 'EXPOSURE_TARGET_CAP', f'At most {TARGET_CAPS[target]} exposure credits count toward {target}.'
        else:
            code = None
        if code:
            issues.append(issue(code, message, 'error', [module_id], [DECISION]))
            row.update(status='rejected', reasons=[code])
            continue
        need = None if remaining is None else _need(remaining, target)
        if remaining is not None and need is None:
            issues.append(issue('INTERNSHIP_TARGET_NEED_UNKNOWN', f'The remaining {target} need is unknown, so this module may be surplus.', 'unknown', [module_id], [DECISION]))
        elif need is not None and by_target[target] >= need:
            issues.append(issue('INTERNSHIP_TARGET_NOT_NEEDED', f'No remaining {target} credits need this module; its credits would be surplus.', 'warning', [module_id], [DECISION]))
        if same:
            matched.append(module_id)
        else:
            total += MODULE_CREDITS
        by_target[target] += MODULE_CREDITS
    if matched:
        issues.append(issue('INTERNSHIP_RECORD_MATCH_UNKNOWN', 'A completed module without a registration may be an IN 498 attempt already on the record, so it is not counted twice.',
                            'unknown', unmatched + matched, [DECISION], 'Record the registration ID of each completed module.'))
    capped = [r['id'] for r in rows if r['status'] in TIERS and TARGET_CAPS[r['intended_allocation']] is not None]
    if record and capped:
        issues.append(issue('INTERNSHIP_RECORD_TARGET_UNKNOWN', 'IN 498 credits already on the record have no stored target, so the HSS and open-project limits may already be partly used.',
                            'unknown', record_ids + capped, [DECISION], 'Record which requirement each earlier IN 498 module counted toward.'))
    if any(r['status'] == 'proposed' for r in rows):
        issues.append(issue('INTERNSHIP_APPROVAL_REQUIRED', 'Proposed modules earn credit only after recorded institute approval.', 'approval_required',
                            [r['id'] for r in rows if r['status'] == 'proposed'], [DECISION], 'Record the approval evidence for each module.'))
    if any(r['status'] in TIERS for r in rows):
        issues.append(issue('INTERNSHIP_LOAD_RULE', 'External-exposure credits count toward the credit load of the term they are registered in.', 'info',
                            [r['id'] for r in rows if r['status'] in TIERS]))
    return rows


def _downstream(context, plan_items, affected):
    """Courses that lose their preparation, transitively: a course that needs a downstream course is downstream too."""
    attempts = context.get('attempts', [])
    removed, changed = set(affected), True
    while changed:  # `removed` only grows and is bounded by the plan, so prerequisite cycles cannot loop forever
        changed = False
        kept = [row for row in plan_items if row['id'] not in removed]
        for row in kept:
            metadata = context.get('catalogue', {}).get(canonical_code(row.get('normalized_code'), context.get('identity')))
            if not metadata or not metadata.get('prerequisite_known'):
                continue
            before = evaluate_prerequisite(metadata['prerequisites'], row['term_id'], attempts, plan_items, context.get('identity'))
            after = evaluate_prerequisite(metadata['prerequisites'], row['term_id'], attempts, kept, context.get('identity'))
            if before['status'] in {'eligible', 'conditional'} and after['status'] == 'ineligible':
                removed.add(row['id'])
                changed = True
    return [row['id'] for row in plan_items if row['id'] in removed and row['id'] not in affected]


def _exam_overlap(start, end, exams):
    """True on any known overlap, None when an exam window without dates leaves it unknown, else False."""
    unknown = False
    for exam in exams:
        try:
            exam_start, exam_end = as_date(exam.get('start_date')), as_date(exam.get('end_date_exclusive'))
        except (TypeError, ValueError):
            exam_start = exam_end = None
        if exam_start is None or exam_end is None:
            unknown = True
        elif _overlap_days(start, end, exam_start, exam_end):
            return True
    return None if unknown else False


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
        issues.append(issue('CALENDAR_MISSING', 'No academic calendar is published, so affected terms and courses were not checked.', 'info'))
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
            exams = _exam_overlap(start, end, term.get('exams', []))
            courses = [row['id'] for row in plan_items if row['term_id'] == term['id']]
            result['overlapping_terms'].append({'term_id': term['id'], 'overlap_days': days, 'exam_overlap': exams, 'course_ids': courses})
            result['affected_courses'] += courses
            if courses:
                issues.append(issue('INTERNSHIP_ATTENDANCE_CONFLICT', f"The internship overlaps {days} days of {term['id']}" + (' including exams' if exams else '') + '.',
                                    severity, courses, [calendar.get('id', 'calendar')], 'Move these courses, change the dates, or record permission. Nothing was moved.'))
            if exams is None:
                issues.append(issue('CALENDAR_MISSING', f"An exam window in {term['id']} has no dates, so whether the internship overlaps exams is unknown.",
                                    entities=[term['id']], sources=[calendar.get('id', 'calendar')]))
        known = {t['id'] for t in calendar['terms'] if term_dates(calendar, t['id'])}
        result['unchecked_courses'] = [row['id'] for row in plan_items if row['term_id'] not in known]
        if result['unchecked_courses']:
            issues.append(issue('CALENDAR_MISSING', 'Some planned terms have no published calendar dates yet; their overlap is not checked.', 'info', result['unchecked_courses']))
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
    """One proposal of module targets, narrowest bucket first, using only remaining needs.

    Returns {'targets': [...], 'issues': [...]}. A bucket missing from `remaining`, or None, is unknown, never
    zero: it gets no modules and an INTERNSHIP_TARGET_NEED_UNKNOWN issue instead of being skipped silently.
    """
    budget, targets, issues = decimal_value(total), [], []
    for target, cap in TARGET_CAPS.items():
        need = _need(remaining or {}, target)
        if need is None:
            issues.append(issue('INTERNSHIP_TARGET_NEED_UNKNOWN', f'The remaining {target} need is unknown, so no {target} modules were proposed.', 'unknown',
                                [target], [DECISION], f'Record the remaining {target} credits.'))
            continue
        if cap is not None:
            need = min(need, cap)
        count = min(ceil(need / MODULE_CREDITS), int(budget // MODULE_CREDITS))
        targets += [target] * count
        budget -= MODULE_CREDITS * count
    return {'targets': targets, 'issues': issues}
