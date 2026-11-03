"""Differential check of the pruned allocation search (CP-17).

For small random curricula, brute force enumerates every cap-respecting
assignment of courses to requirements (or to nothing) and scores it with the
objective documented in coursepath/rules/allocation.py. The allocator must
reach the brute-force optimum; pruning may skip work, never better answers.
"""
from decimal import Decimal
from itertools import product
import random
import unittest
from coursepath.rules.allocation import allocate, eligible
from coursepath.rules.schema import walk_requirements

SOURCE = [{'id': 's', 'kind': 'advisory', 'locator': 'Synthetic', 'version': 'v1', 'applicable_cohorts': ['BTECH_CSE-2024'],
           'effective_date': '2024-01-01', 'review_status': 'reviewed', 'authority': 'institutional'}]
CODES = ['ZZ 101', 'ZZ 102', 'ZZ 201', 'ZZ 299', 'YY 110', 'YY 210']


def breadth(leaf):
    if leaf.get('any_course'):
        return 100000
    return 10000 * bool(leaf.get('course_prefixes') or leaf.get('course_patterns')) + len(leaf.get('course_ids') or [])


def random_case(rng):
    leaves = []
    for i in range(rng.randint(2, 4)):
        kind = rng.choice(['list', 'prefix', 'any', 'mandatory'])
        leaf = {'id': f'r{i}', 'type': 'mandatory_course' if kind == 'mandatory' else 'minimum_credits', 'source_refs': ['s']}
        if kind == 'mandatory':
            leaf.update(course_id=rng.choice(CODES), minimum_credits='4')
        else:
            leaf['minimum_credits'] = str(rng.choice([2, 4, 6, 8]))
            if kind == 'list':
                leaf['course_ids'] = rng.sample(CODES, rng.randint(1, 3))
            elif kind == 'prefix':
                leaf['course_prefixes'] = [rng.choice(['ZZ', 'YY'])]
            else:
                leaf['any_course'] = True
        leaves.append(leaf)
    roots = leaves if rng.random() < 0.5 else [{'id': 'parent', 'type': 'all_of', 'source_refs': ['s'], 'children': leaves[:2],
                                                'minimum_credits': str(sum(Decimal(l['minimum_credits']) for l in leaves[:2]))}] + leaves[2:]
    total = sum(Decimal(r['minimum_credits']) for r in roots)
    caps = [{'id': 'cap', 'tags_any': ['project'], 'maximum_credits': str(rng.choice([4, 8])), 'source_refs': ['s']}] if rng.random() < 0.5 else []
    curriculum = {'id': 'x', 'version': 'x', 'cohort': 'BTECH_CSE-2024', 'review_status': 'reviewed', 'sources': SOURCE, 'total_credits': str(total),
                  'requirements': roots, 'caps': caps, 'course_tags': {'project': {'course_patterns': ['99$'], 'source_refs': ['s']}}}
    attempts = [{'id': f'a{i}', 'normalized_code': rng.choice(CODES), 'credits': rng.choice(['2', '4', '4']), 'grade': 'A', 'term_id': '2025-26-I',
                 'completion_status': 'completed', 'learning_designation': 'degree'} for i in range(rng.randint(1, 6))]
    return curriculum, attempts


def score(curriculum, placed):
    """Objective from the allocator's docstring, computed independently from a placement {attempt_id: leaf_id}."""
    leaves = sorted([r for r in walk_requirements(curriculum['requirements']) if not r.get('children')],
                    key=lambda r: (r['type'] != 'mandatory_course', breadth(r), r['id']))
    totals = {l['id']: Decimal(0) for l in leaves}
    counts = {l['id']: 0 for l in leaves}
    for credits, leaf in placed:
        totals[leaf] += credits
        counts[leaf] += 1
    minimum = {l['id']: Decimal(l['minimum_credits']) for l in leaves}
    need = {l['id']: 1 if l['type'] == 'mandatory_course' else 0 for l in leaves}
    met = {k: totals[k] >= minimum[k] and counts[k] >= need[k] for k in totals}

    def satisfied(node):
        if not node.get('children'):
            return met[node['id']], totals[node['id']]
        parts = [satisfied(c) for c in node['children']]
        counted = sum(p[1] for p in parts)
        return all(p[0] for p in parts) and counted >= Decimal(node['minimum_credits']), counted

    return (sum(met[l['id']] for l in leaves if l['type'] == 'mandatory_course'),
            all(satisfied(r)[0] for r in curriculum['requirements']),
            sum(min(totals[k], minimum[k]) for k in totals), sum(min(counts[k], need[k]) for k in counts),
            -sum(rank * totals[l['id']] for rank, l in enumerate(leaves)), -sum(max(Decimal(0), totals[k] - minimum[k]) for k in totals))


def brute_force(curriculum, attempts):
    leaves = [r for r in walk_requirements(curriculum['requirements']) if not r.get('children')]
    choices = [[None] + [l['id'] for l in leaves if eligible(l, a['normalized_code'], Decimal(a['credits']), {})] for a in attempts]
    caps = curriculum['caps']
    best = None
    for option in product(*choices):
        used = Decimal(0)
        for attempt, leaf in zip(attempts, option):
            if leaf and attempt['normalized_code'].endswith('99'):
                used += Decimal(attempt['credits'])
        if caps and used > Decimal(caps[0]['maximum_credits']):
            continue
        result = score(curriculum, [(Decimal(a['credits']), leaf) for a, leaf in zip(attempts, option) if leaf])
        best = result if best is None or result > best else best
    return best


class AllocationOptimalityTests(unittest.TestCase):
    def test_cp17_pruned_search_matches_brute_force_on_random_cases(self):
        rng = random.Random(20261031)
        for case in range(300):
            curriculum, attempts = random_case(rng)
            result = allocate(curriculum, {}, attempts)
            self.assertNotIn('ALLOCATION_UNRESOLVED', [i['code'] for i in result['issues']])
            credits = {a['id']: Decimal(a['credits']) for a in attempts}
            found = score(curriculum, [(credits[a['attempt_id']], a['requirement_id']) for a in result['ledger']])
            with self.subTest(case=case):
                self.assertEqual(found, brute_force(curriculum, attempts), (curriculum['requirements'], attempts, result['ledger']))


if __name__ == '__main__':
    unittest.main()
