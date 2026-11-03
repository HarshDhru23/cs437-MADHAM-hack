from collections import Counter
import re
from coursepath.identity import canonical_code
from decimal import Decimal, ROUND_HALF_UP, ROUND_HALF_EVEN, localcontext
from coursepath.models import term_key
from coursepath.repeats import superseded_attempts
from coursepath.serialization import decimal_value, decimal_string
from coursepath.issues import issue


def calculate_performance(attempts, grading_policy, identity=None):
    points = {grade: decimal_value(value) for grade, value in grading_policy['points'].items()}
    rows = sorted(attempts, key=lambda a: (term_key(a['term_id']), a['id']))
    issues = []
    counts = Counter(canonical_code(a['normalized_code'], identity) for a in rows)
    if grading_policy.get('review_status') != 'reviewed':
        issues.append(issue('GRADING_SOURCE_UNREVIEWED', 'Reported grade mapping is not an approved evaluation policy.'))
    if any(count > 1 for count in counts.values()) and grading_policy.get('repeat_policy') not in {'count_all', 'best_grade'}:
        issues.append(issue('REPEAT_POLICY_UNKNOWN', 'Repeated registrations/retakes need an applicable inclusion policy.'))
    superseded = set()
    if grading_policy.get('repeat_policy') == 'best_grade':
        # D-15: only the attempt that earns the credit enters CPI, ranked exactly as the allocation ranks it, so a P that
        # supersedes an F leaves nothing in CPI (D-11). Projects and IN 498 modules are separate courses (D-01, A.12).
        patterns = grading_policy.get('separate_course_patterns', [])
        superseded = superseded_attempts(rows, identity, lambda _, code: any(re.search(p, code) for p in patterns))
    rounding = {'half_up': ROUND_HALF_UP, 'half_even': ROUND_HALF_EVEN}.get(grading_policy.get('rounding'))
    if rounding is None:
        issues.append(issue('ROUNDING_POLICY_UNKNOWN', 'No official display rounding policy supplied; display value unavailable.'))
    places = grading_policy.get('decimal_places', 2)
    if type(places) is not int or not 0 <= places <= 4:
        raise ValueError('Unsupported display precision')
    source_refs = grading_policy.get('source_refs', [])

    def aggregate(selected, cap=None, reported=None, cumulative=False):
        numerator, denominator = Decimal(0), Decimal(0)
        contributing, excluded, local_issues = [], [], []
        for attempt in selected:
            credits = decimal_value(attempt['credits'])
            grade = attempt.get('grade', '').strip().upper()
            reason = None
            if attempt.get('completion_status') in {'in_progress', 'planned'}:
                reason = 'NOT_GRADED'
            elif cumulative and attempt['id'] in superseded:
                reason = 'SUPERSEDED_REPEAT'
            elif credits == 0:
                reason = 'ZERO_CREDIT'
            elif grade in grading_policy.get('excluded_grades', []):
                reason = 'PERFORMANCE_EXCLUDED_GRADE'
            elif grade not in points:
                reason = 'GRADE_POLICY_UNKNOWN'
                local_issues.append(issue('GRADE_POLICY_UNKNOWN', 'Unsupported grade prevents a verified calculation.', entities=[attempt['id']]))
            elif attempt.get('learning_designation') != 'degree' and grading_policy.get('additional_learning_policy') not in {'include', 'exclude'}:
                local_issues.append(issue('ADDITIONAL_LEARNING_POLICY_UNKNOWN', 'Learning-designation inclusion is unresolved.', entities=[attempt['id']]))
            if attempt.get('learning_designation') == 'additional' and grading_policy.get('additional_learning_policy') == 'exclude':
                reason = 'ADDITIONAL_LEARNING'
            if reason:
                excluded.append({'attempt_id': attempt['id'], 'reason': reason})
                continue
            denominator += credits
            numerator += credits * points[grade]
            contributing.append({'attempt_id': attempt['id'], 'credits': decimal_string(credits), 'grade': grade, 'grade_points': decimal_string(credits * points[grade])})
        with localcontext() as context:
            context.prec = 40
            raw = numerator / denominator if denominator else None
            capped = min(raw, decimal_value(cap)) if raw is not None and cap is not None else raw
            display = format(capped.quantize(Decimal(1).scaleb(-places), rounding=rounding), f'.{places}f') if capped is not None and rounding else None
        if reported is not None and display is not None and Decimal(str(reported)) != Decimal(display):
            local_issues.append(issue('PERFORMANCE_REPORTED_MISMATCH', 'Reported and recalculated values differ.'))
        result = {'grade_points': decimal_string(numerator), 'performance_credits': decimal_string(denominator),
                  'unrounded_value': decimal_string(raw) if raw is not None else None, 'display_value': display,
                  'source_reported_value': reported, 'complete': not issues and not local_issues and denominator > 0,
                  'contributing_attempts': contributing, 'excluded_attempts': excluded, 'source_refs': source_refs,
                  'policy_id': grading_policy['id'], 'issues': local_issues,
                  'hypothetical': any(a.get('hypothetical') is True for a in selected)}
        return result

    cumulative = aggregate(rows, grading_policy.get('cpi_cap'), grading_policy.get('source_reported_cpi'), cumulative=True)
    terms = [{'term_id': term, **aggregate([a for a in rows if a['term_id'] == term], grading_policy.get('spi_cap'))} for term in sorted({a['term_id'] for a in rows}, key=term_key)]
    return {'cumulative': cumulative, 'terms': terms, 'issues': issues + cumulative['issues']}
