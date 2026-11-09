"""Online courses in a plan (D-11, D-13, D-41, D-42): which of the online credits a student plans would count toward the degree.

An online course in a plan is a placeholder with `online: true` (a requirement, credits and a name). Up to 16 online credits count (less
pass/fail conversions and online courses already on the record), and the general CSE electives take at most 8 of them together with CS projects.
The allocator already knows those caps, so this module asks it: each online placeholder becomes rows of at most 4 credits whose stand-in course
codes can fill only the requirement the student chose (or the open electives), the rows are allocated together with the record and the plan's
courses, and a row the allocator leaves out does not count. A row counts where the allocator puts it: above the 8-credit cap, or aimed at a
requirement online courses cannot fill (D-42), it counts as an open elective. Pure domain code: no Django, no network.
"""
from decimal import Decimal
from coursepath.degree_audit import evaluate_audit
from coursepath.issues import issue
from coursepath.serialization import decimal_string, decimal_value

ROW_CREDITS = Decimal(4)
ONLINE_POOL = Decimal(16)   # D-11, D-13: at most 16 online credits count, so no more rows than that are ever worth building (CR-103)
# A stand-in code per requirement: the subject prefix that requirement accepts. Anything else is treated as an open elective.
STAND_IN = {'cse-general': 'CS {}', 'hss-other': 'HS {}', 'bs-elective': 'BS {}', 'open-electives': 'ZZ {}'}


def online_placeholders(plan):
    return [(s['term_id'], p) for s in plan.get('semesters', []) for p in s.get('placeholders', []) if p.get('online') is True]


def count_online(curriculum, record, plan):
    """{'planned': Decimal, 'counted': Decimal, 'counted_by_placeholder': {id: Decimal}, 'counted_by_requirement': {requirement id: Decimal},
    'issues': [...]} for the online placeholders of `plan`."""
    found = online_placeholders(plan)
    planned = sum((decimal_value(p['desired_credits']) for _, p in found), Decimal(0))
    if not found:
        return {'planned': Decimal(0), 'counted': Decimal(0), 'counted_by_placeholder': {}, 'counted_by_requirement': {}, 'issues': []}
    rows, owner, number = {}, {}, 0
    built = Decimal(0)
    for term, placeholder in found:
        # Nothing past the pool can count, so rows past it are never built: a placeholder asking for thousands of credits costs no more than 16.
        left = min(decimal_value(placeholder['desired_credits']), ONLINE_POOL - built)
        while left > 0:
            number += 1
            credits = min(ROW_CREDITS, left)
            code = STAND_IN.get(placeholder['requirement_id'], 'ZZ {}').format(900 + number)
            row_id = f'online-row-{number}'
            rows.setdefault(term, []).append({'id': row_id, 'normalized_code': code, 'credits': decimal_string(credits), 'online': True})
            owner[row_id] = (placeholder['id'], credits)
            left -= credits
            built += credits
    semesters = []
    for semester in plan.get('semesters', []):
        semesters.append({'term_id': semester['term_id'], 'courses': list(semester.get('courses', [])) + rows.get(semester['term_id'], [])})
    audit = evaluate_audit(curriculum, {}, record, {'semesters': semesters})
    placed = {a['attempt_id']: a['requirement_id'] for a in audit['projected_ledger']}   # a course is never split between requirements (D-07)
    allocated = set(placed)
    counted_rows = {row_id: credits for row_id, (_placeholder, credits) in owner.items() if row_id in allocated}
    # Online courses already on the record are earned and come first: if the allocator left some of them out to fit the plan's rows in, the plan's
    # rows count that much less.
    recorded = {a['id']: decimal_value(a['credits']) for a in record.get('attempts', []) if a.get('online') is True and a.get('completion_status') == 'completed'}
    baseline = {a['attempt_id'] for a in evaluate_audit(curriculum, {}, record, {'semesters': []})['ledger']}
    displaced = sum((credits for row_id, credits in recorded.items() if row_id in baseline and row_id not in allocated), Decimal(0))
    for row_id in reversed(list(counted_rows)):
        if displaced <= 0:
            break
        cut = min(displaced, counted_rows[row_id])
        counted_rows[row_id] -= cut
        displaced -= cut
    counted_by, counted_in = {}, {}
    for row_id, credits in counted_rows.items():
        counted_by[owner[row_id][0]] = counted_by.get(owner[row_id][0], Decimal(0)) + credits
        if credits > 0:
            counted_in[placed[row_id]] = counted_in.get(placed[row_id], Decimal(0)) + credits
    counted = sum(counted_by.values(), Decimal(0))
    issues = []
    if counted < planned:
        short = [(term, p) for term, p in found if counted_by.get(p['id'], Decimal(0)) < decimal_value(p['desired_credits'])]
        refs = [ref for term, p in short for ref in (term, p['id'])]
        issues.append(issue('ONLINE_CREDIT_LIMIT', f'Only {decimal_string(counted)} of your {decimal_string(planned)} online credits count toward your degree.', 'warning',
                            list(dict.fromkeys(refs)), [], 'Plan fewer online credits, or choose a requirement that still needs credits.'))
    return {'planned': planned, 'counted': counted, 'counted_by_placeholder': counted_by, 'counted_by_requirement': counted_in, 'issues': issues}
