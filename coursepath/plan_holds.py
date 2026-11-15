"""What a plan's placeholders keep and what the plan still leaves uncovered (D-53, CP-40). Used by the plan check, the requirements view
"With my plan" and the scenario finishing term (issue #156)."""
from decimal import Decimal
from coursepath.degree_audit import requirement_progress
from coursepath.online_credits import count_online
from coursepath.serialization import decimal_string, decimal_value


def plan_holds(rules, record, audit, payload):
    """What a plan's placeholders keep: per credit-bearing requirement the credits held (never more than it can still take) and what stays
    uncovered. Returns the online count, the credits held per requirement before capping, the requirement rows and the total uncovered."""
    online = count_online(rules, record, payload)   # which of the planned online credits count (the pool of 16 and the discipline-elective cap)
    # An online credit is held where the allocator counted it (D-10, D-42): above the 8-credit discipline cap, or aimed at a requirement online
    # courses cannot fill, it holds open-elective credit, never the requirement the student aimed it at.
    held = dict(online['counted_by_requirement'])
    for semester in payload['semesters']:
        for p in semester.get('placeholders', []):
            if p.get('online') is not True:
                held[p['requirement_id']] = held.get(p['requirement_id'], Decimal(0)) + decimal_value(p['desired_credits'])
    requirements, uncovered = [], Decimal(0)
    for row in requirement_progress(rules, audit['projected']):
        covered = min(held.get(row['id'], Decimal(0)), decimal_value(row['remaining_credits']))
        left = decimal_value(row['remaining_credits']) - covered
        uncovered += left
        requirements.append({**row, 'held_credits': decimal_string(covered), 'uncovered_credits': decimal_string(left)})
    return online, held, requirements, uncovered
