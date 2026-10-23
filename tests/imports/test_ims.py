import unittest
from coursepath.imports.ims import parse_ims

HEADER = 'Academic Period\tCourse No\tCourse Name\tCredit\tGrade\n'
TABLE = HEADER + ('2025-26 Semester II\tCS299\tProject & Research\t4\tA\n'
                  '2024-25 Semester I\tES 242(N)\tData Structures\t4\tA-\n'
                  '2025-26 Semester I\tCS 299\tProject\t4\tP\n'
                  '2024-25 Semester II\tPE101\tPhysical Education\t0\tP\n'
                  '2024-25 Semester II\tSC 372\tShort course?\t1\tB\n')


class IMSTests(unittest.TestCase):
    def test_cp07_cp10_all_rows_terms_variants_repeats_and_provenance(self):
        parsed = parse_ims(TABLE.replace('\n', '\r\n'), 'synthetic-paste')
        rows = parsed['candidate_attempts']
        self.assertEqual(len(rows), 5)
        self.assertEqual(rows[0]['term_id'], '2025-26-II')
        self.assertEqual(rows[1]['normalized_code'], 'ES 242(N)')
        self.assertNotEqual(rows[0]['id'], rows[2]['id'])
        self.assertEqual(rows[3]['credits'], '0')
        self.assertEqual(rows[0]['source_refs'][0]['line'], 2)
        self.assertEqual(rows[-1]['normalized_code'], 'SC 372')
        self.assertEqual(rows[-1]['learning_designation'], 'unknown')

    def test_missing_headers_fields_unknown_grades_and_size_are_disclosed(self):
        for text in ['no headers', HEADER + '2024-25 Semester I\tCS 101\tMissing\t4\t\n',
                     HEADER + 'broken row CS 101\n', HEADER + '2024-25 Semester I\tCS 101\tUnknown\t4\tZ\n', 'x' * 1000001]:
            self.assertTrue(parse_ims(text, 'synthetic')['issues'])

    def test_multiline_whitespace_title_and_unicode(self):
        text = 'Academic Period  Course No  Course Name  Credit  Grade\n2024–25 Semester I  ES242(N)  Tools &\n Systems  4  A\n'
        result = parse_ims(text, 'synthetic')
        self.assertEqual(len(result['candidate_attempts']), 1)
        self.assertEqual(result['candidate_attempts'][0]['title'], 'Tools & Systems')

    def test_changed_order_keeps_source_identity(self):
        rows = TABLE.splitlines()
        original = parse_ims(TABLE, 'synthetic')['candidate_attempts']
        reversed_rows = parse_ims(rows[0] + '\n' + '\n'.join(reversed(rows[1:])), 'synthetic')['candidate_attempts']
        self.assertEqual({r['id'] for r in original}, {r['id'] for r in reversed_rows})
        self.assertTrue(original)

    def test_cp13_ambiguous_codes_are_preserved_with_review_issues(self):
        result = parse_ims(HEADER + '2025-26 Semester II\tCS 203\tSynthetic unresolved tools\t4\tA\n2025-26 Semester II\tCS 421\tSynthetic unresolved elective\t4\tB\n', 'synthetic')
        self.assertEqual([a['normalized_code'] for a in result['candidate_attempts']], ['CS 203', 'CS 421'])
        self.assertEqual(sum(i['code'] == 'EQUIVALENCE_UNCONFIRMED' for i in result['issues']), 2)
