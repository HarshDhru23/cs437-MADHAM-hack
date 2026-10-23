from copy import deepcopy
import unittest
from coursepath.imports.ims import parse_ims
from coursepath.imports.reconcile import reconcile_import
from tests.imports.test_ims import TABLE


class ReconcileTests(unittest.TestCase):
    def setUp(self):
        self.preview = parse_ims(TABLE, 'synthetic')
        self.record = {'attempts': [], 'revision': 0}

    def test_cp08_preview_then_correct_preserve_raw_no_mutation(self):
        before = deepcopy(self.preview)
        row = self.preview['candidate_attempts'][0]
        result = reconcile_import(self.record, self.preview, {row['id']: {'fields': {'title': 'Correct title'}, 'justification': 'Extraction error'}})
        self.assertEqual(len(result['record']['attempts']), 5)
        accepted = result['record']['attempts'][0]
        self.assertEqual(accepted['title'], 'Correct title')
        self.assertEqual(accepted['original']['title'], row['title'])
        self.assertEqual(accepted['user_corrections'][0]['justification'], 'Extraction error')
        self.assertEqual(self.preview, before)
        self.assertEqual(self.record['attempts'], [])

    def test_cp11_idempotent_reimport_correction_and_conflict(self):
        first = reconcile_import(self.record, self.preview, {})['record']
        self.assertEqual(len(first['attempts']), 5)
        self.assertEqual(reconcile_import(first, self.preview, {})['record']['attempts'], first['attempts'])
        row = self.preview['candidate_attempts'][0]
        corrected = reconcile_import(self.record, self.preview, {row['id']: {'fields': {'grade': 'B'}, 'justification': 'Correct source transcription'}})['record']
        self.assertEqual(reconcile_import(corrected, self.preview, {})['record']['attempts'][0]['grade'], 'B')
        changed = deepcopy(self.preview)
        changed['candidate_attempts'][0]['grade'] = 'C'
        changed['candidate_attempts'][0]['original']['grade'] = 'C'
        conflict = reconcile_import(first, changed, {})
        self.assertTrue(any(i['code'] == 'IMPORT_CONFLICT' for i in conflict['issues']))

    def test_cp12_totals_mismatch_and_unknown_grade_blocked(self):
        self.preview['reported_controls']['earned_credits'] = '999'
        result = reconcile_import(self.record, self.preview, {})
        self.assertTrue(any(i['code'] == 'IMPORT_TOTAL_MISMATCH' for i in result['issues']))
        self.preview['candidate_attempts'][0]['grade'] = ''
        self.assertTrue(any(i['severity'] == 'error' for i in reconcile_import(self.record, self.preview, {})['issues']))
