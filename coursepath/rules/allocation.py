"""Bounded exclusive allocation. Objective, in order: mandatory obligations; a
complete allocation when one exists (D-07); most required credits and courses
placed; narrowest requirement for each placed credit, so an incomplete record
never spends a basket course on an unrestricted bucket (H07); least surplus
(D-07). Every assignment consumes one indivisible instance; parents only aggregate.

Verified mandatory matches are placed first: a course that matches a mandatory
requirement can only usefully fill that requirement. The remaining flexible
courses go through a bounded depth-first search, most constrained first.
"""
import re
from decimal import Decimal
from time import monotonic
from coursepath.serialization import decimal_value, decimal_string
from coursepath.rules.schema import walk_requirements
from coursepath.rules.expressions import requirement_result
from coursepath.issues import issue
from coursepath.identity import identity_map, canonical_code
from coursepath.imports.grades import POINTS


def _subject(code):
    return code.split(' ', 1)[0]


def matches(rule, code, identity):
    """Explicit codes, subject prefixes (D-06, D-19, D-20) or code patterns."""
    codes = {canonical_code(c, identity) for c in rule.get('course_ids') or []}
    if rule.get('course_id'):
        codes.add(canonical_code(rule['course_id'], identity))
    return (code in codes or _subject(code) in (rule.get('course_prefixes') or [])
            or any(re.search(p, code) for p in rule.get('course_patterns') or []))


def eligible(leaf, code, credits, identity):
    """Zero-credit records fill only noncredit obligations, and credit courses only credit requirements."""
    if (leaf['type'] == 'noncredit') != (credits == 0):
        return False
    if code in {canonical_code(c, identity) for c in leaf.get('exclude_course_ids') or []}:
        return False
    return leaf.get('any_course') is True or matches(leaf, code, identity)


def _breadth(leaf):
    if leaf.get('any_course'):
        return 100000
    open_rule = bool(leaf.get('course_prefixes') or leaf.get('course_patterns'))
    return 10000 * open_rule + len(leaf.get('course_ids') or [])


def pass_fail_conversions(curriculum, attempts):
    """D-12: a P on a normally letter-graded course is a pass/fail conversion."""
    rule = curriculum.get('pass_fail_courses')
    if not rule:
        return Decimal(0)
    total = Decimal(0)
    for attempt in attempts:
        credits = decimal_value(attempt['credits'])
        code = attempt['normalized_code']
        if attempt.get('grade', '').strip().upper() != 'P' or credits == 0 or attempt.get('planned') or attempt.get('current'):
            continue
        if _subject(code) in rule.get('prefixes', []) or code in rule.get('course_ids', []):
            continue
        total += credits
    return total


def _viva(obligation, attempts, identity):
    """D-16: a passing viva record in every active (regular) semester of the actual record."""
    actual = [a for a in attempts if not a.get('planned') and not a.get('current')]
    active = sorted({a['term_id'] for a in actual if a.get('term_id') and not a['term_id'].endswith('SUMMER')})
    passed = set()
    for attempt in actual:
        code = canonical_code(attempt['normalized_code'], identity)
        if obligation.get('zero_credit_only') and decimal_value(attempt['credits']) != 0:
            continue
        if code in (obligation.get('exclude_course_ids') or []) or not matches(obligation, code, identity):
            continue
        if attempt.get('grade', '').strip().upper() in obligation.get('passing_grades', []):
            passed.add(attempt['term_id'])
    missing = [t for t in active if t not in passed]
    status = 'satisfied' if active and not missing else 'pending'
    return {'id': obligation['id'], 'label': obligation.get('label', obligation['id']), 'status': status, 'required_credits': '0', 'counted_credits': '0',
            'remaining_credits': '0', 'surplus_credits': '0', 'counted_courses': len([t for t in active if t in passed]), 'required_courses': len(active),
            'allocation_ids': [], 'source_refs': obligation.get('source_refs', []), 'children': [], 'missing_terms': missing}


def allocate(curriculum, catalogue, attempts, *, node_budget=100000, time_budget_seconds=0.5):
    roots = curriculum['requirements']
    leaves = [r for r in walk_requirements(roots) if not r.get('children')]
    leaves.sort(key=lambda r: (r['type'] != 'mandatory_course', _breadth(r), r['id']))
    caps = curriculum.get('caps', [])
    identity = identity_map(curriculum.get('identity_groups'))
    excluded_courses = {canonical_code(e['course_id'], identity): e['reason'] for e in curriculum.get('excluded_courses', [])}
    separate = set((curriculum.get('repeat_policy') or {}).get('separate_course_tags', []))
    issues, excluded, candidates, seen = [], [], [], set()
    unknown_caps = False
    for attempt in sorted(attempts, key=lambda a: a['id']):
        source_id = attempt.get('source_key', attempt['id'])
        reason = None
        if source_id in seen:
            reason = 'DUPLICATE_SOURCE_ATTEMPT'
        seen.add(source_id)
        code = canonical_code(attempt['normalized_code'], identity)
        if attempt.get('completion_status') != 'completed':
            reason = 'NOT_COMPLETED'
        elif attempt.get('learning_designation') != 'degree':
            reason = 'LEARNING_DESIGNATION_UNKNOWN' if attempt.get('learning_designation') != 'additional' else 'ADDITIONAL_LEARNING'
        elif code in excluded_courses:
            reason = excluded_courses[code]
        if reason:
            excluded.append({'attempt_id': attempt['id'], 'reason': reason})
            continue
        metadata = catalogue.get(attempt['normalized_code']) or catalogue.get(code, {})
        tags = set(metadata.get('tags', [])) | {t for t, rule in curriculum.get('course_tags', {}).items() if matches(rule, code, identity)}
        if attempt.get('online') is True:
            tags.add('online')
        if caps and 'tags' not in metadata and not curriculum.get('course_tags'):
            unknown_caps = True
        candidates.append((attempt, code, tags))
    if curriculum.get('repeat_policy', {}).get('rule') == 'best_grade':
        # D-15: one counted attempt per course; project registrations are separate courses.
        best = {}
        for attempt, code, tags in candidates:
            if tags & separate:
                continue
            rank = (POINTS.get(attempt.get('grade', '').strip().upper(), Decimal(-1)), attempt.get('term_id') or '', attempt['id'])
            if code not in best or rank > best[code][0]:
                best[code] = (rank, attempt['id'])
        keep = []
        for attempt, code, tags in candidates:
            if not tags & separate and best[code][1] != attempt['id']:
                excluded.append({'attempt_id': attempt['id'], 'reason': 'SUPERSEDED_REPEAT'})
            else:
                keep.append((attempt, code, tags))
        candidates = keep
    rows = []
    for attempt, code, tags in candidates:
        credits = decimal_value(attempt['credits'])
        options = [i for i, leaf in enumerate(leaves) if eligible(leaf, code, credits, identity)]
        if not options:
            excluded.append({'attempt_id': attempt['id'], 'reason': 'NO_REVIEWED_ALLOCATION'})
            continue
        rows.append((attempt, options, tags))
    minimums = [decimal_value(r.get('minimum_credits', '0')) for r in leaves]
    minimum_counts = [r.get('minimum_courses', 1 if r['type'] in {'mandatory_course', 'noncredit'} else 0) for r in leaves]
    limits = [decimal_value(c['maximum_credits']) for c in caps]
    conversions = pass_fail_conversions(curriculum, attempts)
    limits = [max(Decimal(0), limit - conversions) if cap.get('reduced_by') == 'pass_fail_conversions' else limit for cap, limit in zip(caps, limits)]
    leaf_ids = [l['id'] for l in leaves]
    position = {l['id']: i for i, l in enumerate(leaves)}
    alternatives = {}  # leaf index -> sibling leaf indexes under the same any_of
    for node in walk_requirements(roots):
        if node['type'] == 'any_of':
            branch = [position[c['id']] for c in node['children'] if c['id'] in position]
            for i in branch:
                alternatives[i] = [j for j in branch if j != i]

    def met(i, totals, counts):
        return totals[i] >= minimums[i] and counts[i] >= minimum_counts[i]

    def open_leaf(i, totals, counts):
        # An alternative stops being open once another alternative of its any_of is met.
        return not met(i, totals, counts) and not any(met(j, totals, counts) for j in alternatives.get(i, ()))

    def cap_update(cap_totals, tags, leaf, credits):
        updated = list(cap_totals)
        for index, cap in enumerate(caps):
            if tags & set(cap.get('tags_any', [])) and (not cap.get('requirement_ids') or leaf['id'] in cap['requirement_ids']):
                updated[index] += credits
                if updated[index] > limits[index]:
                    return None
        return tuple(updated)

    # Verified mandatory matches first.
    totals, counts, cap_totals, fixed, flexible = [Decimal(0)] * len(leaves), [0] * len(leaves), (Decimal(0),) * len(caps), [], []
    for row in sorted(rows, key=lambda r: r[0]['id']):
        attempt, options, tags = row
        credits = decimal_value(attempt['credits'])
        # Only a course that meets the obligation by itself is placed up front; partial fills go to the search.
        mandatory = [i for i in options if leaves[i]['type'] in {'mandatory_course', 'noncredit'} and open_leaf(i, totals, counts)
                     and totals[i] + credits >= minimums[i] and (counts[i] + 1 >= minimum_counts[i] or leaves[i]['type'] == 'noncredit')]
        updated = cap_update(cap_totals, tags, leaves[mandatory[0]], credits) if mandatory else None
        if mandatory and updated is not None:
            totals[mandatory[0]] += credits
            counts[mandatory[0]] += 1
            cap_totals = updated
            fixed.append((attempt, mandatory[0]))
        else:
            flexible.append(row)
    flexible.sort(key=lambda row: (len(row[1]), row[0]['id']))

    def compile_node(node):
        # Same satisfaction rule as requirement_result, on plain numbers, for use inside the search.
        children = [compile_node(c) for c in node.get('children', [])]
        unlisted = not children and node.get('course_ids', []) is None and not (node.get('course_prefixes') or node.get('course_patterns') or node.get('any_course'))
        return (node['type'], decimal_value(node.get('minimum_credits', '0')), position.get(node['id']), children, unlisted)

    def evaluate(compiled, totals, counts):
        kind, required, leaf, children, unlisted = compiled
        if not children:
            return (not unlisted and met(leaf, totals, counts)), totals[leaf]
        parts = [evaluate(c, totals, counts) for c in children]
        if kind == 'any_of':
            chosen = max(parts, key=lambda part: (part[0], part[1]))
            return chosen
        counted = sum((part[1] for part in parts), Decimal(0))
        return all(part[0] for part in parts) and counted >= required, counted

    compiled_roots = [compile_node(r) for r in roots]

    def satisfied_roots(totals, counts):
        return sum(evaluate(r, totals, counts)[0] for r in compiled_roots)

    flexible_credits = [decimal_value(row[0]['credits']) for row in flexible]
    global_caps = [c for c, cap in enumerate(caps) if not cap.get('requirement_ids')]
    mandatory_leaves = [i for i, r in enumerate(leaves) if r['type'] == 'mandatory_course']

    def bound(index, totals, counts, cap_totals):
        """Optimistic score: every remaining course counted toward every open requirement the caps still allow."""
        extra_totals, extra_counts = list(totals), list(counts)
        credit_room, row_room = Decimal(0), 0
        capped_room = [Decimal(0)] * len(caps)
        for position_, (_, options, tags) in enumerate(flexible[index:], index):
            reachable = [i for i in options if open_leaf(i, totals, counts) and cap_update(cap_totals, tags, leaves[i], flexible_credits[position_]) is not None]
            if reachable:
                limited_by = next((c for c in global_caps if tags & set(caps[c].get('tags_any', []))), None)
                if limited_by is None:
                    credit_room += flexible_credits[position_]
                else:  # a whole-degree cap limits all of its courses together
                    capped_room[limited_by] += flexible_credits[position_]
                row_room += 1
            for i in reachable:
                extra_totals[i] += flexible_credits[position_]
                extra_counts[i] += 1
        # A requirement gains at most its own gap and at most what its reachable courses supply.
        credit_gap = sum((min(max(Decimal(0), t - x), e - x) for x, t, e in zip(totals, minimums, extra_totals)), Decimal(0))
        count_gap = sum(min(max(0, t - x), e - x) for x, t, e in zip(counts, minimum_counts, extra_counts))
        credit_room += sum((min(room, limits[c] - cap_totals[c]) for c, room in enumerate(capped_room)), Decimal(0))
        placed = sum(min(x, t) for x, t in zip(totals, minimums))
        open_gap = sum((max(Decimal(0), minimums[i] - totals[i]) for i in range(len(leaves)) if i not in alternatives and open_leaf(i, totals, counts)), Decimal(0))
        # To tie the best placed credits, at least `needed` more must land somewhere; the cheapest way fills
        # the narrowest reachable gaps first, which bounds how good the breadth tiebreak can still get.
        needed, cost = max(Decimal(0), best_score[2] - placed) if best_score else Decimal(0), Decimal(0)
        for rank in range(len(leaves)):
            if needed <= 0:
                break
            room = min(max(Decimal(0), minimums[rank] - totals[rank]), extra_totals[rank] - totals[rank])
            take = min(room, needed)
            cost += rank * take
            needed -= take
        return (sum(met(i, extra_totals, extra_counts) for i in mandatory_leaves),
                satisfied_roots(extra_totals, extra_counts) == len(compiled_roots) and credit_room >= open_gap,
                placed + min(credit_room, credit_gap), sum(min(x, t) for x, t in zip(counts, minimum_counts)) + min(row_room, count_gap),
                breadth_score(totals) - cost, -sum(max(Decimal(0), x - t) for x, t in zip(totals, minimums)))

    def breadth_score(totals):
        return -sum((rank * x for rank, x in enumerate(totals)), Decimal(0))

    state = (0, tuple(totals), tuple(counts), cap_totals, ())
    stack, memo = [state], {}
    best, best_score = state, None
    visited, exhausted, deadline = 0, False, monotonic() + time_budget_seconds
    while stack:
        if visited >= node_budget or monotonic() >= deadline:
            exhausted = True
            break
        current = stack.pop()
        index, totals, counts, cap_totals, assignments = current
        # Same position and capped progress: keep only the path with the better narrowness/surplus tiebreak.
        key = (index, tuple(min(x, target) for x, target in zip(totals, minimums)), tuple(min(x, target) for x, target in zip(counts, minimum_counts)), cap_totals)
        tiebreak = (breadth_score(totals), -sum(max(Decimal(0), x - t) for x, t in zip(totals, minimums)))
        if key in memo and memo[key] >= tiebreak:
            continue
        memo[key] = tiebreak
        visited += 1
        satisfied = satisfied_roots(totals, counts)
        score = (sum(met(i, totals, counts) for i in mandatory_leaves), satisfied == len(compiled_roots),
                 sum(min(x, target) for x, target in zip(totals, minimums)), sum(min(x, target) for x, target in zip(counts, minimum_counts)),
                 breadth_score(totals), -sum(max(Decimal(0), x - t) for x, t in zip(totals, minimums)))
        if best_score is None or score > best_score:
            best_score, best = score, current
        if index >= len(flexible) or bound(index, totals, counts, cap_totals) <= best_score:
            continue
        if not any(open_leaf(i, totals, counts) for _, options, _ in flexible[index:] for i in options):
            continue
        row, options, tags = flexible[index]
        credits = decimal_value(row['credits'])
        stack.append((index + 1, totals, counts, cap_totals, assignments))
        for leaf_index in reversed(options):
            leaf = leaves[leaf_index]
            if not open_leaf(leaf_index, totals, counts):
                continue
            if leaf.get('maximum_credits') and totals[leaf_index] + credits > decimal_value(leaf['maximum_credits']):
                continue
            updated = cap_update(cap_totals, tags, leaf, credits)
            if updated is None:
                continue
            next_totals, next_counts = list(totals), list(counts)
            next_totals[leaf_index] += credits
            next_counts[leaf_index] += 1
            stack.append((index + 1, tuple(next_totals), tuple(next_counts), updated, assignments + ((index, leaf_index),)))
    _, totals, counts, cap_totals, assignments = best
    placed = fixed + [(flexible[row_index][0], leaf_index) for row_index, leaf_index in assignments]
    ledger = [{'id': f"allocation:{attempt['id']}:{leaves[leaf_index]['id']}", 'attempt_id': attempt['id'],
               'requirement_id': leaves[leaf_index]['id'], 'credits': decimal_string(decimal_value(attempt['credits'])),
               'counting_context': 'base', 'source_refs': leaves[leaf_index].get('source_refs', []), 'shared_with': [],
               'explanation': 'One indivisible eligible completed instance, allocated once.'}
              for attempt, leaf_index in placed]
    assigned_ids = {a['attempt_id'] for a in ledger}
    for attempt, options, tags in flexible:
        if attempt['id'] in assigned_ids:
            continue
        unmet = [i for i in options if open_leaf(i, totals, counts)]
        credits = decimal_value(attempt['credits'])
        blocking = [cap for index, cap in enumerate(caps) if tags & set(cap.get('tags_any', []))
                    and any(not cap.get('requirement_ids') or leaves[i]['id'] in cap['requirement_ids'] for i in unmet)
                    and cap_totals[index] + credits > limits[index]]
        everywhere = [cap for cap in blocking if all(not cap.get('requirement_ids') or leaves[i]['id'] in cap['requirement_ids'] for i in unmet)]
        reason = 'NOT_NEEDED' if not unmet else (everywhere or blocking or [{}])[0].get('reason_code', 'ALLOCATION_ALTERNATIVE')
        excluded.append({'attempt_id': attempt['id'], 'reason': reason})
    if exhausted:
        issues.append(issue('ALLOCATION_UNRESOLVED', 'Allocation search budget exhausted; completion has not been established.'))
    if unknown_caps or any(cap.get('interaction_status') == 'unknown' for cap in caps):
        issues.append(issue('CAP_POLICY_UNKNOWN', 'Cap classification/interaction needs reviewed evidence.'))
    review = curriculum.get('review_status') != 'reviewed'
    if review:
        issues.append(issue('SOURCE_MISSING', 'Curriculum is draft/conflicted; no official completion verdict is available.'))
    obligations = curriculum.get('noncredit_obligations', [])
    if any(o.get('completion_policy') is None for o in obligations):
        issues.append(issue('NONCREDIT_POLICY_UNKNOWN', 'Per-semester PE/viva completion requires reviewed policy and active-semester evidence.'))
    totals_by_id, counts_by_id = dict(zip(leaf_ids, totals)), dict(zip(leaf_ids, counts))
    tree = [requirement_result(r, totals_by_id, counts_by_id, ledger, review or exhausted) for r in roots]
    tree += [_viva(o, attempts, identity) for o in obligations if o.get('completion_policy') == 'pass_each_active_semester']
    return {'requirements': tree, 'ledger': sorted(ledger, key=lambda a: a['id']), 'excluded_attempts': excluded, 'issues': issues,
            'complete': bool(tree) and all(r['status'] == 'satisfied' for r in tree) and not issues, 'search_nodes': visited}
