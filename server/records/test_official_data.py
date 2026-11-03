"""The committed official timetables and calendar through the API (CP-23, CP-24, CP-33; D-22 to D-25).

Slots and dates are from the committed sources: CS 432 and BE 304 both meet in P1, P2
(Wed and Fri 17:00-18:20) all of Semester II 2026-27; Semester II ends with Examination II
on 30 Apr 2027 and the summer term runs 7 May to 2 Jul 2027.
"""
import io
import json
import tempfile
from pathlib import Path
from django.core.management import call_command
from django.test import Client, TestCase, override_settings
from jsonschema import Draft202012Validator, FormatChecker
from server.records.services import SCHEMA
from server.records.testing import AccountAPIMixin
from tests.domain.test_offerings import adapter_snapshot

VALIDATOR = Draft202012Validator(SCHEMA, format_checker=FormatChecker())


def valid(test, response):
    test.assertFalse([e.message for e in VALIDATOR.iter_errors(response.json())][:3])
    return response.json()


class OfficialTimetableAPITests(AccountAPIMixin, TestCase):
    def load(self, term_id, *flags):
        snapshot = {**adapter_snapshot(), 'term_id': term_id, 'id': 'synthetic-' + term_id}
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'snapshot.json'
            path.write_text(json.dumps(snapshot))
            call_command('load_offerings', str(path), *flags, stdout=io.StringIO())

    def served(self, term_id):
        return valid(self, Client().get('/api/v1/offerings', {'term_id': term_id}))

    def test_cp23_committed_official_timetables_are_served_until_staff_load_a_reviewed_one(self):
        body = self.served('2026-27-II')
        data = body['data']
        self.assertEqual((data['id'], data['review_status'], data['coverage'], body['issues']), ('timetable-2026-27-II', 'reviewed', 'complete', []))
        self.assertIn('2026-27-II:CS432', [o['id'] for o in data['offerings']])
        self.load('2026-27-II', '--draft')
        self.assertEqual(self.served('2026-27-II')['data']['id'], 'timetable-2026-27-II')  # a draft never replaces the official list
        self.load('2026-27-II', '--reviewed')
        self.assertEqual(self.served('2026-27-II')['data']['id'], 'synthetic-2026-27-II')
        self.assertEqual(self.served('2027-28-I')['data']['offerings'], [])  # nothing is published for later terms

    @override_settings(COURSEPATH_OFFERINGS_DIR=None)
    def test_cp23_switching_the_committed_data_off_leaves_availability_unknown(self):
        body = self.served('2026-27-I')
        self.assertEqual((body['data']['coverage'], body['data']['offerings']), ('unknown', []))
        self.assertIn('OFFERING_UNKNOWN', [i['code'] for i in body['issues']])

    def test_cp24_plan_validation_uses_the_official_timetable_and_the_same_parity_hint(self):
        self.signup(self.client, 'official-planner')
        semesters = [{'term_id': '2026-27-II', 'courses': [{'id': 'db', 'normalized_code': 'CS 432', 'credits': '4'}, {'id': 'bio', 'normalized_code': 'BE 304', 'credits': '4'}]},
                     {'term_id': '2027-28-II', 'courses': [{'id': 'again', 'normalized_code': 'CS 432', 'credits': '4'}]}]
        plan = self.request(self.client, 'post', '/plans', {'semesters': semesters}).json()['data']
        result = valid(self, self.request(self.client, 'post', '/plans/' + plan['id'] + '/validate', {'record_revision': 0, 'plan_revision': 0}))['data']
        self.assertEqual(result['meeting_checks']['2026-27-II']['status'], 'conflicts')
        self.assertEqual([c['certain'] for c in result['meeting_checks']['2026-27-II']['conflicts']], [True, True])
        rows = {row['id']: row['offering_status'] for row in result['per_course']}
        self.assertEqual(rows, {'db': 'confirmed_in_snapshot', 'bio': 'confirmed_in_snapshot', 'again': 'historical'})
        self.assertEqual(result['meeting_checks']['2027-28-II']['status'], 'not_checked')


class CalendarAPITests(AccountAPIMixin, TestCase):
    def test_cp33_the_calendar_and_internship_presets_are_public(self):
        body = valid(self, Client().get('/api/v1/calendar'))
        data = body['data']
        self.assertEqual([t['id'] for t in data['terms']], ['2026-27-I', '2026-27-II', '2026-27-SUMMER'])
        self.assertEqual((data['terms'][1]['end_date_exclusive'], data['terms'][2]['start_date']), ('2027-05-01', '2027-05-07'))
        self.assertEqual([(p['duration_choice'], p['preset'], p['start_date']) for p in data['internship_presets']],
                         [('three_months', 'summer', '2027-05-01'), ('six_months', 'summer', '2027-05-01'), ('six_months', 'semester', '2027-07-01')])
        # Later years are not published, and the response says so instead of implying no overlap.
        self.assertEqual([(i['code'], i['severity']) for i in body['issues']], [('CALENDAR_MISSING', 'unknown')])

    @override_settings(COURSEPATH_CALENDAR_DIR=None)
    def test_cp33_without_a_calendar_there_are_no_presets(self):
        body = valid(self, Client().get('/api/v1/calendar'))
        self.assertEqual((body['data']['terms'], body['data']['internship_presets']), ([], []))
        self.assertIn('CALENDAR_MISSING', [i['code'] for i in body['issues']])

    def test_cp33_internship_comparison_checks_published_terms_and_flags_later_ones(self):
        self.signup(self.client, 'calendar-intern')
        semesters = [{'term_id': '2026-27-SUMMER', 'courses': [{'id': 'summer', 'normalized_code': 'ZZ 301', 'credits': '4'}]},
                     {'term_id': '2027-28-I', 'courses': [{'id': 'autumn', 'normalized_code': 'CS 331', 'credits': '4'}]}]
        plan = self.request(self.client, 'post', '/plans', {'semesters': semesters}).json()['data']
        internship = {'duration_choice': 'three_months', 'preset': 'summer', 'start_date': '2027-05-01', 'end_date_exclusive': '2027-08-01', 'placement_mode': 'onsite_full_time'}
        scenario = self.request(self.client, 'post', '/scenarios', {'plan_id': plan['id'], 'internship': internship}).json()['data']
        compared = valid(self, self.request(self.client, 'post', '/scenarios/compare', {'scenario_ids': [scenario['id']]}))
        case = compared['data']['internship_cases'][0]
        self.assertEqual([(t['term_id'], t['exam_overlap']) for t in case['overlapping_terms']], [('2026-27-SUMMER', True)])
        self.assertEqual((case['affected_courses'], case['unchecked_courses']), (['summer'], ['autumn']))
