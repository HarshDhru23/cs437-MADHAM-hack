"""Course catalogue from the reviewed curriculum rules and the official timetable snapshots (D-29).

There is no separate catalogue document: a course is *matched* when an approved rule places its code in a requirement
(D-05 to D-08, D-19, D-20; identity groups first, D-01 to D-04). Titles, credits and offered terms come from the
committed official timetables only; a course missing from them is simply absent here, never marked unavailable.
"""
from decimal import Decimal
from coursepath.identity import canonical_code, identity_map
from coursepath.rules.allocation import eligible, matches
from coursepath.rules.schema import walk_requirements
from coursepath.serialization import decimal_value


def _leaves(curriculum):
    return [r for r in walk_requirements(curriculum['requirements']) if not r.get('children')]


def classify_code(curriculum, code, credits):
    """Leaf requirements (in curriculum order) that an approved rule lets this course fill.

    A course that matches a mandatory requirement is listed for that slot only: it can never usefully count twice (D-05, D-06).
    A course on the excluded list (SC 372, D-08) fills nothing."""
    identity = identity_map(curriculum.get('identity_groups'))
    canonical = canonical_code(code, identity)
    if canonical in {canonical_code(e['course_id'], identity) for e in curriculum.get('excluded_courses', [])}:
        return []
    amount = decimal_value(credits)
    fits = [leaf for leaf in _leaves(curriculum) if eligible(leaf, canonical, amount, identity)]
    if amount == 0:  # zero-credit records fill only obligations such as the viva records (D-16)
        fits += [o for o in curriculum.get('noncredit_obligations', [])
                 if canonical not in (o.get('exclude_course_ids') or []) and matches(o, canonical, identity)]
    mandatory = [leaf for leaf in fits if leaf.get('type') == 'mandatory_course']
    return mandatory or fits


def _summary(expression):
    if expression is None:
        return 'No recommendation recorded'
    if expression['type'] == 'course':
        return expression['course_id']
    joiner = ' and ' if expression['type'] == 'and' else ' or '
    parts = [_summary(child) for child in expression['children']]
    return joiner.join(f'({p})' if ' ' in p and len(parts) > 1 else p for p in parts)


def build_catalogue(curriculum, snapshots, recommended=None):
    recommended = recommended or {}
    found = {}
    for snapshot in sorted(snapshots, key=lambda s: s['term_id']):
        if snapshot.get('review_status') != 'reviewed':
            continue
        for offering in snapshot.get('offerings', []):
            entry = found.setdefault(offering['code'], {'title': offering.get('title'), 'credits': offering.get('credits'), 'terms': []})
            if snapshot['term_id'] not in entry['terms']:
                entry['terms'].append(snapshot['term_id'])
    courses = []
    for code in sorted(found):
        entry = found[code]
        if entry['credits'] is None:
            continue
        fits = classify_code(curriculum, code, entry['credits'])
        prerequisite = recommended.get(canonical_code(code, identity_map(curriculum.get('identity_groups'))))
        courses.append({
            'id': f"{curriculum['version']}:{code}", 'normalized_code': code, 'title': entry['title'], 'credits': str(Decimal(str(entry['credits'])).normalize()),
            'department': code.split(' ', 1)[0], 'baskets': [leaf['id'] for leaf in fits], 'could_satisfy': [leaf['label'] for leaf in fits],
            'prerequisite_summary': _summary(prerequisite['prerequisites']) if prerequisite and prerequisite.get('prerequisite_known') else _summary(None),
            'offering_status': 'confirmed_in_snapshot', 'offered_terms': entry['terms']})
    return {'courses': courses, 'coverage': 'partial', 'review_status': 'reviewed', 'rule_version': curriculum['version'],
            'terms': sorted({t for e in found.values() for t in e['terms']})}
