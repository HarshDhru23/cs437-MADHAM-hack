"""CP-45 (issue: the six-row synthetic IMS sample used made-up course codes, so nothing counted and no plan could be finished): the synthetic example is the
made-up student of `data/demo/sample-student.json` (real course codes, invented grades, 92 credits) written as an IMS grade table, so a reviewer with no data
of their own can import it and explore every feature. Expected totals are counted by hand from tests/plan_fixtures.py: 92 of 170 credits, 78 remaining."""
import json
import subprocess
import sys
from pathlib import Path

from django.conf import settings
from django.test import Client, TestCase

from server.records.testing import AccountAPIMixin

ROOT = Path(settings.BASE_DIR)
SAMPLE_TS = ROOT / 'frontend' / 'src' / 'features' / 'import' / 'syntheticSample.ts'
SAMPLE = json.loads((ROOT / 'data' / 'demo' / 'sample-student.json').read_text(encoding='utf-8'))


def table():
    text = SAMPLE_TS.read_text(encoding='utf-8')
    return json.loads(text.split('export const SYNTHETIC_SAMPLE = ', 1)[1].rsplit(';', 1)[0])


def key(a):
    return (a['normalized_code'], a['term_id'], a['credits'], a['grade'])


class SyntheticExampleTests(AccountAPIMixin, TestCase):
    def student(self, name):
        client = Client()
        self.signup(client, name)
        return client

    def import_table(self, client, text):
        record = client.get('/api/v1/record').json()['data']
        preview = self.request(client, 'post', '/imports/preview', {'kind': 'ims', 'text': text, 'expected_revision': record['revision']})
        self.assertEqual(preview.status_code, 201, preview.content)
        data = preview.json()['data']
        commit = self.request(client, 'post', f"/imports/{data['id']}/commit",
                              {'expected_revision': record['revision'], 'accepted_candidate_ids': [a['id'] for a in data['candidate_attempts']], 'resolutions': {}})
        self.assertEqual(commit.status_code, 200, commit.content)
        return preview.json(), commit.json()['data']

    def analysis(self, client):
        revision = client.get('/api/v1/record').json()['data']['revision']
        response = self.request(client, 'post', '/analysis', {'record_revision': revision})
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()['data']

    def test_cp45_the_file_the_page_pastes_is_generated_from_the_made_up_student(self):
        result = subprocess.run([sys.executable, str(ROOT / 'scripts' / 'gen_synthetic_sample.py'), '--check'], capture_output=True)
        self.assertEqual(result.returncode, 0, 'run python scripts/gen_synthetic_sample.py')

    def test_cp45_the_table_has_the_ims_header_and_one_row_per_attempt_newest_first(self):
        rows = table().split('\n')
        self.assertEqual(rows[0], 'Academic Period\tCourse No\tCourse Name\tCredit\tGrade')
        self.assertEqual(len(rows) - 1, len(SAMPLE['attempts']))
        self.assertTrue(rows[1].startswith('2025-26 Semester II\t'))
        self.assertTrue(rows[-1].startswith('2024-25 Semester I\t'))

    def test_cp45_the_table_imports_cleanly_into_the_same_record_as_the_sample_student(self):
        client = self.student('example-reviewer')
        preview, record = self.import_table(client, table())
        self.assertEqual([i for i in preview['issues'] if i['severity'] == 'error'], [])
        self.assertNotIn('UNMATCHED_COURSE', [i['code'] for i in preview['issues']])   # every course code is a real one
        self.assertEqual({key(a) for a in record['attempts']}, {key(a) for a in SAMPLE['attempts']})
        self.assertEqual(len(record['attempts']), 36)

    def test_cp45_the_requirements_count_92_of_170_credits_with_78_remaining(self):
        client = self.student('example-audit')
        self.import_table(client, table())
        degree = self.analysis(client)['audit']['degree']['actual']
        self.assertEqual((degree['total_credits'], degree['counted_credits'], degree['remaining_credits']), ('170', '92', '78'))

    def test_cp45_the_imported_example_and_the_sample_student_give_the_same_audit_and_performance(self):
        imported = self.student('example-same')
        self.import_table(imported, table())
        sandbox = Client()
        sandbox.get('/api/v1/session')
        self.assertEqual(self.request(sandbox, 'post', '/auth/demo', {}).status_code, 201)
        a, b = self.analysis(imported), self.analysis(sandbox)
        self.assertEqual(a['audit']['degree'], b['audit']['degree'])
        self.assertEqual([(r['id'], r['status'], r['counted_credits']) for r in a['audit']['actual']], [(r['id'], r['status'], r['counted_credits']) for r in b['audit']['actual']])
        self.assertEqual(a['performance']['cumulative']['display_value'], b['performance']['cumulative']['display_value'])

    def test_cp45_a_plan_for_the_rest_of_the_degree_can_be_generated_and_completes(self):
        client = self.student('example-plan')
        self.import_table(client, table())
        revision = client.get('/api/v1/record').json()['data']['revision']
        response = self.request(client, 'post', '/plans/generate', {'record_revision': revision})
        self.assertEqual(response.status_code, 200, response.content)
        summary = response.json()['data']['summary']
        self.assertEqual(summary['remaining_before'], '78')
        self.assertIs(summary['complete'], True)   # the old six-row table left 52 credits unplanned

    def test_cp45_importing_a_real_transcript_later_replaces_the_example_and_never_mixes(self):
        client = self.student('example-replaced')
        self.import_table(client, table())
        own = 'Academic Period\tCourse No\tCourse Name\tCredit\tGrade\n2024-25 Semester I\tES 101\tSample course (ES 101)\t3\tB'
        _, record = self.import_table(client, own)
        self.assertEqual([key(a) for a in record['attempts']], [('ES 101', '2024-25-I', '3', 'B')])


if __name__ == '__main__':
    import unittest
    unittest.main()
