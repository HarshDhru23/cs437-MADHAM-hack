"""D-35 plan generation (CP-35): a deterministic draft plan for the remaining degree. Pure domain code; no Django, no network.

What it does
------------
It repeatedly asks the real allocator (`rules.allocation.allocate`, the same code as the degree audit) which requirements are
still open for the record plus the courses already planned, and fills the most constrained open requirement with one offered
course until nothing more can be placed. Because every step is judged by the allocator, the plan is consistent with the audit:
a course is kept only if it moved a requirement forward.

Order of work (most constrained first, so a flexible elective cannot spend the only course a narrow basket can use):
  1. mandatory courses, ordered so a recommended preparation course (D-17) is planned before its dependent;
  2. Physical Education (non-credit, one per term);
  3. every other requirement, fewest candidate courses first, then narrowest membership rule.

Where a course goes: the earliest term that offers it (an official snapshot, or the same-semester pattern of D-23, which is a
hint and is labelled `expected_pattern`), keeps the term within its target and then its maximum load, has no certain timetable
clash, and does not put a recommended preparation course after its dependent. A term whose complete official snapshot lacks a
course never gets it.

What it never does: invent a course, count a placeholder as progress, schedule a project or external-exposure module (the student
arranges those: a placeholder holds the credits), suggest a one-credit short course (an excluded course, D-08, or under two credits
for an elective: a planner preference, not an academic rule), or choose a lab or tutorial slot. Electives are suggestions picked by
a fixed rule (surplus credits, then the number of other open requirements the course could fill, then lower course level, then
code); the student edits the plan afterwards.
"""
from decimal import ROUND_CEILING, Decimal
import re
from coursepath.eligibility import evaluate_prerequisite
from coursepath.identity import canonical_code, identity_map
from coursepath.imports.normalization import CODE
from coursepath.issues import issue
from coursepath.models import term_key, validate_term_id
from coursepath.online_credits import ONLINE_POOL as _ONLINE_POOL
from coursepath.offerings import matching_offerings, offering_availability, pattern_snapshot, snapshot_for_term
from coursepath.rules.allocation import allocate, eligible, pass_fail_conversions
from coursepath.rules.loader import validate_curriculum
from coursepath.rules.schema import walk_requirements
from coursepath.semester_plan import validate_plan
from coursepath.serialization import decimal_string, decimal_value
from coursepath.timetable import check_meetings

SEMESTERS = 8                       # regular semesters in the degree (ADV13); the default horizon is what remains
DEFAULT_TARGET, DEFAULT_MAX = Decimal(28), Decimal(28)   # a semester never holds more than 28 credits (D-36); plans are packed to it so they end as early as possible
HARD_CAP = Decimal(28)
HARD_EXPOSURE = Decimal(16)
ELECTIVE_NAMES = {'hss-other': 'HSS elective', 'bs-elective': 'Basic Science elective', 'cse-general': 'CSE elective', 'open-electives': 'Open elective'}
INTERNSHIP_LABEL = 'Internship module (IN 498)'
ONLINE_LABEL = 'Online course'
PROJECT_LABEL = 'Open project (arrange it with a supervisor)'
ONLINE_POOL = _ONLINE_POOL   # D-11, D-13: at most 16 online credits count, to discipline electives (at most 8) and then open electives; the allocator enforces the caps
ONLINE_ORDER = ('cse-general', 'open-electives')   # D-13: online credits go to discipline electives first, then open electives; never HSS
ONLINE_CODE = {'cse-general': 'CS {}', 'open-electives': 'ZZ {}'}   # 900 + n stands in for an online course the student chooses (distinct codes, so none is a repeat); never shown
MIN_PLACEHOLDER = Decimal(2)                         # a held elective chunk is at least 2 credits unless it is all that is left
MODULE_CREDITS = Decimal(4)                 # external-exposure (IN 498) credit comes in 4-credit modules, 16 at most (D-14)
MIN_ELECTIVE_CREDITS = Decimal(2)   # planner preferences, stated in the assumptions: no short courses and no preparatory
MIN_ELECTIVE_LEVEL = 100            # courses (numbered below 100, such as "HS 001 Preparatory Course in English") as suggestions
LOOK_AT = 8                         # feasible candidates compared for timetable clashes per placement
OPTION_KEYS = {'terms', 'target_credits_per_term', 'max_credits_per_term', 'skip_terms', 'internship_term', 'lighten_with_online'}
NOTICE = ('This is a draft. Required courses are placed because the requirements demand them; electives are suggestions chosen by a '
          'fixed rule, not by your preference. Nothing is saved until you save the plan.')


def human_term(term):
    """'2027-28-I' -> '2027–28 Semester I', '2026-27-SUMMER' -> '2026–27 Summer' (the wording the student sees)."""
    year, short, part = term.split('-')
    return f"{year}–{short} {'Summer' if part == 'SUMMER' else 'Semester ' + part}"


def regular_term(year, part):
    return f'{year}-{(year + 1) % 100:02d}-{part}'


def next_regular_term(term):
    year, part = term_key(term)
    return regular_term(year, 'II') if part == 0 else regular_term(year + 1, 'I')


def _term_list(value, name):
    if not isinstance(value, list) or len(value) > 40:
        raise ValueError(f'{name} must be a list of term IDs')
    terms = [validate_term_id(t) if isinstance(t, str) else (_ for _ in ()).throw(ValueError(f'{name} must be a list of term IDs')) for t in value]
    if len(set(terms)) != len(terms):
        raise ValueError(f'{name} repeats a term')
    return terms


def _credit_option(value, name):
    amount = decimal_value(value)
    if amount <= 0 or amount > HARD_CAP:
        raise ValueError(f'{name} must be above 0 and at most {HARD_CAP}')
    return amount


def term_cap(term, standing=None, advisor_cap=None):
    """The most credits a term can hold: 28 for a regular semester, always (D-36); 10 for a summer term. Standing and advisor limits are not modelled."""
    return Decimal(10 if term.endswith('SUMMER') else 28)


def resolve_options(context, options, rows, snapshots):
    if not isinstance(options, dict) or set(options) - OPTION_KEYS:
        raise ValueError('Unsupported plan generation options')
    standing, advisor = context.get('standing', 'unknown'), None
    skip = _term_list(options.get('skip_terms', []), 'skip_terms')
    regular_cap = min(term_cap(regular_term(2000, 'I'), standing, advisor), HARD_CAP)
    maximum = _credit_option(options['max_credits_per_term'], 'max_credits_per_term') if 'max_credits_per_term' in options else min(DEFAULT_MAX, regular_cap)
    target = _credit_option(options['target_credits_per_term'], 'target_credits_per_term') if 'target_credits_per_term' in options else min(DEFAULT_TARGET, maximum)
    if target > maximum:
        raise ValueError('target_credits_per_term cannot exceed max_credits_per_term')
    if 'terms' in options:
        terms = [t for t in _term_list(options['terms'], 'terms') if t not in skip]
        if [term_key(t) for t in terms] != sorted(term_key(t) for t in terms):
            raise ValueError('terms must be in chronological order')
    else:
        seen = sorted({term_key(r['term_id']) for r in rows if r.get('term_id')})
        done = len({k for k in seen if k[1] != 2})
        if seen:
            year, part = seen[-1]
            current = regular_term(year, 'I' if part == 0 else 'II') if part < 2 else regular_term(year, 'II')
            start = next_regular_term(current)
        else:
            starts = sorted(s['term_id'] for s in snapshots if s.get('term_id') and not s['term_id'].endswith('SUMMER'))
            if not starts:
                raise ValueError('There is no term to plan from; pass options.terms')
            start = starts[0]
        wanted, terms, cursor = max(SEMESTERS - done, 2), [], start
        for _ in range(60):
            if len(terms) == wanted:
                break
            if cursor not in skip:
                terms.append(cursor)
            cursor = next_regular_term(cursor)
    internship = options.get('internship_term')
    if internship is not None:
        internship = validate_term_id(internship) if isinstance(internship, str) else (_ for _ in ()).throw(ValueError('internship_term must be a term ID'))
        if internship not in terms:
            raise ValueError('internship_term must be one of the planned terms')
    return {'terms': terms, 'target': target, 'maximum': maximum, 'skip_terms': skip, 'standing': standing, 'advisor_cap': advisor, 'internship': internship}


def _flatten(tree):
    found = {}

    def walk(nodes):
        for node in nodes:
            found[node['id']] = node
            walk(node.get('children', []))
    walk(tree)
    return found


def _prerequisite_codes(expression):
    if not expression:
        return set()
    if expression['type'] == 'course':
        return {expression['course_id']}
    return set().union(*[_prerequisite_codes(c) for c in expression['children']])


def _level(code):
    match = re.search(r'(\d+)', code)
    return int(match[1]) if match else 0


def _generate(context, options=None, force_online=False, end_term=None, busiest_before=None):
    curriculum = validate_curriculum(context['curriculum'])
    attempts = [dict(a) for a in context.get('attempts', [])]
    enrolment = [dict(r) for r in context.get('current_enrolment', []) if r.get('confirmed')]
    catalogue = context.get('catalogue') or {}
    snapshots = [s for s in (context.get('offering_snapshots') or []) if isinstance(s, dict)]
    identity = identity_map(curriculum.get('identity_groups'))
    current_rows = [{'id': r['id'], 'normalized_code': r['normalized_code'], 'credits': r['credits'], 'term_id': r['term_id'], 'completion_status': 'completed',
                     'learning_designation': 'degree', 'current': True} for r in enrolment]
    base_rows = attempts + current_rows
    opts = resolve_options(context, options or {}, base_rows, snapshots)
    terms, standing, internship = opts['terms'], opts['standing'], opts['internship']
    usual_terms = opts['terms']   # the usual horizon; a lightened plan keeps the end of the plan it lightens (end_term)
    if end_term:
        terms = [t for t in terms if term_key(t) <= term_key(end_term)]
    plan_terms = [t for t in terms if t != internship]   # courses go only in these; the internship term holds internship and online credits
    # The breaks (summers) between the semesters can hold online courses (at most 10 credits each): those before the last semester can shorten the plan.
    horizon_end = end_term or (terms[-1] if terms else None)
    summer_terms = []
    for t in terms:
        year, _, part = t.split('-')
        summer = f'{year}-{(int(year) + 1) % 100:02d}-SUMMER'
        if part == 'II' and horizon_end and summer not in terms and (term_key(summer) < term_key(horizon_end) or (end_term and term_key(summer) == term_key(horizon_end))):
            summer_terms.append(summer)
    all_terms = sorted(set(terms) | set(summer_terms), key=term_key)
    limits = {t: (min(opts['target'], min(opts['maximum'], term_cap(t, standing, opts['advisor_cap']))), min(opts['maximum'], term_cap(t, standing, opts['advisor_cap'])))
              for t in all_terms}

    leaves = [r for r in walk_requirements(curriculum['requirements']) if not r.get('children')]
    leaf_by_id = {r['id']: r for r in leaves}
    labels = {r['id']: r.get('label', r['id']) for r in walk_requirements(curriculum['requirements'])}
    ancestors = {}

    def mark(nodes, anys):
        for node in nodes:
            if node.get('children'):
                mark(node['children'], anys + ([node['id']] if node['type'] == 'any_of' else []))
            else:
                ancestors[node['id']] = anys
    mark(curriculum['requirements'], [])

    arranged_tags = [t for name, t in curriculum.get('course_tags', {}).items() if name in {'project', 'exposure'}]
    arranged_patterns = [re.compile(p) for t in arranged_tags for p in t.get('course_patterns', [])]
    arranged_ids = {c for t in arranged_tags for c in t.get('course_ids', [])}
    excluded = {canonical_code(e['course_id'], identity) for e in curriculum.get('excluded_courses', [])}

    def arranged(code):
        return code in arranged_ids or any(p.search(code) for p in arranged_patterns)

    def student_choice(leaf):
        """True when only work the student arranges (a project or an external-exposure module) can fill the requirement."""
        if leaf.get('any_course') or leaf.get('course_prefixes'):
            return False
        patterns = set(leaf.get('course_patterns') or [])
        ids = set(leaf.get('course_ids') or [])
        arranged_patterns_all = {p for t in arranged_tags for p in t.get('course_patterns', [])}
        return bool(patterns or ids) and patterns <= arranged_patterns_all and ids <= arranged_ids

    # ---- what is offered where
    offered = {}
    for term in terms:
        snapshot = snapshot_for_term(snapshots, term) or pattern_snapshot(snapshots, term)
        for offering in (snapshot or {}).get('offerings', []):
            if offering.get('credits') is not None and re.fullmatch(CODE, offering['code']):
                offered.setdefault(offering['code'], {}).setdefault(term, offering)
    cache = {}

    def availability(code, term):
        if (code, term) not in cache:
            found = offering_availability(snapshots, term, code)
            basis = {'confirmed_in_snapshot': 'confirmed_offering', 'historical': 'expected_pattern'}.get(found['status'])
            cache[(code, term)] = (basis, found)
        return cache[(code, term)]

    def credits_in(code, term):
        offering = offered.get(code, {}).get(term)
        return decimal_value(offering['credits']) if offering else None

    # ---- the plan under construction
    attempted = {canonical_code(a['normalized_code'], identity) for a in attempts}
    taken = {canonical_code(a['normalized_code'], identity) for a in attempts if a.get('completion_status') == 'completed'}
    taken |= {canonical_code(r['normalized_code'], identity) for r in current_rows}
    planned, load, holders = [], {t: Decimal(0) for t in all_terms}, []
    picked_for, notes = {}, {}

    def planned_row(item):
        return {'id': item['id'], 'normalized_code': item['code'], 'credits': decimal_string(item['credits']), 'term_id': item['term'],
                'completion_status': 'completed', 'learning_designation': 'degree', 'planned': True}

    def run(rows):
        return allocate(curriculum, {}, rows, node_budget=20000, time_budget_seconds=5)

    def rows_now(extra=None):
        return base_rows + [planned_row(p) for p in planned] + ([planned_row(extra)] if extra else [])

    result = run(rows_now())
    tree = _flatten(result['requirements'])
    remaining_before = sum((decimal_value(r['remaining_credits']) for r in result['requirements']), Decimal(0))

    reserved = {}   # credits per requirement that internship modules are proposed to cover (placeholders, not allocator rows)

    def is_flex(leaf):
        """An open-ended elective (HSS, Basic Science, CSE or open electives): any counting course will do, so the plan holds credits instead of a course."""
        return leaf['type'] == 'minimum_credits' and bool(leaf.get('any_course') or leaf.get('course_prefixes')) and not student_choice(leaf)

    def need(leaf):
        node = tree[leaf['id']]
        minimum = leaf.get('minimum_courses', 1 if leaf['type'] in {'mandatory_course', 'noncredit'} else 0)
        return max(Decimal(0), decimal_value(node['remaining_credits']) - reserved.get(leaf['id'], Decimal(0))), max(0, minimum - node['counted_courses'])

    def leaf_open(leaf, with_flex=False):
        node = tree[leaf['id']]
        if node['status'] == 'satisfied' or any(tree[a]['status'] == 'satisfied' for a in ancestors[leaf['id']]):
            return False
        if is_flex(leaf) and not with_flex:
            return False
        credits_left, courses_left = need(leaf)
        return credits_left > 0 or courses_left > 0

    def open_leaves():
        return [leaf for leaf in leaves if leaf_open(leaf)]

    def progress(nodes):
        total = Decimal(0)
        for leaf in leaves:
            node = nodes[leaf['id']]
            minimum = leaf.get('minimum_courses', 1 if leaf['type'] in {'mandatory_course', 'noncredit'} else 0)
            total += min(decimal_value(node['counted_credits']), decimal_value(node['required_credits'])) + min(node['counted_courses'], minimum)
        return total

    def prerequisite_status(code, term, extra):
        entry = catalogue.get(canonical_code(code, identity))
        expression = entry.get('prerequisites') if entry and entry.get('prerequisite_known') else None
        rows = [{**r, 'term_id': r.get('term_id')} for r in base_rows]
        return evaluate_prerequisite(expression, term, rows, [{'id': p['id'], 'normalized_code': p['code'], 'term_id': p['term']} for p in planned] + extra, identity)['status']

    def pool(leaf, open_all):
        found = []
        mandatory = leaf['type'] == 'mandatory_course'
        for code in sorted(offered):
            canon = canonical_code(code, identity)
            if canon in taken or canon in excluded or arranged(canon) or (not mandatory and canon in attempted):
                continue
            if any(p['code'] == code or canonical_code(p['code'], identity) == canon for p in planned):
                continue
            credits = min(decimal_value(o['credits']) for o in offered[code].values())
            if mandatory and (canon != canonical_code(leaf['course_id'], identity) or max(decimal_value(o['credits']) for o in offered[code].values()) < decimal_value(leaf.get('minimum_credits', '0'))):
                continue
            if not mandatory and leaf['type'] != 'noncredit' and (credits < MIN_ELECTIVE_CREDITS or _level(canon) < MIN_ELECTIVE_LEVEL):
                continue
            if eligible(leaf, canon, credits, identity):
                found.append(code)
        return found

    def other_leaves(code, leaf, open_all):
        canon, credits = canonical_code(code, identity), min(decimal_value(o['credits']) for o in offered[code].values())
        return sum(1 for other in open_all if other['id'] != leaf['id'] and eligible(other, canon, credits, identity))

    def items_in(term):
        return [{'id': p['id'], 'normalized_code': p['code']} for p in planned if p['term'] == term]

    def feasible(code, leaf, limit_index, ignore_prerequisites):
        """The earliest (term, credits, basis, possible clashes) that works for this course, or None."""
        for term in plan_terms:
            basis, found = availability(code, term)
            credits = credits_in(code, term)
            if basis is None or credits is None or load[term] + credits > limits[term][limit_index]:
                continue
            if leaf['type'] == 'mandatory_course' and credits < decimal_value(leaf.get('minimum_credits', '0')):
                continue
            if leaf['type'] == 'noncredit' and any(eligible(leaf, canonical_code(p['code'], identity), p['credits'], identity) for p in planned if p['term'] == term):
                continue
            item = {'id': f"gen-{term}-{code.replace(' ', '')}", 'code': code, 'term': term, 'credits': credits}
            if not ignore_prerequisites and prerequisite_status(code, term, []) == 'ineligible':
                continue
            snapshot = snapshot_for_term(snapshots, term)
            possible = 0
            if snapshot is not None:
                checked = check_meetings(items_in(term) + [{'id': item['id'], 'normalized_code': code}], snapshot)
                mine = [c for c in checked['conflicts'] if item['id'] in c['item_ids']]
                if any(c['certain'] for c in mine):
                    continue
                possible = len(mine)
            return {'item': item, 'basis': basis, 'offering_ids': list(found['offering_ids']) if basis == 'confirmed_offering' else [], 'possible': possible}
        return None

    def depth(leaf, pending, seen=()):
        code = canonical_code(leaf['course_id'], identity)
        refs = {canonical_code(c, identity) for c in _prerequisite_codes((catalogue.get(code) or {}).get('prerequisites'))}
        deeper = [depth(pending[c], pending, seen + (code,)) for c in sorted(refs) if c in pending and c not in seen]
        return 1 + max(deeper) if deeper else 0

    def eff_remaining(leaf):
        return need(leaf)[0]

    def exposure_split():
        """Internship credits (IN 498, 4-credit modules, at most 16; D-14, D-37): each module goes to the narrowest requirement that still needs a
        full module, so the flexible requirements (open electives) keep the most room for the student's own choices."""
        found = []
        if not internship:
            return found
        total_cap = HARD_EXPOSURE
        leaf_caps = {}
        for cap in curriculum.get('caps', []):
            if 'exposure' in cap.get('tags_any', []):
                if cap.get('requirement_ids'):
                    for rid in cap['requirement_ids']:
                        leaf_caps[rid] = min(leaf_caps.get(rid, Decimal(10 ** 6)), decimal_value(cap['maximum_credits']))
                else:
                    total_cap = min(total_cap, decimal_value(cap['maximum_credits']))
        options_ = sorted([l for l in leaves if eligible(l, 'IN 498', MODULE_CREDITS, identity) and l['id'] in tree],
                          key=lambda l: (bool(l.get('any_course')), bool(l.get('course_prefixes')), l['id']))
        left = {l['id']: decimal_value(tree[l['id']]['remaining_credits']) for l in options_
                if tree[l['id']]['status'] != 'satisfied' and not any(tree[a]['status'] == 'satisfied' for a in ancestors[l['id']])}
        taken_here = {}
        while sum(taken_here.values(), Decimal(0)) + MODULE_CREDITS <= total_cap and load[internship] + MODULE_CREDITS <= limits[internship][1]:
            pick = next((l for l in options_ if left.get(l['id'], Decimal(0)) >= MODULE_CREDITS
                         and taken_here.get(l['id'], Decimal(0)) + MODULE_CREDITS <= leaf_caps.get(l['id'], Decimal(10 ** 6))), None)
            if pick is None:
                break
            left[pick['id']] -= MODULE_CREDITS
            taken_here[pick['id']] = taken_here.get(pick['id'], Decimal(0)) + MODULE_CREDITS
            found.append({'id': f'gen-internship-{len(found) + 1}', 'requirement_id': pick['id'], 'term': internship, 'credits': MODULE_CREDITS})
            load[internship] += MODULE_CREDITS
        return found

    modules = exposure_split()
    for module in modules:
        reserved[module['requirement_id']] = reserved.get(module['requirement_id'], Decimal(0)) + module['credits']

    blocked, rejected = {}, {}
    for _ in range(600):
        candidates = [l for l in open_leaves() if l['id'] not in blocked]
        if not candidates:
            break
        pending = {canonical_code(l['course_id'], identity): l for l in candidates if l['type'] == 'mandatory_course'}
        sizes = {l['id']: [c for c in pool(l, candidates) if c not in rejected.get(l['id'], set())] for l in candidates}

        def order(leaf):
            group = 0 if leaf['type'] == 'mandatory_course' else 1 if leaf['type'] == 'noncredit' else 2
            first = depth(leaf, pending) if group == 0 else 0
            breadth = 10000 * bool(leaf.get('course_prefixes') or leaf.get('course_patterns')) + len(leaf.get('course_ids') or []) + (100000 if leaf.get('any_course') else 0)
            return (group, first, len(sizes[leaf['id']]), breadth, leaf['id'])
        leaf = min(candidates, key=order)
        remaining_credits, remaining_courses = need(leaf)
        ranked = sorted(sizes[leaf['id']], key=lambda c: (max(Decimal(0), min(decimal_value(o['credits']) for o in offered[c].values()) - remaining_credits)
                                                           if leaf['type'] != 'mandatory_course' else Decimal(0), other_leaves(c, leaf, candidates), _level(c), c))
        accepted = None
        passes = ((0, False), (1, False)) + (((1, True),) if leaf['type'] == 'mandatory_course' else ())
        for limit_index, ignore in passes:
            options_found = []
            for code in ranked:
                if code in rejected.get(leaf['id'], set()):
                    continue
                found = feasible(code, leaf, limit_index, ignore)
                if found:
                    options_found.append((found['possible'], len(options_found), code, found))
                    if len(options_found) >= LOOK_AT:
                        break
            if options_found:
                # the earliest semester first (so the plan ends as early as it can), then the fewest possible clashes, then the ranking above
                _, _, _, code, found = min(((plan_terms.index(o[3]['item']['term']),) + o for o in options_found), key=lambda o: (o[0], o[1], o[2]))
                trial = run(rows_now(found['item']))
                nodes = _flatten(trial['requirements'])
                if progress(nodes) > progress(tree):
                    accepted = (code, found, trial, nodes)
                    break
                rejected.setdefault(leaf['id'], set()).add(code)
                accepted = False
                break
        if accepted is False:
            continue
        if accepted is None:
            reason = 'NO_OFFERED_COURSE' if not ranked else 'NO_CAPACITY'
            blocked[leaf['id']] = reason
            continue
        code, found, result, tree = accepted
        item = found['item']
        planned.append({**item, 'basis': found['basis'], 'offering_ids': found['offering_ids'], 'leaf': leaf['id']})
        load[item['term']] += item['credits']
        picked_for[item['id']] = leaf['id']

    # ---- the allocation after the courses, and the internship modules the courses left no room for
    base_final = run(rows_now())
    base_tree = _flatten(base_final['requirements'])
    tree = base_tree
    for leaf_id in sorted({m['requirement_id'] for m in modules}):
        mine = [m for m in modules if m['requirement_id'] == leaf_id]
        needed = decimal_value(tree[leaf_id]['remaining_credits'])   # modules are placeholders, not allocator rows: this is what is still open
        for index, module in reversed(list(enumerate(mine))):
            if needed <= MODULE_CREDITS * index:   # this module would add nothing: a course already filled the requirement
                modules.remove(module)
                load[module['term']] -= module['credits']
                reserved[leaf_id] -= module['credits']

    flex_order = list(ELECTIVE_NAMES)   # narrowest first: HSS, Basic Science, CSE, then open electives (any course)
    flex_leaves = sorted([l for l in leaves if is_flex(l)], key=lambda l: (bool(l.get('any_course')), flex_order.index(l['id']) if l['id'] in flex_order else len(flex_order), l['id']))
    flex_terms = [t for t in terms if t != internship]   # elective credits are held in regular semesters; the internship semester and summers take online credits
    online_terms = [t for t in all_terms if t.endswith('SUMMER') or t == internship]
    base_load = dict(load)
    module_ids = {}
    for module in modules:
        module_ids.setdefault(module['requirement_id'], []).append(module['id'])

    def finish(budget):
        """The rest of the plan for an online-credit budget: online courses in the breaks (summers) and the internship semester, then the
        elective credits held in the earliest regular semesters with room, what is left unmet, and the output."""
        load_f = dict(base_load)
        online_rows, online_by_leaf = [], {}
        pool_left = budget

        def online_row(item):
            return {**planned_row(item), 'online': True}
        # Each online course goes to one requirement (discipline electives first, then open electives) and never above what that requirement
        # still needs; the allocator confirms the caps (8 credits shared with projects, a pool of 16 less pass/fail conversions) let it count in full.
        for term in online_terms:
            while pool_left >= 2:
                room = limits[term][1] - load_f[term]
                accepted_row = None
                for leaf in [l for l in leaves if l['id'] in ONLINE_ORDER]:
                    still_needed = need(leaf)[0] - online_by_leaf.get(leaf['id'], Decimal(0))
                    for size in dict.fromkeys([min(MODULE_CREDITS, room, pool_left, still_needed), Decimal(3), Decimal(2)]):
                        if size < 2 or size > room or size > pool_left or size > still_needed:
                            continue
                        number = len(online_rows) + 1
                        row = {'id': f'gen-online-{number}', 'code': ONLINE_CODE[leaf['id']].format(900 + number), 'term': term, 'credits': size, 'leaf': leaf['id']}
                        trial = run(rows_now() + [online_row(r) for r in online_rows] + [online_row(row)])
                        placed = {a['attempt_id']: a['requirement_id'] for a in trial['ledger']}
                        if all(placed.get(r['id']) == r['leaf'] for r in online_rows + [row]):   # counted in the requirement it is held for, not moved past a cap
                            accepted_row = row
                            break
                    if accepted_row:
                        break
                if accepted_row is None:
                    break
                online_rows.append(accepted_row)
                online_by_leaf[accepted_row['leaf']] = online_by_leaf.get(accepted_row['leaf'], Decimal(0)) + accepted_row['credits']
                load_f[term] += accepted_row['credits']
                pool_left -= accepted_row['credits']
        final = base_final
        try:
            flex_taken, flex_holders = dict(online_by_leaf), []
            for limit_index in (0, 1):
                for term in flex_terms:
                    for leaf in flex_leaves:
                        left = need(leaf)[0] - flex_taken.get(leaf['id'], Decimal(0))
                        if left <= 0 or not leaf_open(leaf, with_flex=True):
                            continue
                        take = min(left, limits[term][limit_index] - load_f[term])
                        if take <= 0 or (take < MIN_PLACEHOLDER and take < left):
                            continue
                        existing = next((h for h in flex_holders if h['term'] == term and h['requirement_id'] == leaf['id']), None)
                        if existing:
                            existing['desired_credits'] = decimal_string(decimal_value(existing['desired_credits']) + take)
                        else:
                            flex_holders.append({'id': f"gen-flex-{term}-{leaf['id']}", 'requirement_id': leaf['id'], 'desired_credits': decimal_string(take), 'term': term,
                                                 'label': ELECTIVE_NAMES.get(leaf['id'], labels[leaf['id']])})
                        flex_taken[leaf['id']] = flex_taken.get(leaf['id'], Decimal(0)) + take
                        load_f[term] += take
            ledger = {a['attempt_id']: a['requirement_id'] for a in final['ledger']}
            online_holders = {}
            for row in online_rows:
                key = (row['term'], row['leaf'])
                online_holders[key] = online_holders.get(key, Decimal(0)) + row['credits']
            for (term, requirement), credits in sorted(online_holders.items()):
                flex_holders.append({'id': f'gen-online-{term}-{requirement}', 'requirement_id': requirement, 'desired_credits': decimal_string(credits), 'term': term, 'label': ONLINE_LABEL, 'online': True})
            flex_ids = {}
            for holder in flex_holders:
                flex_ids.setdefault(holder['requirement_id'], []).append(holder['id'])

            # ---- what is left: placeholders for arranged work, reasons for everything else
            unmet, placeholder_rows = [], list(flex_holders)
            for leaf in leaves:
                node = tree[leaf['id']]
                if node['status'] == 'satisfied' or any(tree[a]['status'] == 'satisfied' for a in ancestors[leaf['id']]):
                    continue
                credits_left, courses_left = need(leaf)
                covered_by = module_ids.get(leaf['id'], []) + flex_ids.get(leaf['id'], [])
                uncovered = credits_left - flex_taken.get(leaf['id'], Decimal(0))
                if credits_left <= 0 and courses_left <= 0 and not covered_by:
                    continue
                reason = blocked.get(leaf['id'], 'ALLOCATION_UNRESOLVED')
                entry = {'requirement_id': leaf['id'], 'label': labels[leaf['id']], 'remaining_credits': decimal_string(max(Decimal(0), uncovered)), 'remaining_courses': courses_left,
                         'reason_code': reason, 'reason': '', 'placeholder_ids': list(covered_by)}
                if is_flex(leaf):
                    if uncovered > 0:
                        entry.update(reason_code='NO_CAPACITY', reason=f'There is no room left in the planned semesters for {uncovered} more credits of {labels[leaf["id"]]}.')
                    else:
                        entry.update(reason_code='STUDENT_CHOICE', reason=f'Choose any course that counts toward {labels[leaf["id"]]}; the credits are held in your plan.')
                elif student_choice(leaf):
                    if uncovered > 0:
                        # the earliest term that fits within its target, then within its maximum: packed so the plan ends as early as it can (D-40)
                        room = [t for limit_index in (0, 1) for t in plan_terms if load_f[t] + uncovered <= limits[t][limit_index]]
                        if room:
                            term = room[0]
                            holder = {'id': f'gen-placeholder-{term}-{leaf["id"]}', 'requirement_id': leaf['id'], 'desired_credits': decimal_string(uncovered), 'term': term,
                                      'label': PROJECT_LABEL}
                            placeholder_rows.append(holder)
                            load_f[term] += uncovered
                            entry.update(reason_code='STUDENT_CHOICE', placeholder_ids=covered_by + [holder['id']],
                                         reason=f'{labels[leaf["id"]]} comes from work you arrange; a placeholder holds the credits in {term}.')
                        else:
                            entry.update(reason_code='NO_CAPACITY', reason=f'{labels[leaf["id"]]} comes from work you arrange; no term has room for its credits.')
                    else:
                        entry.update(reason_code='STUDENT_CHOICE', reason=f'{labels[leaf["id"]]} is covered by your internship modules.')
                elif reason == 'NO_OFFERED_COURSE':
                    entry['reason'] = 'No course offered in the planned terms can count toward this requirement.'
                elif reason == 'NO_CAPACITY':
                    entry['reason'] = 'Offered courses exist, but none fits the term load limits without a timetable clash.'
                else:
                    entry['reason'] = 'The allocation search did not finish, so this requirement was not established.'
                unmet.append(entry)
            complete = all(u['reason_code'] == 'STUDENT_CHOICE' and u['placeholder_ids'] for u in unmet) and not any(i['code'] == 'ALLOCATION_UNRESOLVED' for i in final['issues'])

            # ---- output
            placements, semesters = [], []
            for term in all_terms:
                in_term = sorted([p for p in planned if p['term'] == term], key=lambda p: (p['code'], p['id']))
                held = [h for h in placeholder_rows if h['term'] == term]
                held += [{'id': m['id'], 'requirement_id': m['requirement_id'], 'desired_credits': decimal_string(m['credits']), 'label': INTERNSHIP_LABEL}
                         for m in modules if m['term'] == term]
                if not in_term and not held:
                    continue
                courses = []
                for p in in_term:
                    requirement = ledger.get(p['id'], picked_for[p['id']])
                    offering = offered[p['code']][term]
                    if p['basis'] == 'confirmed_offering':
                        why = f"offered in the {term} timetable"
                    else:
                        pattern = (pattern_snapshot(snapshots, term) or {}).get('term_id', 'an earlier year')
                        why = f"expected from the same-semester pattern of {pattern}"
                    mandatory = leaf_by_id[requirement]['type'] == 'mandatory_course' if requirement in leaf_by_id else False
                    reason = (f"Mandatory {labels[requirement]} course still pending; {why}." if mandatory else
                              f"Suggested for {labels[requirement]}; {why}. Chosen by a fixed rule (least surplus, fewest competing requirements, lower level), not by your preference; swap it freely.")
                    courses.append({'id': p['id'], 'normalized_code': p['code'], 'credits': decimal_string(p['credits']),
                                    'offering_id': p['offering_ids'][0] if len(p['offering_ids']) == 1 else None, 'intended_allocation': requirement,
                                    'assumptions': [] if p['basis'] == 'confirmed_offering' else [f"Expected offering: {why}."]})
                    placements.append({'item_id': p['id'], 'kind': 'course', 'term_id': term, 'normalized_code': p['code'], 'title': offering.get('title'),
                                       'credits': decimal_string(p['credits']), 'requirement_id': requirement, 'requirement_label': labels[requirement], 'basis': p['basis'],
                                       'reason': reason, 'offering_ids': p['offering_ids']})
                for h in held:
                    placements.append({'item_id': h['id'], 'kind': 'placeholder', 'term_id': term, 'normalized_code': None, 'title': None, 'credits': h['desired_credits'],
                                       'requirement_id': h['requirement_id'], 'requirement_label': labels[h['requirement_id']], 'basis': 'student_choice',
                                       'reason': h['label'], 'offering_ids': []})
                semesters.append({'term_id': term, 'courses': courses,
                                  'placeholders': [{k: h[k] for k in ('id', 'requirement_id', 'desired_credits', 'label', 'online') if k in h} for h in held]})
            return {'semesters': semesters, 'placements': placements, 'unmet': unmet, 'placeholder_rows': placeholder_rows, 'complete': complete,
                    'online_credits': sum((r['credits'] for r in online_rows), Decimal(0)), 'final_issues': final['issues']}
        finally:
            pass

    def ends(outcome):
        return term_key(outcome['semesters'][-1]['term_id']) if outcome['semesters'] else (0, 0)

    def better(candidate, incumbent):
        if candidate['complete'] != incumbent['complete']:
            return candidate['complete']
        return ends(candidate) < ends(incumbent)

    # Online credits (up to 16, taken in the breaks and the internship semester) are used only when they let the plan end earlier: first the
    # plan without them, then with the whole pool, then the smallest amount that still ends as early as the whole pool does.
    outcome = finish(ONLINE_POOL) if force_online and online_terms else finish(Decimal(0))
    if online_terms and not force_online:
        full = finish(ONLINE_POOL)
        if better(full, outcome):
            low, high, best = 1, int(ONLINE_POOL // 2), full   # budgets of 2 * k credits; the whole pool is known to work
            while low < high:
                middle = (low + high) // 2
                trial = finish(Decimal(2 * middle))
                if trial['complete'] == full['complete'] and ends(trial) <= ends(full):
                    best, high = trial, middle
                else:
                    low = middle + 1
            outcome = best

    semesters, placements, unmet, placeholder_rows, complete = outcome['semesters'], outcome['placements'], outcome['unmet'], outcome['placeholder_rows'], outcome['complete']
    placed_credits = sum((p['credits'] for p in planned), Decimal(0))
    arranged = sum((decimal_value(h['desired_credits']) for h in placeholder_rows), Decimal(0)) + sum((m['credits'] for m in modules), Decimal(0))
    credits_by_term = {s['term_id']: decimal_string(sum([decimal_value(c['credits']) for c in s['courses']] + [decimal_value(p['desired_credits']) for p in s['placeholders']], Decimal(0)))
                       for s in semesters}
    patterns = sorted({p['term'] for p in planned if p['basis'] == 'expected_pattern'})
    assumptions = []
    if not enrolment:
        assumptions.append(f"No current enrolment is recorded, so planning starts at {terms[0] if terms else 'the first term'}. Add your confirmed current courses first if you are already registered.")
    assumptions.append('Required and basket courses follow the timetable; elective credits are held as placeholders you fill with any course that counts.')
    assumptions.append('Recommended preparation was used only to order courses; it never blocks a plan.')
    if patterns:
        assumptions.append(f"Terms without a published timetable ({', '.join(patterns)}) use the same-semester pattern of the official 2026-27 lists as a hint.")
    if curriculum.get('noncredit_obligations'):
        assumptions.append('The comprehensive viva needs a P in every active semester; it is recorded each semester, not planned here.')
    validation = validate_plan({'attempts': attempts, 'current_enrolment': enrolment, 'catalogue': catalogue, 'identity': identity, 'standing': standing, 'simple_load': True}, {'semesters': semesters}, snapshots or None)
    issues = [issue('REQUIREMENT_UNMET', f"{u['label']} is not fully placed: {u['reason']}", 'warning', [u['requirement_id']], [], 'Choose courses for it yourself or adjust the terms and limits.')
              for u in unmet if u['reason_code'] != 'STUDENT_CHOICE'
              or (student_choice(leaf_by_id[u['requirement_id']]) and any(pid.startswith('gen-placeholder-') for pid in u['placeholder_ids']))]
    if any(i['code'] == 'ALLOCATION_UNRESOLVED' for i in outcome['final_issues']):
        issues.append(outcome['final_issues'][[i['code'] for i in outcome['final_issues']].index('ALLOCATION_UNRESOLVED')])
    remaining_after = sum((decimal_value(r['remaining_credits']) for r in base_final['requirements']), Decimal(0))
    horizon_last = usual_terms[-1] if usual_terms else None
    last = semesters[-1]['term_id'] if semesters else None
    early = bool(last and horizon_last and term_key(last) < term_key(horizon_last))
    skipped = len([t for t in usual_terms if last and term_key(last) < term_key(t)]) if early else 0
    online_used = outcome['online_credits']
    message = None
    if early and complete:
        message = f"You can graduate after {human_term(last)}, {skipped} semester{'s' if skipped != 1 else ''} before the usual {human_term(horizon_last)}."
        if online_used > 0:
            message += f" This uses {decimal_string(online_used)} credits of online courses taken in the breaks."
    graduation = {'internship_term': internship, 'early': (early if complete else None), 'last_term': last, 'usual_last_term': horizon_last, 'online_credits': decimal_string(online_used),
                  'message': message}
    # What online courses could do: the pool still free (16, less pass/fail conversions, online courses already on the record and those in this plan),
    # the breaks and the internship semester that can hold them, and this plan's busiest regular semester.
    recorded_online = sum((decimal_value(a['credits']) for a in attempts if a.get('online') is True and a.get('completion_status') == 'completed'), Decimal(0))
    pool_free = max(Decimal(0), ONLINE_POOL - pass_fail_conversions(curriculum, attempts) - recorded_online - online_used)
    busiest = max([decimal_value(c) for t, c in credits_by_term.items() if not t.endswith('SUMMER') and t != internship] or [Decimal(0)])
    online_potential = {'credits_available': decimal_string(pool_free), 'break_terms': list(online_terms), 'busiest_semester_credits': decimal_string(busiest),
                        'busiest_before': decimal_string(busiest_before) if busiest_before is not None else None, 'lightened': busiest_before is not None}
    return {'record_revision': context.get('record_revision', 0), 'rule_version': curriculum['version'], 'semesters': semesters, 'placements': placements,
            'unmet': unmet,
            'summary': {'terms': [s['term_id'] for s in semesters], 'total_credits': decimal_string(placed_credits + arranged),
                        'remaining_before': decimal_string(remaining_before), 'remaining_after': decimal_string(remaining_after),
                        'placed_credits': decimal_string(placed_credits), 'placeholder_credits': decimal_string(arranged), 'credits_by_term': credits_by_term,
                        'busiest_semester_credits': decimal_string(busiest), 'complete': complete},
            'assumptions': assumptions,
            'options': {'terms': usual_terms, 'target_credits_per_term': decimal_string(opts['target']),
                        'max_credits_per_term': decimal_string(opts['maximum']), 'skip_terms': opts['skip_terms'], 'internship_term': internship,
                        'lighten_with_online': busiest_before is not None},
            'graduation': graduation, 'online_potential': online_potential, 'notice': NOTICE, 'validation': validation, 'issues': issues}


def generate_plan(context, options=None):
    """A draft plan for the remaining degree (D-35 to D-41): semesters packed to the 28-credit limit, so the plan ends as early as the
    timetables allow; an optional internship semester holds internship modules; up to 16 online credits taken in the breaks and the
    internship semester are used when they let the plan end earlier."""
    options = dict(options or {})
    lighten = options.pop('lighten_with_online', False)
    if not isinstance(lighten, bool):
        raise ValueError('lighten_with_online must be true or false')
    base = _generate(context, options)
    end = base['graduation']['last_term']
    if not lighten or not base['summary']['complete'] or not end:
        return base
    # Lighten the plan (D-42): keep its last semester, use the online pool in the breaks and the internship semester, then spread the regular work evenly
    # over the same semesters. The lighter plan is returned only if it is complete and its busiest semester is lower; otherwise the plan as it was.
    busiest_base = decimal_value(base['summary']['busiest_semester_credits'])
    first = _generate(context, options, force_online=True, end_term=end)
    internship = first['options']['internship_term']
    regular = [t for t in first['options']['terms'] if term_key(t) <= term_key(end) and t != internship]
    if not first['summary']['complete'] or not regular:
        return base
    total = sum((decimal_value(first['summary']['credits_by_term'].get(t, '0')) for t in regular), Decimal(0))
    target = (total / len(regular)).to_integral_value(rounding=ROUND_CEILING)
    if target <= 0 or target >= busiest_base:
        return base
    lighter = _generate(context, {**options, 'target_credits_per_term': decimal_string(target)}, force_online=True, end_term=end, busiest_before=busiest_base)
    if lighter['summary']['complete'] and decimal_value(lighter['summary']['busiest_semester_credits']) < busiest_base:
        return lighter
    return base
