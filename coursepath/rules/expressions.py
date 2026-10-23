from decimal import Decimal
from coursepath.serialization import decimal_value, decimal_string


def requirement_result(rule, totals, counts, ledger, review=False, conditional=False):
    children = [requirement_result(child, totals, counts, ledger, review, conditional) for child in rule.get('children', [])]
    required = decimal_value(rule.get('minimum_credits', '0'))
    if children:
        if rule['type'] == 'any_of':
            selected = max(children, key=lambda c: (c['status'] in {'satisfied', 'conditional'}, decimal_value(c['counted_credits'])))
            counted = decimal_value(selected['counted_credits'])
            met = selected['status'] in {'satisfied', 'conditional'}
        else:
            counted = sum((decimal_value(c['counted_credits']) for c in children), Decimal(0))
            met = all(c['status'] in {'satisfied', 'conditional'} for c in children) and counted >= required
        count = sum(c['counted_courses'] for c in children)
    else:
        counted = totals.get(rule['id'], Decimal(0))
        count = counts.get(rule['id'], 0)
        minimum_count = rule.get('minimum_courses', 1 if rule['type'] in {'mandatory_course', 'noncredit'} else 0)
        met = counted >= required and count >= minimum_count
    unknown_child = any(c['status'] == 'needs_review' for c in children) and (rule['type'] != 'any_of' or not met)
    status = 'needs_review' if review or unknown_child or not children and rule.get('course_ids', []) is None else ('conditional' if met and conditional else 'satisfied' if met else 'pending')
    return {'id': rule['id'], 'label': rule.get('label', rule['id']), 'status': status,
            'required_credits': decimal_string(required), 'counted_credits': decimal_string(counted),
            'remaining_credits': decimal_string(max(Decimal(0), required - counted)), 'counted_courses': count,
            'required_courses': rule.get('minimum_courses'),
            'allocation_ids': [a['id'] for a in ledger if a['requirement_id'] == rule['id']],
            'source_refs': rule.get('source_refs', []), 'children': children}
