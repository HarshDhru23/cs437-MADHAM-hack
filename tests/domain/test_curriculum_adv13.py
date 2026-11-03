"""CSE 2024 curriculum from ADV13 (Academic Affairs Advisory No. 13, January 2026)
and docs/academic-decisions.md.

The anchor record follows the ADV13 p. 23 sample path for CSE 2024 entrants,
with synthetic grades and stand-in codes where p. 23 says XX:XXX. Hand totals:
FP 4 + HSS 28 + institute core 31 + materials 3 + maths 10 + science 8 +
BS elective 4 + CSE core 36 + electives 26 + open electives 16 + open project 4
= 170, plus four PE semesters and a viva P in each of eight active semesters.
"""
from copy import deepcopy
from decimal import Decimal
import json
from pathlib import Path
import time
import unittest
from coursepath.degree_audit import evaluate_audit
from coursepath.identity import identity_map
from coursepath.performance import calculate_performance
from coursepath.rules.loader import load_curriculum

GRADING = json.loads((Path(__file__).resolve().parents[2] / 'data/grading/reported-v1.json').read_text())

TERMS = ['2024-25-I', '2024-25-II', '2025-26-I', '2025-26-II', '2026-27-I', '2026-27-II', '2027-28-I', '2027-28-II']
PATH = [  # (semester index, code, credits, grade)
    (0, 'FP 100', '4', 'P'), (0, 'HS 191', '2', 'A'), (0, 'HS 201', '4', 'A'), (0, 'MA 103', '4', 'B'), (0, 'ES 101', '3', 'A'), (0, 'ES 112', '3', 'A'),
    (0, 'ES 115', '5', 'B'), (0, 'ES 118', '3', 'A'), (0, 'PE 101', '0', 'P'), (0, 'IN 101', '0', 'P'),
    (1, 'GE 101', '2', 'P'), (1, 'HS 192', '2', 'A'), (1, 'MA 104', '2', 'B'), (1, 'BS 192', '3', 'A'), (1, 'ES 113', '3', 'A'), (1, 'ES 114', '3', 'B'),
    (1, 'ES 116', '5', 'A'), (1, 'ES 117', '2', 'A'), (1, 'PE 102', '0', 'P'), (1, 'IN 102', '0', 'P'),
    (2, 'GE 201', '2', 'P'), (2, 'HS 221', '4', 'A'), (2, 'MA 203', '2', 'B'), (2, 'PH 202', '4', 'B'), (2, 'ES 243', '4', 'A'), (2, 'ES 214', '4', 'A'),
    (2, 'ES 242', '4', 'A'), (2, 'PE 103', '0', 'P'), (2, 'IN 103', '0', 'P'),
    (3, 'HS 305', '4', 'B'), (3, 'MA 205', '2', 'A'), (3, 'CH 204', '4', 'B'), (3, 'ES 204', '4', 'A'), (3, 'CS 201', '4', 'A'), (3, 'CS 332', '4', 'A'),
    (3, 'CS 328', '4', 'A'), (3, 'PE 104', '0', 'P'), (3, 'IN 104', '0', 'P'),
    (4, 'HS 151', '4', 'A'), (4, 'CS 299', '4', 'A'), (4, 'ES 336', '4', 'A'), (4, 'CS 202', '4', 'A'), (4, 'CS 329', '4', 'A'), (4, 'CS 330', '4', 'A'), (4, 'IN 105', '0', 'P'),
    (5, 'HS 352', '4', 'A'), (5, 'CS 331', '4', 'A'), (5, 'ES 301', '4', 'A'), (5, 'CS 432', '4', 'A'), (5, 'CS 613', '4', 'A'), (5, 'IN 106', '0', 'P'),
    (6, 'ME 210', '4', 'A'), (6, 'CE 301', '4', 'A'), (6, 'EE 311', '4', 'A'), (6, 'CS 614', '4', 'A'), (6, 'IN 107', '0', 'P'),
    (7, 'BS 401', '4', 'A'), (7, 'MSE 401', '4', 'A'), (7, 'CS 451', '2', 'A'), (7, 'IN 108', '0', 'P'),
]


def row(index, semester, code, credits, grade, **extra):
    status = 'failed' if grade in {'E', 'F'} else 'completed'
    return {'id': f'a{index:02d}-{code}', 'normalized_code': code, 'original_code': code, 'title': 'Synthetic', 'credits': credits, 'grade': grade,
            'term_id': TERMS[semester], 'completion_status': status, 'learning_designation': 'degree', 'source_refs': [], **extra}


def record(rows=PATH):
    return {'revision': 1, 'attempts': [row(i, *r) for i, r in enumerate(rows)], 'current_enrolment': []}


def nodes(tree, result=None):
    result = {} if result is None else result
    for node in tree:
        result[node['id']] = node
        nodes(node.get('children', []), result)
    return result


def audit(rows=PATH):
    return evaluate_audit(load_curriculum(), {}, record(rows))


def performance(attempts):
    return calculate_performance(attempts, GRADING, identity_map(load_curriculum().get('identity_groups')))


def credited_and_cpi(attempts, code):
    """The attempt IDs of `code` that earn credit in the audit, and those that enter CPI."""
    result = evaluate_audit(load_curriculum(), {}, {'revision': 1, 'attempts': attempts, 'current_enrolment': []})
    cumulative = performance(attempts)['cumulative']
    ids = {a['id'] for a in attempts if a['normalized_code'].startswith(code)}
    return (sorted(a['attempt_id'] for a in result['ledger'] if a['attempt_id'] in ids),
            sorted(c['attempt_id'] for c in cumulative['contributing_attempts'] if c['attempt_id'] in ids), result, cumulative)


class Adv13CurriculumTests(unittest.TestCase):
    def test_cp19_curriculum_is_reviewed_from_adv13_and_reconciles_to_170(self):
        curriculum = load_curriculum()
        self.assertEqual((curriculum['review_status'], curriculum['version'], curriculum['total_credits']), ('reviewed', 'cse-2024-v1', '170'))
        adv13 = next(s for s in curriculum['sources'] if s['id'] == 'adv13')
        self.assertEqual((adv13['authority'], adv13['effective_date']), ('institutional', '2026-01-28'))
        self.assertEqual(adv13['file_sha256'], '80d59bd2fb5b0096a57acd8192ba11387514cd8c08119e177cfd445c87c0861e')
        tops = {r['id']: r['minimum_credits'] for r in curriculum['requirements']}
        self.assertEqual(tops, {'foundation': '4', 'institute-core': '31', 'materials': '3', 'hss': '28', 'math': '10', 'science-basket': '8',
                                'bs-elective': '4', 'cse-core': '36', 'cse-electives': '26', 'open-electives': '16', 'open-project': '4', 'pe': '0'})
        core = nodes(curriculum['requirements'])['institute-core']['children']
        self.assertEqual({c['course_id']: c['minimum_credits'] for c in core}, {'ES 101': '3', 'ES 112': '3', 'ES 113': '3', 'ES 114': '3', 'ES 115': '5',
                                                                                 'ES 116': '5', 'ES 117': '2', 'ES 243': '4', 'BS 192': '3'})
        self.assertTrue(all(r.get('source_refs') and r.get('source_locator') for r in nodes(curriculum['requirements']).values()))

    def test_cp03_record_following_the_p23_path_is_complete(self):
        self.assertEqual(sum(Decimal(r[2]) for r in PATH), Decimal(170))
        result = audit()
        self.assertEqual(result['issues'], [])
        self.assertTrue(result['complete'], [(n['id'], n['status']) for n in nodes(result['actual']).values() if n['status'] != 'satisfied'])
        tree = nodes(result['actual'])
        self.assertEqual((tree['pe']['counted_courses'], tree['viva']['counted_courses'], tree['viva']['required_courses']), (4, 8, 8))
        counted = {a['attempt_id'].split('-', 1)[1]: a['requirement_id'] for a in result['ledger']}
        self.assertEqual((counted['HS 305'], counted['GE 101'], counted['BS 401'], counted['CS 299'], counted['MA 205']),
                         ('hss-other', 'ge', 'bs-elective', 'open-project', 'math-choice'))
        self.assertEqual(counted['PE 101'], 'pe')  # zero-credit PE fills its obligation, never open-elective credit
        self.assertNotIn('IN 101', counted)  # viva records are checked per semester, not allocated

    def test_cp17_cs203_is_not_cs202_and_counts_only_as_an_elective(self):
        rows = [r if r[1] != 'CS 202' else (r[0], 'CS 203', r[2], r[3]) for r in PATH]
        tree = nodes(audit(rows)['actual'])
        self.assertEqual((tree['tools']['status'], tree['tools']['remaining_credits']), ('pending', '4'))
        self.assertFalse(audit(rows)['complete'])

    def test_cp14_viva_needs_a_pass_in_every_active_semester(self):
        rows = [r if r[1] != 'IN 106' else (r[0], r[1], r[2], 'F') for r in PATH]
        viva = nodes(audit(rows)['actual'])['viva']
        self.assertEqual((viva['status'], viva['missing_terms']), ('pending', ['2026-27-II']))
        missing = [r for r in PATH if r[1] != 'IN 103']
        self.assertEqual(nodes(audit(missing)['actual'])['viva']['missing_terms'], ['2025-26-I'])

    def test_cp12_one_credit_short_course_stays_on_record_but_never_counts(self):
        result = audit(PATH + [(5, 'SC 372', '1', 'A')])
        self.assertIn({'attempt_id': f'a{len(PATH)}-SC 372', 'reason': 'ONE_CREDIT_SHORT_COURSE'}, result['excluded_attempts'])
        self.assertTrue(result['complete'])

    def test_cp18_project_caps_and_two_cs299_registrations(self):
        # Without general electives and open electives, 24 project credits compete for 26 open credits.
        base = [r for r in PATH if r[1] not in {'CS 613', 'CS 614', 'CS 451', 'ME 210', 'CE 301', 'EE 311', 'MSE 401'}]
        extra = [(5, 'CS 299', '4', 'A'), (6, 'CS 399', '4', 'A'), (6, 'CS 399', '4', 'B'), (7, 'CS 499', '4', 'A'), (7, 'CS 499', '4', 'B')]
        result = audit(base + extra)
        projects = [a for a in result['ledger'] if a['attempt_id'].split('-', 1)[1].endswith('99')]
        self.assertEqual(sum(Decimal(a['credits']) for a in projects), Decimal(16))  # D-09: 24 project credits, 16 count
        in_electives = [a for a in projects if a['requirement_id'] in {'theory', 'systems', 'cse-general'}]
        self.assertLessEqual(sum(Decimal(a['credits']) for a in in_electives), Decimal(8))  # D-10 / p. 15
        self.assertEqual([e['reason'] for e in result['excluded_attempts'] if e['attempt_id'].endswith('99')], ['PROJECT_CAP', 'PROJECT_CAP'])
        both = audit([r for r in PATH if r[1] not in {'CS 614', 'CS 451'}] + extra[:1])
        uses = sorted(a['requirement_id'] for a in both['ledger'] if 'CS 299' in a['attempt_id'])
        self.assertEqual(len(uses), 2)  # two registrations are two courses, not a repeat (D-01, D-10)
        self.assertIn('open-project', uses)

    def test_cp18_external_exposure_counts_only_toward_allowed_buckets(self):
        rows = [r for r in PATH if r[1] not in {'HS 305', 'HS 352', 'ME 210', 'CE 301', 'EE 311', 'MSE 401'}]
        rows += [(6, 'IN 498', '4', 'P'), (6, 'IN 498', '4', 'P'), (6, 'IN 498', '4', 'P'), (6, 'IN 498', '4', 'P')]
        result = audit(rows)
        uses = [a['requirement_id'] for a in result['ledger'] if 'IN 498' in a['attempt_id']]
        self.assertLessEqual(uses.count('hss-other'), 2)  # at most 8 HSS credits (A.12)
        self.assertTrue(set(uses) <= {'hss-other', 'open-electives', 'open-project'})
        self.assertEqual(len(uses), 4)

    def test_cp15_repeated_course_counts_its_best_grade_once(self):
        rows = [r if r[1] != 'CS 201' else (r[0], r[1], r[2], 'C') for r in PATH] + [(5, 'CS 201', '4', 'A')]
        result = audit(rows)
        uses = [a for a in result['ledger'] if 'CS 201' in a['attempt_id']]
        self.assertEqual([a['attempt_id'] for a in uses], [f'a{len(PATH)}-CS 201'])
        self.assertIn({'attempt_id': next(f'a{i:02d}-CS 201' for i, r in enumerate(rows) if r[1] == 'CS 201'), 'reason': 'SUPERSEDED_REPEAT'}, result['excluded_attempts'])

    def test_cp15_credit_and_cpi_supersede_the_same_failed_attempt(self):
        # D-15 with D-11: CS 432 failed, then passed with P. The P earns the credit, so the failed attempt is superseded in CPI
        # too, and a P never enters CPI: nothing from CS 432 is in CPI. E is a fail even though it carries 2 points.
        for failing in ('F', 'E'):
            rows = [r for r in PATH if r[1] != 'CS 432'] + [(4, 'CS 432', '4', failing), (5, 'CS 432', '4', 'P')]
            attempts = record(rows)['attempts']
            failed, passed = (a['id'] for a in attempts if a['normalized_code'] == 'CS 432')
            credited, in_cpi, _, cumulative = credited_and_cpi(attempts, 'CS 432')
            self.assertEqual((credited, in_cpi), ([passed], []), failing)
            self.assertIn({'attempt_id': failed, 'reason': 'SUPERSEDED_REPEAT'}, cumulative['excluded_attempts'])

    def test_cp15_same_course_variants_are_chosen_by_rule_not_attempt_id(self):
        # D-02/D-04/D-15: old ES 242 (3 credits) and ES 242(N) (4 credits), both A in one term. Whatever the attempt IDs,
        # the 4-credit attempt is the one counted, in credit and CPI alike, so DSA I is satisfied and the anchor stays complete.
        base = record([r for r in PATH if r[1] != 'ES 242'])['attempts']
        for old_id, new_id in [('a90-x', 'a91-y'), ('a91-y', 'a90-x')]:
            attempts = base + [{**row(0, 2, 'ES 242', '3', 'A'), 'id': old_id}, {**row(0, 2, 'ES 242(N)', '4', 'A'), 'id': new_id}]
            credited, in_cpi, result, _ = credited_and_cpi(attempts, 'ES 242')
            self.assertEqual((credited, in_cpi), ([new_id], [new_id]), old_id)
            self.assertEqual(nodes(result['actual'])['dsa']['status'], 'satisfied')
            self.assertTrue(result['complete'])

    def test_cp15_in498_modules_are_separate_courses_for_cpi_too(self):
        # D-15 exception for IN 498 modules (p. 3 A.12), as in the allocation: both letter-graded modules enter CPI.
        rows = [r for r in PATH if r[1] not in {'ME 210', 'CE 301'}] + [(6, 'IN 498', '4', 'A'), (6, 'IN 498', '4', 'B')]
        attempts = record(rows)['attempts']
        credited, in_cpi, _, _ = credited_and_cpi(attempts, 'IN 498')
        modules = sorted(a['id'] for a in attempts if a['normalized_code'] == 'IN 498')
        self.assertEqual((credited, in_cpi), (modules, modules))

    def test_cp17_surplus_is_reported_and_courses_are_never_split(self):
        # D-07: a 4-credit course in place of the 2-credit CS 451 puts general electives at 12 of 10.
        rows = [r if r[1] != 'CS 451' else (r[0], 'CS 617', '4', 'A') for r in PATH]
        result = audit(rows)
        tree = nodes(result['actual'])
        self.assertTrue(result['complete'])
        self.assertEqual((tree['cse-general']['counted_credits'], tree['cse-general']['surplus_credits']), ('12', '2'))
        self.assertEqual([a['credits'] for a in result['ledger'] if 'CS 617' in a['attempt_id']], ['4'])
        extra = audit(PATH + [(7, 'CS 617', '4', 'A')])  # an eighth elective that no requirement needs
        self.assertIn({'attempt_id': f'a{len(PATH)}-CS 617', 'reason': 'NOT_NEEDED'}, extra['excluded_attempts'])

    def test_cp20_hss_ge_and_bs_membership_follow_d19_d20(self):
        result = audit(PATH + [(7, 'GE 301', '2', 'P')])
        tree = nodes(result['actual'])
        self.assertEqual((tree['ge']['counted_courses'], tree['hss-other']['counted_credits']), (2, '8'))
        rows = [r if r[1] != 'BS 401' else (r[0], 'ES 335', r[2], r[3]) for r in PATH]
        self.assertEqual(nodes(audit(rows)['actual'])['bs-elective']['status'], 'pending')  # ES-coded is not a BS elective

    def test_cp20_allocation_stays_interactive_for_partial_and_full_records(self):
        partial = [r for r in PATH if r[0] < 4]
        for rows in (partial, PATH):
            started = time.perf_counter()
            result = audit(rows)
            self.assertLess(time.perf_counter() - started, 3)
            self.assertNotIn('ALLOCATION_UNRESOLVED', [i['code'] for i in result['issues']])
        tree = nodes(audit(partial)['actual'])
        self.assertEqual((tree['open-electives']['status'], tree['cse-core']['status']), ('pending', 'pending'))


if __name__ == '__main__':
    unittest.main()
