"""Opt-in local checks. Private paths/rows are never packaged as fixtures."""
from collections import Counter, defaultdict
from decimal import Decimal
import os
from pathlib import Path
import unittest
from coursepath.imports.ims import parse_ims
from coursepath.imports.pdf_transcript import parse_pdf
from coursepath.performance import calculate_performance
from tests.domain.test_performance import POLICY


@unittest.skipUnless(os.getenv('COURSEPATH_REAL_INPUT_DIR'), 'Private samples not supplied to this test run')
class PrivateInputTests(unittest.TestCase):
    def test_independent_committed_roadmap_controls(self):
        directory = Path(os.environ['COURSEPATH_REAL_INPUT_DIR'])
        cases = [
            (parse_pdf((directory / '24110107-B.Tech-ASSISTANTREGISTRAR(ACADEMICS)AT.pdf').read_bytes(), 'private-local'), 39, ['28', '22', '28', '26']),
            (parse_ims((directory / 'copied_input.txt').read_text(encoding='utf-8-sig'), 'private-local'), 40, ['28', '23', '28', '26'])]
        for parsed, expected_count, expected_sums in cases:
            rows = parsed['candidate_attempts']
            self.assertEqual(len(rows), expected_count)
            sums = defaultdict(Decimal)
            for row in rows:
                sums[row['term_id']] += Decimal(row['credits'])
            self.assertEqual([str(value) for _, value in sorted(sums.items())], expected_sums)
            self.assertEqual(parsed['unparsed_rows'], [])
            self.assertEqual(sum(row['normalized_code'] == 'CS 299' for row in rows), 2)
            self.assertEqual(sum(row['normalized_code'] == 'ES 242(N)' for row in rows), 1)
            # This policy is explicitly synthetic for arithmetic comparison only.
            performance = calculate_performance(rows, POLICY)['cumulative']
            self.assertEqual(performance['performance_credits'], '92')
            self.assertEqual(performance['grade_points'], '849')
            self.assertEqual(performance['display_value'], '9.23')
