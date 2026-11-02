import io
import json
import tempfile
from pathlib import Path
from django.core.management import call_command, CommandError
from django.test import Client, TestCase
from jsonschema import Draft202012Validator, FormatChecker
from server.records.services import SCHEMA
from server.records.testing import AccountAPIMixin
from tests.domain.test_offerings import adapter_snapshot, TERM


class OfferingAPITests(AccountAPIMixin, TestCase):
    def load(self, snapshot, *flags):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'snapshot.json'
            path.write_text(json.dumps(snapshot))
            call_command('load_offerings', str(path), *flags, stdout=io.StringIO())

    def test_cp23_offerings_unknown_until_a_snapshot_is_loaded(self):
        client = Client()
        empty = client.get('/api/v1/offerings', {'term_id': TERM})
        self.assertEqual(empty.status_code, 200)
        self.assertEqual((empty.json()['data']['coverage'], empty.json()['data']['offerings']), ('unknown', []))
        self.assertIn('OFFERING_UNKNOWN', [i['code'] for i in empty.json()['issues']])
        self.assertEqual(client.get('/api/v1/offerings', {'term_id': '2026-I'}).status_code, 400)
        self.assertEqual(client.get('/api/v1/offerings').status_code, 400)
        snapshot = adapter_snapshot()
        with self.assertRaises(CommandError):
            self.load(snapshot)  # a draft needs an explicit --draft
        self.load(snapshot, '--reviewed', '--coverage', 'complete')
        loaded = client.get('/api/v1/offerings', {'term_id': TERM}).json()
        self.assertEqual((loaded['data']['review_status'], loaded['data']['coverage']), ('reviewed', 'complete'))
        self.assertIn('CS 331', [o['code'] for o in loaded['data']['offerings']])
        self.assertEqual(client.get('/api/v1/offerings', {'term_id': '2026-27-II'}).json()['data']['offerings'], [])
        self.assertFalse(list(Draft202012Validator(SCHEMA, format_checker=FormatChecker()).iter_errors(loaded)))
        with self.assertRaises(CommandError):
            self.load(snapshot, '--reviewed', '--coverage', 'complete')  # a stored version is never overwritten
        broken = adapter_snapshot()
        broken['offerings'][0]['meeting_groups'][0]['selection_semantics'] = 'maybe'
        with self.assertRaises(CommandError):
            self.load(broken, '--draft')

    def test_cp24_saved_plan_validation_uses_the_stored_snapshot(self):
        self.load(adapter_snapshot(), '--reviewed', '--coverage', 'partial')
        self.signup(self.client, 'clash-student')
        semesters = [{'term_id': TERM, 'courses': [{'id': 'p', 'normalized_code': 'PH 202', 'credits': '4'},
                                                   {'id': 'e', 'normalized_code': 'ES 667', 'credits': '4'}]},
                     {'term_id': '2026-27-II', 'courses': [{'id': 'n', 'normalized_code': 'CS 331', 'credits': '4'}]}]
        created = self.request(self.client, 'post', '/plans', {'semesters': semesters})
        validation = created.json()['data']['validation']
        self.assertEqual(validation['meeting_checks'][TERM]['status'], 'conflicts')
        self.assertEqual(validation['meeting_checks']['2026-27-II']['status'], 'not_checked')
        rows = {r['id']: r for r in validation['per_course']}
        self.assertEqual((rows['p']['offering_status'], rows['n']['offering_status']), ('confirmed_in_snapshot', 'unknown'))
        plan = created.json()['data']
        checked = self.request(self.client, 'post', f"/plans/{plan['id']}/validate", {'record_revision': 0, 'plan_revision': plan['revision']})
        self.assertEqual(checked.json()['data']['meeting_check_status'], 'conflicts')
