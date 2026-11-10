"""CR-105 (CP-21, CP-24, CP-05): confirmed current enrolment counts in the load and the clash check of its own term, as well as being earlier
preparation for later terms. Hand counts: a regular term is limited to 28 credits (D-36); every course here is 4 credits."""
import unittest
from coursepath.semester_plan import validate_plan
from tests.domain.test_offerings import hand_snapshot, meeting

TERM = '2026-27-I'


def enrolled(count, term=TERM, confirmed=True, start=1):
    return [{'id': f'ce{n}', 'normalized_code': f'ZZ {100 + n}', 'term_id': term, 'credits': '4', 'confirmed': confirmed} for n in range(start, start + count)]


def planned(*codes, term=TERM):
    return {'semesters': [{'term_id': term, 'courses': [{'id': f'p{n}', 'normalized_code': code, 'credits': '4'} for n, code in enumerate(codes)]}]}


def check(rows, plan, snapshots=None):
    return validate_plan({'attempts': [], 'current_enrolment': rows, 'simple_load': True}, plan, snapshots)


def codes(result):
    return [i['code'] for i in result['issues']]


class SameTermLoad(unittest.TestCase):
    def test_24_enrolled_plus_8_planned_credits_in_one_term_is_over_the_limit(self):
        result = check(enrolled(6), planned('ZZ 301', 'ZZ 302'))
        self.assertIn('LOAD_LIMIT', codes(result))
        self.assertEqual(result['workload'][TERM], {'selected_credits': '8', 'enrolled_credits': '24', 'placeholder_credits': '0', 'target_credits': '32'})

    def test_unconfirmed_enrolment_does_not_count_toward_the_load(self):
        result = check(enrolled(6, confirmed=False), planned('ZZ 301', 'ZZ 302'))
        self.assertNotIn('LOAD_LIMIT', codes(result))
        self.assertEqual(result['workload'][TERM]['target_credits'], '8')

    def test_enrolment_in_another_term_does_not_count_toward_this_terms_load(self):
        result = check(enrolled(6, term='2026-27-II'), planned('ZZ 301', 'ZZ 302'))
        self.assertNotIn('LOAD_LIMIT', codes(result))

    def test_a_course_both_enrolled_and_planned_is_counted_once(self):
        # 24 enrolled + the same ZZ 101 planned again + ZZ 301 = 28 credits (not 32): at the limit, not over it.
        result = check(enrolled(6), planned('ZZ 101', 'ZZ 301'))
        self.assertNotIn('LOAD_LIMIT', codes(result))
        self.assertEqual(result['workload'][TERM]['target_credits'], '28')
        self.assertEqual(result['workload'][TERM]['enrolled_credits'], '20')


class SameTermClashes(unittest.TestCase):
    def snapshot(self, enrolled_slot, planned_slot):
        return [hand_snapshot(('ZZ 101', 'all_required', [meeting('m-enrolled', *enrolled_slot)]),
                              ('ZZ 301', 'all_required', [meeting('m-planned', *planned_slot)]))]

    def test_a_planned_course_in_the_same_slot_as_an_enrolled_one_clashes(self):
        result = check(enrolled(1), planned('ZZ 301'), self.snapshot((1, 510, 590), (1, 540, 620)))
        self.assertIn('TIMETABLE_CONFLICT', codes(result))
        self.assertEqual(result['meeting_checks'][TERM]['status'], 'conflicts')
        self.assertEqual(sorted(result['meeting_checks'][TERM]['conflicts'][0]['item_ids']), ['ZZ 101', 'p0'])

    def test_touching_times_do_not_clash(self):
        result = check(enrolled(1), planned('ZZ 301'), self.snapshot((1, 510, 590), (1, 590, 670)))
        self.assertNotIn('TIMETABLE_CONFLICT', codes(result))
        self.assertEqual(result['meeting_checks'][TERM]['status'], 'clear')

    def test_unconfirmed_enrolment_does_not_clash(self):
        result = check(enrolled(1, confirmed=False), planned('ZZ 301'), self.snapshot((1, 510, 590), (1, 540, 620)))
        self.assertNotIn('TIMETABLE_CONFLICT', codes(result))

    def test_two_enrolled_courses_that_clash_with_each_other_are_not_a_plan_problem(self):
        snapshots = [hand_snapshot(('ZZ 101', 'all_required', [meeting('a', 1, 510, 590)]), ('ZZ 102', 'all_required', [meeting('b', 1, 510, 590)]),
                                   ('ZZ 301', 'all_required', [meeting('c', 2, 510, 590)]))]
        result = check(enrolled(2), planned('ZZ 301'), snapshots)
        self.assertNotIn('TIMETABLE_CONFLICT', codes(result))
