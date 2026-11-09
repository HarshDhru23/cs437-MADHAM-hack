import hashlib
import re
import unicodedata
from collections import defaultdict
from functools import lru_cache
from decimal import Decimal
from coursepath.models import validate_term_id
from coursepath.serialization import decimal_value, decimal_string
from coursepath.imports.grades import grade_status
from coursepath.imports.grades import POINTS
from coursepath.issues import issue

# The learning designation every imported row starts with (D-21). Restore checks read it too, so change it only here.
IMPORTED_LEARNING_DESIGNATION = 'degree'

# Special-topics sections carry a suffix ("CS 392-I", "MS 491-VIII"); the full code is the identity (D-01, D-06).
CODE = r'[A-Za-z]{2,5}\s*\d{2,4}(?:-[A-Za-z0-9]{1,6})?(?:\s*\([^\n)]{1,20}\))?'
TERM = r'20\d{2}\s*-\s*(?:20)?\d{2}\s*(?:-\s*)?(?:(?:Semester|Sem)\s*[-:]?\s*)?(?:SUMMER|II|I)\b'


def normalize_text(text):
    text = unicodedata.normalize('NFKC', text)
    return text.translate(str.maketrans({'–': '-', '—': '-', '−': '-', '\u00a0': ' '})).replace('\r\n', '\n').replace('\r', '\n')


def normalize_code(code):
    text = normalize_text(code).strip().upper()
    text = re.sub(r'^([A-Z]+)\s*(\d+)', r'\1 \2', text)
    return re.sub(r'\s+\(', '(', text)


def normalize_term(term):
    match = re.fullmatch(r'(20\d{2})\s*-\s*(?:20)?(\d{2})\s*-?\s*(?:(?:Semester|Sem)\s*[-:]?\s*)?(SUMMER|II|I)', normalize_text(term).strip(), re.I)
    if not match:
        raise ValueError('Unrecognized academic period')
    return validate_term_id(f'{match[1]}-{match[2]}-{match[3].upper()}')


def empty_result():
    return {'candidate_attempts': [], 'reported_controls': {}, 'unparsed_rows': [], 'issues': []}


def candidate(term, code, title, credits, grade, source_ref, locator, occurrence=0):
    term = normalize_term(term)
    normalized_code = normalize_code(code)
    source_id = source_ref if isinstance(source_ref, str) else source_ref['id']
    key = hashlib.sha256(f'{source_id}|{term}|{normalized_code}|{occurrence}'.encode()).hexdigest()
    grade = normalize_text(grade).strip().upper()
    source = {'id': source_id, **locator}
    return {'id': key, 'source_key': key, 'normalized_code': normalized_code, 'original_code': code,
            'title': ' '.join(title.split()), 'credits': decimal_string(decimal_value(credits.strip())),
            'grade': grade, 'term_id': term, 'completion_status': grade_status(grade),
            'learning_designation': IMPORTED_LEARNING_DESIGNATION, 'course_version_id': None, 'instance_id': None,
            'source_refs': [source], 'user_corrections': [], 'approval_refs': [],
            'original': {'code': code, 'title': title, 'credits': credits, 'grade': grade}}


@lru_cache(maxsize=1)
def _curriculum():
    from coursepath.rules.loader import load_curriculum
    return load_curriculum()


EQUIVALENCE_NOTES = {
    'CS 203': 'CS 203 is kept as imported and counts as a CS-coded discipline elective; the CS 202 core stays pending.',
    'CS 421': 'CS 421 is its own CS-coded discipline elective, not CS 431.',
}


def candidate_issues(row):
    """Rows are matched by the approved rules (D-29); only a row no rule can place needs human review."""
    from coursepath.catalogue import classify_code
    from coursepath.identity import canonical_code, identity_map
    curriculum = _curriculum()
    issues = []
    excluded = {canonical_code(e['course_id'], identity_map(curriculum.get('identity_groups'))) for e in curriculum.get('excluded_courses', [])}
    canonical = canonical_code(row['normalized_code'], identity_map(curriculum.get('identity_groups')))
    if canonical in excluded:
        issues.append(issue('COURSE_NOT_COUNTED', 'Kept on your record but never counted toward the 170 degree credits (one-credit short course).', 'info', [row['id']]))
    elif not classify_code(curriculum, row['normalized_code'], row['credits']):
        issues.append(issue('UNMATCHED_COURSE', 'No approved rule places this course in a requirement; check the code and credits.', entities=[row['id']]))
    if row['normalized_code'] in EQUIVALENCE_NOTES:
        issues.append(issue('EQUIVALENCE_UNCONFIRMED', EQUIVALENCE_NOTES[row['normalized_code']], 'info', [row['id']]))
    if row['completion_status'] == 'unknown':
        issues.append(issue('GRADE_UNKNOWN', 'Blank or unsupported grade needs correction or policy evidence.', 'error', [row['id']]))
    return issues


def summarize_candidates(result):
    terms = defaultdict(lambda: {'attempt_count': 0, 'raw_credits': Decimal(0)})
    raw, earned, denominator, numerator = (Decimal(0) for _ in range(4))
    for row in result['candidate_attempts']:
        credits = decimal_value(row['credits'])
        raw += credits
        terms[row['term_id']]['attempt_count'] += 1
        terms[row['term_id']]['raw_credits'] += credits
        if row['completion_status'] == 'completed':
            earned += credits
        if row['grade'] in POINTS:
            denominator += credits
            numerator += credits * POINTS[row['grade']]
    result['extracted_controls'] = {'attempt_count': len(result['candidate_attempts']), 'raw_credits': decimal_string(raw),
        'reported_grade_earned_credits': decimal_string(earned), 'performance_credits': decimal_string(denominator),
        'grade_points': decimal_string(numerator), 'degree_allocated_credits': None, 'status': 'arithmetic_only',
        'terms': {term: {**values, 'raw_credits': decimal_string(values['raw_credits'])} for term, values in sorted(terms.items())}}
    return result
