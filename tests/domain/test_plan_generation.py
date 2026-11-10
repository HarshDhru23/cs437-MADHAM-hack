"""D-35 / CP-35: a deterministic draft plan for the remaining degree. Expected values come from hand counts and the committed
data files (see tests/plan_fixtures.py), not from running the generator."""
import json
import re
import unittest
from copy import deepcopy
from decimal import Decimal
from pathlib import Path
from coursepath.data_sources.official_timetables import load_committed_snapshots
from coursepath.degree_audit import evaluate_audit
from coursepath.identity import identity_map, canonical_code
from coursepath.models import term_key
from coursepath.plan_generation import generate_plan
from coursepath.prerequisites import load_recommended_prerequisites
from coursepath.rules.loader import load_curriculum
from coursepath.rules.schema import walk_requirements
from tests.plan_fixtures import CORE_PENDING, synthetic_attempts, attempt

ROOT = Path(__file__).resolve().parents[2]
CURRICULUM = load_curriculum()
SNAPSHOTS = load_committed_snapshots(ROOT / 'data' / 'offerings')
CATALOGUE = load_recommended_prerequisites()
RAW = json.loads((ROOT / 'data/curricula/cse-2024.json').read_text(encoding='utf-8'))
LEAVES = {r['id']: r for r in walk_requirements(RAW['requirements']) if not r.get('children')}
THEORY, SYSTEMS = set(LEAVES['theory']['course_ids']), set(LEAVES['systems']['course_ids'])
PROJECT = re.compile(LEAVES['open-project']['course_patterns'][0])
D = Decimal


def context(attempts, **extra):
    return {'curriculum': CURRICULUM, 'attempts': attempts, 'current_enrolment': [], 'catalogue': CATALOGUE, 'offering_snapshots': SNAPSHOTS,
            'standing': 'unknown', 'record_revision': 1, **extra}


def courses(result):
    return [p for p in result['placements'] if p['kind'] == 'course']


def snapshot_codes(term):
    return {o['code'] for s in SNAPSHOTS if s['term_id'] == term for o in s['offerings']}


def pending_leaves(attempts, result):
    audit = evaluate_audit(CURRICULUM, {}, {'attempts': attempts}, {'semesters': result['semesters']})
    found = []
    any_of = {r['id'] for r in walk_requirements(RAW['requirements']) if r['type'] == 'any_of'}

    def walk(nodes):
        for node in nodes:
            if node['children']:
                if node['id'] in any_of and node['status'] in {'satisfied', 'conditional'}:
                    continue  # the other alternatives of a satisfied any-of are not required
                walk(node['children'])
            elif node['status'] == 'pending':
                found.append(node['id'])
    walk(audit['projected'])
    return found


class PlanGenerationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.attempts = synthetic_attempts()
        cls.result = generate_plan(context(cls.attempts))

    def test_cp35_remaining_credits_match_the_hand_count(self):
        # 170 total - 92 completed (tests/plan_fixtures.py docstring)
        self.assertEqual(self.result['summary']['remaining_before'], '78')

    def test_cp35_default_terms_are_the_next_regular_terms_up_to_eight_semesters(self):
        self.assertEqual(self.result['options']['terms'], ['2026-27-I', '2026-27-II', '2027-28-I', '2027-28-II'])
        self.assertEqual(self.result['options']['target_credits_per_term'], '28')   # D-40 (8 Nov): semesters are packed to the 28-credit limit
        self.assertEqual(self.result['options']['max_credits_per_term'], '28')   # D-36 (7 Nov): a semester never holds more than 28 credits

    def test_cp35_every_pending_core_course_is_placed_once_in_a_term_that_offers_it(self):
        placed = {p['normalized_code']: p for p in courses(self.result)}
        for code in CORE_PENDING:
            with self.subTest(code=code):
                self.assertIn(code, placed)
                term = placed[code]['term_id']
                if term in {s['term_id'] for s in SNAPSHOTS}:
                    self.assertIn(code, snapshot_codes(term))
                    self.assertEqual(placed[code]['basis'], 'confirmed_offering')
                self.assertEqual(placed[code]['requirement_id'], {'CS 201': 'toc', 'CS 329': 'ai', 'CS 330': 'os', 'CS 331': 'networks'}[code])

    def test_cp35_basket_minimums_hold_for_theory_and_systems(self):
        placed = courses(self.result)
        theory = sum(D(p['credits']) for p in placed if p['normalized_code'] in THEORY)
        systems = sum(D(p['credits']) for p in placed if p['normalized_code'] in SYSTEMS)
        self.assertGreaterEqual(theory, 8)
        self.assertGreaterEqual(systems, 8)

    def test_cp35_nothing_is_silently_dropped(self):
        unmet = {u['requirement_id'] for u in self.result['unmet']}
        self.assertLessEqual(set(pending_leaves(self.attempts, self.result)), unmet)
        # D-40: open-ended electives are held as credits for the student to fill. Nothing may be left uncovered, and every credit the placed
        # courses do not cover is held by a placeholder (hand count: 78 remaining).
        for entry in self.result['unmet']:
            self.assertEqual((entry['reason_code'], entry['remaining_credits']), ('STUDENT_CHOICE', '0'), entry)
            self.assertTrue(entry['placeholder_ids'], entry)
        self.assertEqual(self.result['summary']['remaining_after'], self.result['summary']['placeholder_credits'])
        self.assertTrue(self.result['summary']['complete'])

    def test_cp35_placed_courses_are_new_unique_and_never_cross_a_complete_snapshot(self):
        identity = identity_map(CURRICULUM.get('identity_groups'))
        done = {canonical_code(a['normalized_code'], identity) for a in self.attempts}
        codes = [p['normalized_code'] for p in courses(self.result)]
        self.assertEqual(len(codes), len(set(codes)))
        self.assertFalse(done & {canonical_code(c, identity) for c in codes})
        for placement in courses(self.result):
            if placement['term_id'] in {s['term_id'] for s in SNAPSHOTS}:
                self.assertIn(placement['normalized_code'], snapshot_codes(placement['term_id']), placement)

    def test_cp35_load_never_exceeds_the_default_maximum(self):
        for term, row in self.result['validation']['workload'].items():
            self.assertLessEqual(D(row['target_credits']), 28, term)

    def test_cp35_summary_arithmetic_is_consistent(self):
        summary = self.result['summary']
        placed = sum(D(p['credits']) for p in courses(self.result))
        placeholders = sum(D(p['credits']) for p in self.result['placements'] if p['kind'] == 'placeholder')
        self.assertEqual(D(summary['placed_credits']), placed)
        self.assertEqual(D(summary['placeholder_credits']), placeholders)
        self.assertEqual(D(summary['total_credits']), placed + placeholders)
        self.assertEqual(sum(D(v) for v in summary['credits_by_term'].values()), placed + placeholders)
        self.assertEqual(summary['terms'], [s['term_id'] for s in self.result['semesters']])

    def test_cp35_the_plan_validates_without_an_error(self):
        self.assertEqual([i for i in self.result['validation']['issues'] if i['severity'] == 'error'], [])

    def test_cp35_same_input_gives_the_same_plan_and_never_mutates_the_input(self):
        ctx = context(deepcopy(self.attempts))
        before = deepcopy(ctx)
        first, second = generate_plan(ctx), generate_plan(deepcopy(ctx))
        self.assertEqual(json.dumps(first, sort_keys=True), json.dumps(second, sort_keys=True))
        self.assertEqual(json.dumps(first, sort_keys=True), json.dumps(self.result, sort_keys=True))
        self.assertEqual(ctx, before)

    def test_cp35_semesters_are_ready_for_the_plan_save_path(self):
        from coursepath.validation import plan_payload
        saved = plan_payload({'semesters': self.result['semesters']})
        self.assertEqual(len(saved['semesters']), len(self.result['semesters']))

    def test_cp35_every_placement_is_explained(self):
        for placement in self.result['placements']:
            self.assertTrue(placement['reason'].strip(), placement)
            self.assertTrue(placement['requirement_id'])
        notice = self.result['notice'].lower()
        self.assertIn('suggest', notice)


class RecommendedPreparationOrderTests(unittest.TestCase):
    def test_cp35_a_recommended_course_is_planned_before_its_dependent_when_both_are_pending(self):
        self.assertEqual(CATALOGUE['CS 201']['prerequisites'], {'type': 'course', 'course_id': 'ES 214', 'source_refs': ['team-recommendation']})
        attempts = synthetic_attempts(without=('ES 214',))
        result = generate_plan(context(attempts))
        placed = {p['normalized_code']: p for p in courses(result)}
        self.assertIn('ES 214', placed)
        self.assertIn('CS 201', placed)
        # D-48 (10 Nov, requested by Manashree): a core course is never delayed because its recommended preparation is missing. ES 214 and CS 201 are
        # both offered only in even semesters in 2026-27, so the preparation can be earlier only by pushing CS 201 a whole year; it now shares the
        # semester and the plan check warns, naming ES 214 (tests/domain/test_core_in_year.py).
        self.assertLessEqual(term_key(placed['ES 214']['term_id']), term_key(placed['CS 201']['term_id']))


class OfferingBasisTests(unittest.TestCase):
    def test_cp35_later_terms_are_expected_patterns_and_official_terms_are_confirmed(self):
        attempts = synthetic_attempts()
        result = generate_plan(context(attempts), {'target_credits_per_term': '12', 'max_credits_per_term': '12'})
        official = {s['term_id'] for s in SNAPSHOTS}
        later = [p for p in courses(result) if p['term_id'] not in official]
        self.assertTrue(later)
        for placement in courses(result):
            if placement['term_id'] in official:
                self.assertEqual(placement['basis'], 'confirmed_offering')
                self.assertTrue(placement['offering_ids'])
            else:
                parity = placement['term_id'].rsplit('-', 1)[1]
                self.assertEqual(placement['basis'], 'expected_pattern')
                self.assertIn(placement['normalized_code'], snapshot_codes(f'2026-27-{parity}'))
                self.assertEqual(placement['offering_ids'], [])
        for semester in result['semesters']:
            self.assertLessEqual(D(result['validation']['workload'][semester['term_id']]['target_credits']), 12)
        self.assertTrue([u for u in result['unmet'] if u['reason_code'] == 'NO_CAPACITY'])  # 78 credits cannot fit four 12-credit terms
        for u in result['unmet']:   # every entry is either a gap for lack of room or a requirement whose credits the plan holds
            self.assertTrue(u['reason_code'] == 'NO_CAPACITY' or (u['reason_code'] == 'STUDENT_CHOICE' and u['placeholder_ids']), u)
        self.assertFalse(result['summary']['complete'])
        self.assertLessEqual(D(result['summary']['total_credits']), 48)

    def test_cp35_current_enrolment_counts_and_moves_the_start(self):
        enrolment = [{'id': 'cur1', 'normalized_code': 'CS 330', 'term_id': '2026-27-I', 'credits': '4', 'confirmed': True}]
        result = generate_plan(context(synthetic_attempts(), current_enrolment=enrolment))
        self.assertEqual(result['options']['terms'], ['2026-27-II', '2027-28-I', '2027-28-II'])
        self.assertNotIn('CS 330', [p['normalized_code'] for p in courses(result)])
        self.assertEqual(result['summary']['remaining_before'], '74')  # 78 minus the four-credit core course already being taken

    def test_cp35_skipped_terms_get_nothing_and_the_horizon_extends(self):
        result = generate_plan(context(synthetic_attempts()), {'skip_terms': ['2026-27-I']})
        self.assertEqual(result['options']['terms'], ['2026-27-II', '2027-28-I', '2027-28-II', '2028-29-I'])
        self.assertNotIn('2026-27-I', [s['term_id'] for s in result['semesters']])
        self.assertEqual(result['options']['skip_terms'], ['2026-27-I'])

    def test_cp35_the_load_limit_is_28_whatever_the_standing(self):
        # D-36 (7 Nov) replaces the GPS 21-credit rule: the limit is always 28 and no standing is assumed or mentioned.
        for standing in ('GPS', 'regular', 'unknown'):
            result = generate_plan(context(synthetic_attempts(), standing=standing))
            self.assertEqual(result['options']['max_credits_per_term'], '28')
            self.assertFalse(any('standing' in a.lower() for a in result['assumptions']))
            for row in result['validation']['workload'].values():
                self.assertLessEqual(D(row['target_credits']), 28)

    def test_cp35_an_invalid_option_is_rejected(self):
        for bad in ({'unknown_option': 1}, {'terms': ['2026-27-X']}, {'max_credits_per_term': '-1'}, {'target_credits_per_term': '30', 'max_credits_per_term': '24'},
                    {'skip_terms': 'x'}, {'max_credits_per_term': '40'}):
            with self.subTest(options=bad), self.assertRaises(ValueError):
                generate_plan(context(synthetic_attempts()), bad)


class NeverInventTests(unittest.TestCase):
    def snapshots_with_extras(self):
        snapshots = deepcopy(SNAPSHOTS)
        first = next(s for s in snapshots if s['term_id'] == '2026-27-I')
        base = deepcopy(first['offerings'][0])
        for code, credits, title in [('SC 372', '1', 'One-credit short course'), ('CS 399', '4', 'CS project'), ('XX 001', '0', 'Zero-credit non-PE'),
                                     ('IN 498', '4', 'External exposure module'), ('XX 098', '1', 'One-credit elective')]:
            extra = {**deepcopy(base), 'code': code, 'display_code': code, 'id': '2026-27-I:' + code.replace(' ', ''), 'credits': credits, 'title': title,
                     'meeting_groups': [], 'availability_status': 'confirmed_in_snapshot'}
            first['offerings'].append(extra)
        return snapshots

    def test_cp35_excluded_zero_credit_project_and_exposure_courses_are_never_suggested(self):
        result = generate_plan(context(synthetic_attempts(), offering_snapshots=self.snapshots_with_extras()))
        placed = {p['normalized_code'] for p in courses(result)}
        self.assertFalse(placed & {'SC 372', 'CS 399', 'XX 001', 'IN 498', 'XX 098'}, placed)
        self.assertFalse([c for c in placed if PROJECT.search(c)])

    def test_cp35_preparatory_courses_are_not_suggested_as_electives(self):
        offered_prep = {o['code'] for s in SNAPSHOTS for o in s['offerings'] if int(re.search(r'\d+', o['code'])[0]) < 100}
        self.assertTrue(offered_prep)  # the official lists really contain them (HS 001, CH 001, ...)
        result = generate_plan(context(synthetic_attempts()))
        self.assertFalse({p['normalized_code'] for p in courses(result)} & offered_prep)

    def test_cp35_a_missing_project_becomes_a_placeholder_with_a_reason_never_an_invented_course(self):
        attempts = synthetic_attempts(without=('CS 299',))
        result = generate_plan(context(attempts))
        self.assertEqual(result['summary']['remaining_before'], '82')
        entry = next(u for u in result['unmet'] if u['requirement_id'] == 'open-project')
        self.assertEqual((entry['reason_code'], entry['remaining_credits']), ('STUDENT_CHOICE', '4'))
        self.assertEqual(len(entry['placeholder_ids']), 1)
        holders = [p for s in result['semesters'] for p in s['placeholders'] if p['requirement_id'] == 'open-project']
        self.assertEqual([(p['requirement_id'], p['desired_credits']) for p in holders], [('open-project', '4')])
        placement = next(p for p in result['placements'] if p['kind'] == 'placeholder' and p['requirement_id'] == 'open-project')
        self.assertEqual((placement['basis'], placement['normalized_code']), ('student_choice', None))
        self.assertFalse([p for p in courses(result) if PROJECT.search(p['normalized_code'])])
        self.assertEqual(result['issues'][0]['code'], 'REQUIREMENT_UNMET')

    def test_cp35_missing_physical_education_is_scheduled_one_per_term_from_the_timetables(self):
        attempts = synthetic_attempts(without=('PE 103', 'PE 104'))
        result = generate_plan(context(attempts))
        pe = [p for p in courses(result) if p['normalized_code'].startswith('PE ')]
        self.assertEqual(len(pe), 2)
        self.assertEqual(len({p['term_id'] for p in pe}), 2)
        self.assertEqual({p['requirement_id'] for p in pe}, {'pe'})
        for p in pe:
            self.assertEqual(p['credits'], '0')
            if p['term_id'] in {s['term_id'] for s in SNAPSHOTS}:
                self.assertIn(p['normalized_code'], snapshot_codes(p['term_id']))

    def test_cp35_a_requirement_nothing_offers_is_reported_with_its_reason(self):
        empty = [{**deepcopy(s), 'offerings': [o for o in s['offerings'] if o['code'] not in THEORY]} for s in SNAPSHOTS]
        result = generate_plan(context(synthetic_attempts(), offering_snapshots=empty))
        entry = next(u for u in result['unmet'] if u['requirement_id'] == 'theory')
        self.assertEqual((entry['reason_code'], entry['remaining_credits']), ('NO_OFFERED_COURSE', '8'))
        self.assertFalse([p for p in courses(result) if p['normalized_code'] in THEORY])
        self.assertFalse(result['summary']['complete'])

    def test_cp35_an_open_ended_elective_is_held_as_credits_even_when_no_course_is_listed(self):
        # D-40: HSS electives take any HS course, so the plan holds the 8 credits for the student rather than claiming nothing fits.
        empty = [{**deepcopy(s), 'offerings': [o for o in s['offerings'] if not o['code'].startswith('HS ')]} for s in SNAPSHOTS]
        result = generate_plan(context(synthetic_attempts(), offering_snapshots=empty))
        held = [p for s in result['semesters'] for p in s['placeholders'] if p['requirement_id'] == 'hss-other']
        self.assertEqual(sum(D(p['desired_credits']) for p in held), 8)
        self.assertEqual({p['label'] for p in held}, {'HSS elective'})
        self.assertFalse([p for p in courses(result) if p['normalized_code'].startswith('HS ')])


def tiny_curriculum(rules):
    """A reviewed two-rule curriculum on the real sources; rules are (id, course_ids or None for any course)."""
    requirements = [{'id': rid, 'type': 'minimum_credits', 'minimum_credits': '4', 'source_refs': ['adv13'], 'label': rid,
                     **({'course_ids': ids} if ids else {'any_course': True})} for rid, ids in rules]
    return {'id': 'tiny', 'version': 'tiny-v1', 'cohort': CURRICULUM['cohort'], 'review_status': 'reviewed', 'sources': deepcopy(CURRICULUM['sources']),
            'total_credits': str(4 * len(requirements)), 'requirements': requirements}


def tiny_snapshot(codes, term='2026-27-I'):
    return {'id': 'tiny-' + term, 'term_id': term, 'review_status': 'reviewed', 'coverage': 'complete', 'source_refs': [],
            'offerings': [{'id': f"{term}:{c.replace(' ', '')}", 'code': c, 'title': 'Tiny ' + c, 'credits': '4', 'availability_status': 'confirmed_in_snapshot',
                           'meeting_groups': [], 'source_refs': []} for c in codes]}


class NarrowBasketTests(unittest.TestCase):
    def tiny(self, rules, codes, options):
        ctx = {'curriculum': tiny_curriculum(rules), 'attempts': [], 'current_enrolment': [], 'catalogue': {}, 'offering_snapshots': [tiny_snapshot(codes)],
               'standing': 'regular', 'record_revision': 1}
        return generate_plan(ctx, {'terms': ['2026-27-I'], **options})

    def test_cp35_a_course_that_fits_two_baskets_goes_to_the_one_nothing_else_can_fill(self):
        # First-match greedy would give AA 101 to the first-listed basket and leave the second empty although AA 102 could fill the first.
        result = self.tiny([('wide', ['AA 101', 'AA 102']), ('narrow', ['AA 101'])], ['AA 101', 'AA 102'], {})
        self.assertEqual(result['unmet'], [])
        by_code = {p['normalized_code']: p['requirement_id'] for p in courses(result)}
        self.assertEqual(by_code, {'AA 101': 'narrow', 'AA 102': 'wide'})

    def test_cp35_a_full_term_spends_its_credits_on_the_narrower_requirement(self):
        # One four-credit slot, two open requirements. AA 101 sorts first by level and code and fits only the flexible rule; ZZ 201 fits only the narrow one.
        # A generator that serves requirements in listed order, or picks by code alone, spends the slot on AA 101 and leaves the narrow basket empty.
        result = self.tiny([('open', None), ('narrow', ['ZZ 201'])], ['AA 101', 'ZZ 201'], {'max_credits_per_term': '4', 'target_credits_per_term': '4'})
        self.assertEqual({p['normalized_code']: p['requirement_id'] for p in courses(result)}, {'ZZ 201': 'narrow'})
        self.assertEqual([(u['requirement_id'], u['reason_code']) for u in result['unmet']], [('open', 'NO_CAPACITY')])


if __name__ == '__main__':
    unittest.main()
