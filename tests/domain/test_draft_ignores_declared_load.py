"""CP-44 (D-56, D-36): a draft check has one 28-credit limit whatever standing or advisor cap the student declared; a saved-plan check applies the
declared GPS limit (21) and advisor cap (ADV13 p. 7). Counted by hand: six 4-credit courses are 24 credits, seven are 28."""
import unittest
from coursepath.semester_plan import validate_plan


def semester(count):
    return [{'term_id': '2027-28-I', 'courses': [{'id': f'c{n}', 'normalized_code': f'ZZ {100 + n}', 'credits': '4'} for n in range(count)], 'placeholders': []}]


def limit_messages(simple, count, **context):
    result = validate_plan({'attempts': [], 'catalogue': {}, 'simple_load': simple, **context}, {'semesters': semester(count)})
    return [i['message'] for i in result['issues'] if i['code'] == 'LOAD_LIMIT']


class DraftIgnoresDeclaredLoadTests(unittest.TestCase):
    def test_cp44_a_gps_student_gets_no_21_credit_error_in_a_draft(self):
        self.assertEqual(limit_messages(True, 6, standing='GPS'), [])

    def test_cp44_the_same_gps_student_gets_it_in_a_saved_plan(self):
        self.assertEqual(limit_messages(False, 6, standing='GPS'), ['Target workload exceeds the 21-credit limit.'])

    def test_cp44_an_advisor_cap_does_not_limit_a_draft_but_limits_a_saved_plan(self):
        self.assertEqual(limit_messages(True, 6, advisor_cap='20'), [])
        self.assertEqual(limit_messages(False, 6, advisor_cap='20'), ['Target workload exceeds the 20-credit limit.'])

    def test_cp44_a_draft_still_stops_at_28_credits_for_everyone(self):
        self.assertEqual(limit_messages(True, 7, standing='GPS', advisor_cap='20'), [])
        self.assertEqual(limit_messages(True, 8, standing='GPS', advisor_cap='20'), ['Target workload exceeds the 28-credit limit.'])


if __name__ == '__main__':
    unittest.main()
