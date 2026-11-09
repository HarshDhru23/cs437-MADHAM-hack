"""Independent regressions (M05) for transcript rows seen on real IITGN transcripts, drawn with synthetic data only.

Real 2026 transcripts list special-topics registrations with a roman-numeral suffix (for example a CS 392 section
"CS 392-I" or an MS 491 section "MS 491-VIII"), usually with a title that wraps onto a second line. D-01 says
special-topics courses match by full code only, and D-06 counts suffixed CS codes ("CS 691-x") as discipline electives,
so the full suffixed code is a valid course code. Every course and grade below is invented.
"""
from io import BytesIO
import unittest

from reportlab.pdfgen import canvas

from coursepath.imports.ims import parse_ims
from coursepath.imports.pdf_transcript import parse_pdf
from coursepath.validation import course_code

# Column offsets copied from the real two-column layout: code, title, credit, grade.
CODE_X, TITLE_X, CREDIT_X, GRADE_X = 0, 66, 250, 290


def block_pdf(blocks, footer):
    """blocks: [(x, y, academic period, [(code, title line 1, wrapped line or None, credits, grade)])]."""
    output = BytesIO()
    pdf = canvas.Canvas(output, pagesize=(640, 800))
    pdf.setFont('Helvetica', 8)
    pdf.drawString(20, 780, 'PROGRAMME : B.Tech  DISCIPLINE : SYNTHETIC')
    for x, y, period, rows in blocks:
        pdf.drawString(x + 60, y, f'Academic Period : {period}')
        for offset, header in [(CODE_X, 'Code'), (TITLE_X, 'Course Name'), (CREDIT_X, 'Credit'), (GRADE_X, 'Grade')]:
            pdf.drawString(x + offset, y - 18, header)
        row_y = y - 36
        for code, title, wrapped, credits, grade in rows:
            for offset, value in [(CODE_X, code), (TITLE_X, title), (CREDIT_X, credits), (GRADE_X, grade)]:
                pdf.drawString(x + offset, row_y, value)
            if wrapped:
                pdf.drawString(x + TITLE_X, row_y - 9, wrapped)
            row_y -= 23 if wrapped else 14  # the real transcript's row pitch, tight enough for a wrap to reach the row above
    pdf.drawString(20, 40, footer)
    pdf.showPage()
    pdf.save()
    return output.getvalue()


SUFFIXED = [
    (20, 740, '2025-2026 SEMESTER II', [
        ('ZZ 328', 'Synthetic Data Topic', None, '4', 'A-'),
        ('CS 392-I', 'Special Topics in Computer Science:', 'Synthetic Competitive Topic', '2', 'A-'),
        ('ZZ 432', 'Synthetic Databases', None, '4', 'A'),
    ]),
    (340, 740, '2025-2026 SEMESTER I', [
        ('ZZ 205', 'Synthetic Calculus', None, '2', 'A'),
        ('MS 491-VIII', 'Special Topics in Management: Laboratory', 'in Synthetic Motivation', '4', 'A'),
        ('ZZ 103', 'Synthetic Physical Education', None, '0', 'P'),
    ]),
]


class SuffixedSpecialTopicsCodes(unittest.TestCase):
    def test_cp06_pdf_keeps_suffixed_special_topics_rows_and_their_wrapped_titles(self):
        parsed = parse_pdf(block_pdf(SUFFIXED, 'TOTAL CREDITS EARNED : 16'), 'synthetic-pdf')
        got = sorted((a['term_id'], a['normalized_code'], a['title'], a['credits'], a['grade']) for a in parsed['candidate_attempts'])
        # Expected rows are the ones drawn above: six rows, 4 + 2 + 4 + 2 + 4 + 0 = 16 credits.
        self.assertEqual(got, sorted([
            ('2025-26-II', 'ZZ 328', 'Synthetic Data Topic', '4', 'A-'),
            ('2025-26-II', 'CS 392-I', 'Special Topics in Computer Science: Synthetic Competitive Topic', '2', 'A-'),
            ('2025-26-II', 'ZZ 432', 'Synthetic Databases', '4', 'A'),
            ('2025-26-I', 'ZZ 205', 'Synthetic Calculus', '2', 'A'),
            ('2025-26-I', 'MS 491-VIII', 'Special Topics in Management: Laboratory in Synthetic Motivation', '4', 'A'),
            ('2025-26-I', 'ZZ 103', 'Synthetic Physical Education', '0', 'P'),
        ]))
        self.assertEqual(parsed['extracted_controls']['raw_credits'], '16')
        self.assertEqual(parsed['unparsed_rows'], [])

    def test_cp06_a_wrapped_title_never_attaches_to_the_row_above(self):
        # The failure seen on real transcripts: the suffixed row vanished and its second title line was glued to the
        # previous course ("Synthetic Data Topic Synthetic Competitive Topic").
        parsed = parse_pdf(block_pdf(SUFFIXED, 'TOTAL CREDITS EARNED : 16'), 'synthetic-pdf')
        titles = {a['normalized_code']: a['title'] for a in parsed['candidate_attempts']}
        self.assertEqual(titles.get('ZZ 328'), 'Synthetic Data Topic')
        self.assertEqual(titles.get('ZZ 205'), 'Synthetic Calculus')

    def test_cp06_a_code_as_wide_as_its_column_is_split_from_the_title_it_touches(self):
        # On the real transcript the monospaced code "MS 491-VIII" fills the code column, so its last letter touches the
        # title and the PDF text layer reads one word, "491-VIIISpecial". Drawn here the same way, with invented rows.
        output = BytesIO()
        pdf = canvas.Canvas(output, pagesize=(640, 800))
        pdf.setFont('Courier', 8)
        title_x = 20 + pdf.stringWidth('MS 491-VIII', 'Courier', 8)
        pdf.drawString(80, 740, 'Academic Period : 2025-2026 SEMESTER I')
        for x, header in [(20, 'Code'), (title_x, 'Course Name'), (270, 'Credit'), (310, 'Grade')]:
            pdf.drawString(x, 722, header)
        for y, code, title, wrapped, credits, grade in [
                (704, 'ZZ 205', 'Synthetic Calculus', None, '2', 'A'),
                (690, 'MS 491-VIII', 'Special Topics in Management: Laboratory', 'in Synthetic Motivation', '4', 'A'),
                (667, 'ZZ 103', 'Synthetic Physical Education', None, '0', 'P')]:
            for x, value in [(20, code), (title_x, title), (270, credits), (310, grade)]:
                pdf.drawString(x, y, value)
            if wrapped:
                pdf.drawString(title_x, y - 9, wrapped)
        pdf.showPage()
        pdf.save()
        parsed = parse_pdf(output.getvalue(), 'synthetic-pdf')
        got = sorted((a['normalized_code'], a['title'], a['credits'], a['grade']) for a in parsed['candidate_attempts'])
        self.assertEqual(got, [('MS 491-VIII', 'Special Topics in Management: Laboratory in Synthetic Motivation', '4', 'A'),
                               ('ZZ 103', 'Synthetic Physical Education', '0', 'P'),
                               ('ZZ 205', 'Synthetic Calculus', '2', 'A')])
        self.assertEqual(parsed['unparsed_rows'], [])

    def test_cp06_a_course_row_with_an_unreadable_code_is_disclosed_never_skipped(self):
        blocks = [(20, 740, '2025-2026 SEMESTER II', [
            ('ZZ 100', 'Synthetic Course One', None, '4', 'A'),
            ('ZZ#392', 'Synthetic Unreadable Code', None, '3', 'B'),
            ('ZZ 101', 'Synthetic Course Two', None, '2', 'B'),
        ])]
        parsed = parse_pdf(block_pdf(blocks, 'TOTAL CREDITS EARNED : 9'), 'synthetic-pdf')
        self.assertEqual(sorted(a['normalized_code'] for a in parsed['candidate_attempts']), ['ZZ 100', 'ZZ 101'])
        self.assertTrue(any('ZZ#392' in row['raw'] for row in parsed['unparsed_rows']), parsed['unparsed_rows'])
        self.assertIn('IMPORT_ROW_UNPARSED', [i['code'] for i in parsed['issues']])

    def test_cp07_ims_paste_accepts_suffixed_codes_in_any_spacing_and_case(self):
        text = ('Academic Period\tCourse No\tCourse Name\tCredit\tGrade\n'
                '2025-2026 Semester II\tCS 392-I\tSpecial Topics in Computer Science: Synthetic\t2\tA-\n'
                '2025-2026 Semester I\tms491-viii\tSpecial Topics in Management: Synthetic\t4\tA\n'
                '2025-2026 Semester II\tCS 392-II\tSpecial Topics in Computer Science: Another\t2\tB\n')
        parsed = parse_ims(text, 'synthetic-paste')
        self.assertEqual([a['normalized_code'] for a in parsed['candidate_attempts']], ['CS 392-I', 'MS 491-VIII', 'CS 392-II'])
        self.assertEqual(parsed['unparsed_rows'], [])
        # D-01: two special-topics sections are two courses, never one course taken twice.
        self.assertNotEqual(parsed['candidate_attempts'][0]['id'], parsed['candidate_attempts'][2]['id'])

    def test_cp02_manual_entry_accepts_a_suffixed_code_and_still_rejects_malformed_ones(self):
        def accepted(code):
            try:
                return course_code(code)
            except ValueError:
                return None
        self.assertEqual(accepted('CS 392-I'), 'CS 392-I')
        self.assertEqual(accepted('cs691-xii'), 'CS 691-XII')
        self.assertEqual(accepted('ES 242(N)'), 'ES 242(N)')
        for bad in ['CS 392-', 'CS-392', 'CS 392--I', '392-I']:
            with self.subTest(code=bad):
                self.assertIsNone(accepted(bad))


if __name__ == '__main__':
    unittest.main()
