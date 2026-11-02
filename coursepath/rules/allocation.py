"""Bounded exclusive allocation. Objective: mandatory obligations, satisfied
roots, then fulfilled leaf deficits. Constrained attempts are visited first.
Every assignment consumes one indivisible instance; parents only aggregate.
"""
from decimal import Decimal
from time import monotonic
from coursepath.serialization import decimal_value, decimal_string
from coursepath.rules.schema import walk_requirements
from coursepath.rules.expressions import requirement_result
from coursepath.issues import issue
from coursepath.identity import identity_map, canonical_code


def allocate(curriculum, catalogue, attempts, *, node_budget=100000, time_budget_seconds=0.5):
    roots = curriculum['requirements']
    leaves = [r for r in walk_requirements(roots) if not r.get('children')]
    leaves.sort(key=lambda r: (r['type'] != 'mandatory_course', len(r.get('course_ids') or []), r['id']))
    caps = curriculum.get('caps', [])
    issues, excluded, rows, seen = [], [], [], set()
    unknown_caps = False
    identity = identity_map(curriculum.get('identity_groups'))
    for attempt in sorted(attempts, key=lambda a: a['id']):
        source_id = attempt.get('source_key', attempt['id'])
        reason = None
        if source_id in seen:
            reason = 'DUPLICATE_SOURCE_ATTEMPT'
        seen.add(source_id)
        if attempt.get('completion_status') != 'completed':
            reason = 'NOT_COMPLETED'
        elif attempt.get('learning_designation') != 'degree':
            reason = 'LEARNING_DESIGNATION_UNKNOWN' if attempt.get('learning_designation') != 'additional' else 'ADDITIONAL_LEARNING'
        if reason:
            excluded.append({'attempt_id': attempt['id'], 'reason': reason})
            continue
        code = canonical_code(attempt['normalized_code'], identity)
        options = [i for i, leaf in enumerate(leaves) if code == canonical_code(leaf.get('course_id'), identity)
                   or code in {canonical_code(c, identity) for c in leaf.get('course_ids') or []}]
        if not options:
            excluded.append({'attempt_id': attempt['id'], 'reason': 'NO_REVIEWED_ALLOCATION'})
            continue
        metadata = catalogue.get(attempt['normalized_code']) or catalogue.get(code, {})
        if caps and 'tags' not in metadata:
            unknown_caps = True
        rows.append((attempt, options, metadata.get('tags', [])))
    rows.sort(key=lambda row: (len(row[1]), row[0]['id']))
    minimums = [decimal_value(r.get('minimum_credits', '0')) for r in leaves]
    minimum_counts = [r.get('minimum_courses', 1 if r['type'] in {'mandatory_course', 'noncredit'} else 0) for r in leaves]
    state = (0, (Decimal(0),) * len(leaves), (0,) * len(leaves), (Decimal(0),) * len(caps), ())
    stack, memo = [state], set()
    best, best_score = state, None
    visited, exhausted, deadline = 0, False, monotonic() + time_budget_seconds

    def results(totals, counts):
        return [requirement_result(r, dict(zip((l['id'] for l in leaves), totals)), dict(zip((l['id'] for l in leaves), counts)), []) for r in roots]

    while stack:
        if visited >= node_budget or monotonic() >= deadline:
            exhausted = True
            break
        current = stack.pop()
        index, totals, counts, cap_totals, assignments = current
        key = (index, tuple(min(x, target) for x, target in zip(totals, minimums)), tuple(min(x, target) for x, target in zip(counts, minimum_counts)), cap_totals)
        if key in memo:
            continue
        memo.add(key)
        visited += 1
        tree = results(totals, counts)
        score = (sum(counts[i] >= minimum_counts[i] and totals[i] >= minimums[i] for i, r in enumerate(leaves) if r['type'] == 'mandatory_course'),
                 sum(r['status'] == 'satisfied' for r in tree), sum(min(x, target) for x, target in zip(totals, minimums)),
                 sum(min(x, target) for x, target in zip(counts, minimum_counts)))
        if best_score is None or score > best_score:
            best_score, best = score, current
        if all(r['status'] == 'satisfied' for r in tree):
            best = current
            break
        if index >= len(rows):
            continue
        if not any(totals[i] < minimums[i] or counts[i] < minimum_counts[i] for _, options, _ in rows[index:] for i in options):
            continue
        row, options, tags = rows[index]
        credits = decimal_value(row['credits'])
        stack.append((index + 1, totals, counts, cap_totals, assignments))
        for leaf_index in reversed(options):
            leaf = leaves[leaf_index]
            if totals[leaf_index] >= minimums[leaf_index] and counts[leaf_index] >= minimum_counts[leaf_index]:
                continue
            if leaf.get('maximum_credits') and totals[leaf_index] + credits > decimal_value(leaf['maximum_credits']):
                continue
            updated_caps = list(cap_totals)
            allowed = True
            for cap_index, cap in enumerate(caps):
                if set(tags) & set(cap.get('tags_any', [])) and (not cap.get('requirement_ids') or leaf['id'] in cap['requirement_ids']):
                    updated_caps[cap_index] += credits
                    if updated_caps[cap_index] > decimal_value(cap['maximum_credits']):
                        allowed = False
            if not allowed:
                continue
            next_totals, next_counts = list(totals), list(counts)
            next_totals[leaf_index] += credits
            next_counts[leaf_index] += 1
            stack.append((index + 1, tuple(next_totals), tuple(next_counts), tuple(updated_caps), assignments + ((index, leaf_index),)))
    _, totals, counts, _, assignments = best
    ledger = [{'id': f"allocation:{rows[row_index][0]['id']}:{leaves[leaf_index]['id']}", 'attempt_id': rows[row_index][0]['id'],
               'requirement_id': leaves[leaf_index]['id'], 'credits': decimal_string(decimal_value(rows[row_index][0]['credits'])),
               'counting_context': 'base', 'source_refs': leaves[leaf_index].get('source_refs', []), 'shared_with': [],
               'explanation': 'One indivisible eligible completed instance, allocated once.'}
              for row_index, leaf_index in assignments]
    assigned_ids = {a['attempt_id'] for a in ledger}
    excluded.extend({'attempt_id': row['id'], 'reason': 'CAP_OR_ALLOCATION_ALTERNATIVE'} for row, _, _ in rows if row['id'] not in assigned_ids)
    if exhausted:
        issues.append(issue('ALLOCATION_UNRESOLVED', 'Allocation search budget exhausted; completion has not been established.'))
    if unknown_caps or any(cap.get('interaction_status') == 'unknown' for cap in caps):
        issues.append(issue('CAP_POLICY_UNKNOWN', 'Cap classification/interaction needs reviewed evidence.'))
    review = curriculum.get('review_status') != 'reviewed'
    if review:
        issues.append(issue('SOURCE_MISSING', 'Curriculum is draft/conflicted; no official completion verdict is available.'))
    if curriculum.get('noncredit_obligations'):
        issues.append(issue('NONCREDIT_POLICY_UNKNOWN', 'Per-semester PE/viva completion requires reviewed policy and active-semester evidence.'))
    tree = [requirement_result(r, dict(zip((l['id'] for l in leaves), totals)), dict(zip((l['id'] for l in leaves), counts)), ledger, review or exhausted) for r in roots]
    return {'requirements': tree, 'ledger': sorted(ledger, key=lambda a: a['id']), 'excluded_attempts': excluded, 'issues': issues,
            'complete': bool(tree) and all(r['status'] == 'satisfied' for r in tree) and not issues, 'search_nodes': visited}
