import hashlib
import re
import unicodedata
from collections import defaultdict
from decimal import Decimal
from coursepath.models import validate_term_id
from coursepath.serialization import decimal_value, decimal_string
from coursepath.imports.grades import grade_status
from coursepath.imports.grades import POINTS
from coursepath.issues import issue

CODE = r'[A-Za-z]{2,5}\s*\d{2,4}(?:\s*\([^\n)]{1,20}\))?'
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
            'learning_designation': 'degree', 'course_version_id': None, 'instance_id': None,
            'source_refs': [source], 'user_corrections': [], 'approval_refs': [],
            'original': {'code': code, 'title': title, 'credits': credits, 'grade': grade}}


def candidate_issues(row):
    issues = [issue('UNMATCHED_COURSE', 'Catalogue classification has not been reviewed.', entities=[row['id']])]
    if row['normalized_code'] in {'CS 203', 'CS 421'}:
        issues.append(issue('EQUIVALENCE_UNCONFIRMED', 'Keep the reported code; no equivalence is approved.', entities=[row['id']]))
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
