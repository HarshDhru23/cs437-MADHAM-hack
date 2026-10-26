"""Strict client payload checks; academic authority is supplied separately."""
from copy import deepcopy
import re
from coursepath.models import validate_term_id
from coursepath.imports.normalization import normalize_code, CODE
from coursepath.serialization import decimal_value, decimal_string


def text(value, limit=160):
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ValueError('Expected bounded nonempty text')
    return value


def course_code(value):
    text(value, 100)
    if not re.fullmatch(CODE, value):
        raise ValueError('Invalid course code')
    return normalize_code(value)


def plan_payload(payload):
    if not isinstance(payload, dict) or set(payload) - {'semesters', 'label', 'expected_revision'}:
        raise ValueError('Unsupported plan fields')
    result = deepcopy({k: v for k, v in payload.items() if k != 'expected_revision'})
    semesters = result.setdefault('semesters', [])
    if not isinstance(semesters, list) or len(semesters) > 40:
        raise ValueError('At most 40 terms per plan')
    if 'label' in result:
        text(result['label'], 200)
    terms, ids = set(), set()
    for semester in semesters:
        if not isinstance(semester, dict) or set(semester) - {'term_id', 'semester_id', 'courses', 'placeholders'}:
            raise ValueError('Invalid semester')
        term = validate_term_id(semester['term_id'])
        if term in terms:
            raise ValueError('Duplicate term')
        terms.add(term)
        for key in ['courses', 'placeholders']:
            items = semester.setdefault(key, [])
            if not isinstance(items, list) or len(items) > 100:
                raise ValueError('Invalid planned items')
            for item in items:
                if not isinstance(item, dict):
                    raise ValueError('Expected item object')
                identity = text(item['id'])
                if identity in ids:
                    raise ValueError('Duplicate item ID')
                ids.add(identity)
                if key == 'courses':
                    if set(item) - {'id', 'normalized_code', 'course_id', 'course_version_id', 'credits', 'offering_id', 'section_ids', 'instance_id', 'assumptions', 'intended_allocation'}:
                        raise ValueError('Unsupported course field')
                    item['normalized_code'] = course_code(item.get('normalized_code', item.get('course_id')))
                    item['credits'] = decimal_string(decimal_value(item['credits']))
                    if item.get('section_ids') is not None and (not isinstance(item['section_ids'], list) or any(not isinstance(s, str) or len(s) > 160 for s in item['section_ids'])):
                        raise ValueError('Invalid section IDs')
                    if item.get('instance_id') is not None:
                        text(item['instance_id'])
                else:
                    if set(item) - {'id', 'requirement_id', 'desired_credits', 'label'}:
                        raise ValueError('Unsupported placeholder field')
                    text(item['requirement_id'])
                    item['desired_credits'] = decimal_string(decimal_value(item['desired_credits']))
    return result


def current_enrolment(rows):
    if not isinstance(rows, list) or len(rows) > 100:
        raise ValueError('Invalid current enrolment')
    ids = set()
    for item in rows:
        if not isinstance(item, dict) or set(item) - {'id', 'normalized_code', 'term_id', 'credits', 'confirmed', 'section_ids', 'course_version_id'}:
            raise ValueError('Invalid enrolment fields')
        text(item['id'])
        if item['id'] in ids or item.get('confirmed') is not True:
            raise ValueError('Enrolment must have distinct IDs and be explicitly confirmed')
        ids.add(item['id'])
        validate_term_id(item['term_id'])
        course_code(item['normalized_code'])
        decimal_value(item['credits'])
    return deepcopy(rows)
