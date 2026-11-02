from copy import deepcopy
import json
from pathlib import Path
from decimal import Decimal
from coursepath.serialization import decimal_value
from coursepath.rules.sources import validate_sources
from coursepath.rules.schema import TYPES, walk_requirements
from coursepath.identity import identity_map


def validate_curriculum(curriculum):
    if curriculum.get('cohort') != 'BTECH_CSE-2024' or curriculum.get('review_status') not in {'draft', 'reviewed', 'conflicted'}:
        raise ValueError('Unsupported cohort/review state')
    if not curriculum.get('version') or not curriculum.get('requirements'):
        raise ValueError('Missing curriculum version/requirements')
    source_ids = validate_sources(curriculum.get('sources', []), curriculum['cohort'], curriculum['review_status'] == 'reviewed')
    ids = set()
    total = decimal_value(curriculum['total_credits'])
    for rule in walk_requirements(curriculum['requirements']):
        if not rule.get('id') or rule['id'] in ids or rule.get('type') not in TYPES:
            raise ValueError('Duplicate/unsupported rule')
        ids.add(rule['id'])
        if not rule.get('source_refs') or set(rule['source_refs']) - source_ids:
            raise ValueError('Missing/invalid rule sources')
        minimum = decimal_value(rule.get('minimum_credits', '0'))
        if minimum > total:
            raise ValueError('Impossible basket minimum')
        if rule.get('course_ids') is not None and (not isinstance(rule['course_ids'], list) or len(set(rule['course_ids'])) != len(rule['course_ids'])):
            raise ValueError('Invalid approved course set')
        if rule['type'] == 'mandatory_course' and not rule.get('course_id'):
            raise ValueError('Mandatory course missing identity')
        if rule['type'] in {'all_of', 'any_of'} and not rule.get('children'):
            raise ValueError('Empty requirement expression')
        if rule.get('children') and rule['type'] == 'all_of':
            child_total = sum((decimal_value(c.get('minimum_credits', '0')) for c in rule['children']), Decimal(0))
            if child_total != minimum:
                raise ValueError('Parent rollup does not reconcile')
        if rule['type'] == 'choose_courses' and (type(rule.get('minimum_courses')) is not int or rule['minimum_courses'] < 1 or rule.get('course_ids') is not None and rule['minimum_courses'] > len(rule['course_ids'])):
            raise ValueError('Impossible course count')
    if sum((decimal_value(r.get('minimum_credits', '0')) for r in curriculum['requirements']), Decimal(0)) != total:
        raise ValueError('Degree component total does not reconcile')
    for cap in curriculum.get('caps', []):
        if not cap.get('id') or cap['id'] in ids or not cap.get('source_refs') or set(cap['source_refs']) - source_ids:
            raise ValueError('Invalid cap identity/source')
        ids.add(cap['id'])
        decimal_value(cap['maximum_credits'])
    for group in curriculum.get('identity_groups', []) + curriculum.get('identity_review_pairs', []):
        if not group.get('decision') or not group.get('source_refs') or set(group['source_refs']) - source_ids:
            raise ValueError('Identity decisions need a decision ID and valid sources')
    for group in curriculum.get('identity_groups', []):
        if not group.get('current') or not isinstance(group.get('same'), list) or not group['same']:
            raise ValueError('An identity group names its current code and the codes that are the same course')
    identity_map(curriculum.get('identity_groups'))
    return deepcopy(curriculum)


def load_curriculum(path=None):
    path = path or Path(__file__).resolve().parents[2] / 'data/curricula/cse-2024.json'
    return validate_curriculum(json.loads(Path(path).read_text()))
