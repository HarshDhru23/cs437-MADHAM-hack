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

    def test_cp11_replace_mode_swaps_earlier_imported_rows_for_the_new_import(self):
        first = reconcile_import(self.record, self.preview, {}, replace_imported=True)['record']
        manual = {**deepcopy(first['attempts'][0]), 'id': 'manual-1', 'source_key': None, 'source_refs': [], 'term_id': '2024-25-I', 'normalized_code': 'ZZ 900', 'instance_id': None}
        saved = {**first, 'attempts': first['attempts'] + [manual]}
        # A different paste of the same transcript: other source ids, one grade changed, one row gone.
        again = parse_ims(TABLE.replace('\tA\n', '\tB\n', 1), 'another-paste')
        dropped = again['candidate_attempts'].pop()
        result = reconcile_import(saved, again, {}, replace_imported=True)
        self.assertEqual([i for i in result['issues'] if i['severity'] == 'error'], [])  # no IMPORT_CONFLICT, no ambiguous identity
        ids = [a['id'] for a in result['record']['attempts']]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(len(result['record']['attempts']), 4 + 1)  # four imported rows + the student's own row
        self.assertIn(manual, result['record']['attempts'])
        statuses = sorted(d['status'] for d in result['diff'])
        self.assertEqual(statuses, ['removed', 'replaced', 'unchanged', 'unchanged', 'unchanged'])
        removed = next(d for d in result['diff'] if d['status'] == 'removed')
        self.assertNotIn(removed['attempt_id'], ids)
        self.assertEqual(dropped['normalized_code'], removed['existing']['normalized_code'])
        changed = next(a for a in result['record']['attempts'] if a['grade'] == 'B' and a['normalized_code'] == again['candidate_attempts'][0]['normalized_code'])
        self.assertEqual(changed['user_corrections'][-1]['field'], 'reimport')
        self.assertEqual(saved['attempts'], first['attempts'] + [manual])  # the input record is not mutated

    def test_cp11_replace_mode_keeps_a_row_left_out_of_the_review_and_a_changed_manual_row_still_conflicts(self):
        first = reconcile_import(self.record, self.preview, {}, replace_imported=True)['record']
        again = deepcopy(self.preview)
        left_out = again['candidate_attempts'].pop(0)
        again['excluded_attempts'] = [left_out]
        result = reconcile_import(first, again, {}, replace_imported=True)
        self.assertEqual(len(result['record']['attempts']), 5)
        self.assertFalse(any(d['status'] == 'removed' for d in result['diff']))
        typed = {**deepcopy(first['attempts'][1]), 'id': 'typed', 'source_key': None, 'source_refs': [], 'user_corrections': [], 'original': None, 'grade': 'C'}
        record = {'attempts': [typed]}
        conflict = reconcile_import(record, self.preview, {}, replace_imported=True)
        self.assertTrue(any(i['code'] == 'IMPORT_CONFLICT' for i in conflict['issues']))

    def test_cp12_totals_mismatch_and_unknown_grade_blocked(self):
        self.preview['reported_controls']['earned_credits'] = '999'
        result = reconcile_import(self.record, self.preview, {})
        self.assertTrue(any(i['code'] == 'IMPORT_TOTAL_MISMATCH' for i in result['issues']))
        self.preview['candidate_attempts'][0]['grade'] = ''
        self.assertTrue(any(i['severity'] == 'error' for i in reconcile_import(self.record, self.preview, {})['issues']))
