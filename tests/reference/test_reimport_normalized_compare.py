"""D-44, CP-11: re-import compares rows by the values an import stores, not by how the source happened to format them (issues #9, #10)."""
from copy import deepcopy
import unittest
from coursepath.imports.ims import parse_ims
from coursepath.imports.reconcile import reconcile_import

HEADER = 'Academic Period\tCourse No\tCourse Name\tCredit\tGrade\n'


def paste(*rows):
    return parse_ims(HEADER + ''.join('\t'.join(row) + '\n' for row in rows), 'synthetic-paste')


def errors(result):
    return [i['code'] for i in result['issues'] if i['severity'] == 'error']


class ReimportKeepsCorrectionTests(unittest.TestCase):
    """#9: D-44 says a saved imported row the new import repeats unchanged "stays as it is, with any correction the student made"."""

    def setUp(self):
        first = reconcile_import({'attempts': []}, paste(('2024-25 Semester I', 'ES 242(N)', 'Tools & Systems Wrapped title', '4', 'A')), {}, replace_imported=True)
        self.assertEqual(errors(first), [])
        self.record = deepcopy(first['record'])
        row = self.record['attempts'][0]  # the student fixes the title as PATCH /record stores it
        row['user_corrections'].append({'field': 'title', 'raw': row['title'], 'accepted': 'Tools & Systems', 'justification': 'PDF wrapped a second line into the title'})
        row['title'] = 'Tools & Systems'
        self.saved = row

    def reimport(self, *row):
        result = reconcile_import(self.record, paste(row), {}, replace_imported=True)
        self.assertEqual(errors(result), [])
        return result, next(a for a in result['record']['attempts'] if a['id'] == self.saved['id'])

    def test_d44_same_row_formatted_differently_keeps_the_correction(self):
        # "ES242(N)" normalizes to "ES 242(N)", the doubled spaces collapse, Decimal("4.0") == Decimal("4"): the same row, only reformatted.
        result, after = self.reimport('2024-25 Semester I', 'ES242(N)', 'Tools  &  Systems   Wrapped title', '4.0', 'A')
        self.assertEqual([d['status'] for d in result['diff']], ['unchanged'])
        self.assertEqual(after, self.saved)  # title still "Tools & Systems", history has no reimport entry

    def test_d44_a_real_change_formatted_differently_still_replaces(self):
        result, after = self.reimport('2024-25 Semester I', 'ES242(N)', 'Tools & Systems Wrapped title', '4', 'B')  # grade A -> B
        self.assertEqual([d['status'] for d in result['diff']], ['replaced'])
        self.assertEqual((after['grade'], after['user_corrections'][-1]['field']), ('B', 'reimport'))
        result, after = self.reimport('2024-25 Semester I', 'ES 242(N)', 'Tools & Systems Wrapped title', '3', 'A')  # credits 4 -> 3
        self.assertEqual(([d['status'] for d in result['diff']], after['credits']), (['replaced'], '3'))

    def test_d10_two_cs299_registrations_stay_two_attempts_when_reformatted(self):
        terms = [('2025-26 Semester I', 'A'), ('2025-26 Semester II', 'B')]
        first = reconcile_import({'attempts': []}, paste(*[(t, 'CS 299', 'Project', '4', g) for t, g in terms]), {}, replace_imported=True)['record']
        again = reconcile_import(first, paste(*[(t, 'CS299', 'Project', '4.0', g) for t, g in terms]), {}, replace_imported=True)
        self.assertEqual(errors(again), [])
        self.assertEqual(sorted(d['status'] for d in again['diff']), ['unchanged', 'unchanged'])
        self.assertEqual(again['record']['attempts'], first['attempts'])  # two attempts, neither merged nor duplicated
        same_term = paste(*[('2025-26 Semester I', code, 'Project', '4', g) for code, g in [('CS 299', 'A'), ('CS299', 'B')]])
        ids = [a['id'] for a in same_term['candidate_attempts']]
        reviewed = {ids[0]: {'fields': {'instance_id': 'reg-1'}, 'justification': 'two registrations'}, ids[1]: {'fields': {'instance_id': 'reg-2'}, 'justification': 'two registrations'}}
        saved = reconcile_import({'attempts': []}, same_term, reviewed, replace_imported=True)['record']
        again = reconcile_import(saved, same_term, reviewed, replace_imported=True)
        self.assertEqual(errors(again), [])
        self.assertEqual(sorted((a['instance_id'], a['grade']) for a in again['record']['attempts']), [('reg-1', 'A'), ('reg-2', 'B')])


class TypedRowNumericCreditsTests(unittest.TestCase):
    """#10: a typed row is "never touched" and conflicts only "if the import changes" it (D-44); 4.0 and 4 credits are the same value."""

    def typed(self, **fields):
        row = {'id': 'manual-1', 'normalized_code': 'CS 101', 'original_code': 'CS 101', 'title': 'Synthetic  Course', 'credits': '4.0', 'grade': 'A',
               'term_id': '2024-25-I', 'completion_status': 'completed', 'learning_designation': 'degree', 'course_version_id': None, 'instance_id': None,
               'source_refs': [], 'user_corrections': [], 'approval_refs': []}
        return {'attempts': [{**row, **fields}]}

    def test_d44_typed_row_with_the_same_values_is_unchanged(self):
        record = self.typed()
        result = reconcile_import(record, paste(('2024-25 Semester I', 'CS 101', 'Synthetic Course', '4', 'A')), {}, replace_imported=True)
        self.assertEqual(errors(result), [])
        self.assertEqual([d['status'] for d in result['diff']], ['unchanged'])
        self.assertEqual(result['record']['attempts'], record['attempts'])  # kept exactly as typed

    def test_d44_typed_row_the_import_changes_still_conflicts(self):
        for typed, label in [(self.typed(grade='B'), 'grade B typed, A imported'), (self.typed(credits='3.0'), 'credits 3.0 typed, 4 imported')]:
            result = reconcile_import(typed, paste(('2024-25 Semester I', 'CS 101', 'Synthetic Course', '4', 'A')), {}, replace_imported=True)
            self.assertIn('IMPORT_CONFLICT', errors(result), label)
            self.assertEqual([d['status'] for d in result['diff']], ['conflicting'], label)


if __name__ == '__main__':
    unittest.main()
