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


SCENARIO_FIELDS = {'plan_id', 'label', 'changes', 'internship', 'award_ids', 'expected_revision', 'rebase'}
CHANGE_FIELDS = {'op', 'item_id', 'term_id', 'credits', 'grade', 'course'}
INTERNSHIP_FIELDS = {'duration_choice', 'preset', 'start_date', 'end_date_exclusive', 'placement_mode', 'modules', 'notes'}
MODULE_FIELDS = {'id', 'credits', 'intended_allocation', 'status', 'quad_id', 'approval_ref', 'registration_id', 'grade'}


def _date_text(value):
    if value is not None and (not isinstance(value, str) or len(value) > 10):
        raise ValueError('Dates are ISO YYYY-MM-DD strings or null')
    return value


def scenario_payload(payload):
    """Validated scenario fields. Modules cannot carry an approval status: only staff-verified evidence approves."""
    if not isinstance(payload, dict) or set(payload) - SCENARIO_FIELDS:
        raise ValueError('Unsupported scenario fields')
    result = {}
    if 'label' in payload:
        result['label'] = text(payload['label'], 200)
    if 'changes' in payload:
        changes = payload['changes']
        if not isinstance(changes, list) or len(changes) > 100:
            raise ValueError('Expected at most 100 changes')
        for change in changes:
            if not isinstance(change, dict) or set(change) - CHANGE_FIELDS or change.get('op') not in {'drop', 'fail', 'postpone', 'replace', 'grade', 'cap'}:
                raise ValueError('Invalid scenario change')
            if 'item_id' in change:
                text(change['item_id'])
            if 'term_id' in change:
                validate_term_id(change['term_id'])
            if 'credits' in change:
                change['credits'] = decimal_string(decimal_value(change['credits']))
            if 'grade' in change:
                text(change['grade'], 4)
            if 'course' in change:
                course = change['course']
                if not isinstance(course, dict) or set(course) != {'normalized_code', 'credits'}:
                    raise ValueError('A replacement names a course code and credits')
                change['course'] = {'normalized_code': course_code(course['normalized_code']), 'credits': decimal_string(decimal_value(course['credits']))}
        result['changes'] = deepcopy(changes)
    if 'internship' in payload:
        internship = payload['internship']
        if internship is not None:
            if not isinstance(internship, dict) or set(internship) - INTERNSHIP_FIELDS:
                raise ValueError('Unsupported internship fields')
            if internship.get('duration_choice') not in {'none', 'three_months', 'six_months'}:
                raise ValueError('Choose none, three_months or six_months')
            if internship.get('preset', 'custom') not in {'summer', 'semester', 'custom'}:
                raise ValueError('Invalid preset')
            if internship.get('placement_mode', 'unknown') not in {'onsite_full_time', 'remote_or_part_time', 'unknown'}:
                raise ValueError('Invalid placement mode')
            _date_text(internship.get('start_date'))
            _date_text(internship.get('end_date_exclusive'))
            if 'notes' in internship:
                text(internship['notes'], 2000)
            modules = internship.get('modules', [])
            if not isinstance(modules, list) or len(modules) > 10:
                raise ValueError('At most 10 modules')
            for module in modules:
                if not isinstance(module, dict) or set(module) - MODULE_FIELDS:
                    raise ValueError('Unsupported module fields')
                text(module['id'])
                decimal_value(module['credits'])
                text(module.get('intended_allocation', ''), 40)
                if module.get('status', 'proposed') not in {'proposed', 'registered', 'in_progress', 'completed'}:
                    raise ValueError('Invalid module status')
                for key in ('quad_id', 'approval_ref', 'registration_id'):
                    if module.get(key) is not None:
                        text(module[key])
                if module.get('grade') is not None:
                    text(module['grade'], 4)
        result['internship'] = deepcopy(internship)
    if 'award_ids' in payload:
        awards = payload['award_ids']
        if not isinstance(awards, list) or set(awards) - {'cse_honours', 'ai_minor'} or len(set(awards)) != len(awards):
            raise ValueError('Unsupported award')
        result['award_ids'] = list(awards)
    return result
