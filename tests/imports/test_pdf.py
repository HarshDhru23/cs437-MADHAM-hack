from io import BytesIO
import unittest
from reportlab.pdfgen import canvas
from reportlab.lib.pdfencrypt import StandardEncryption
from coursepath.imports.pdf_transcript import parse_pdf


def transcript(encrypted=False, text=True, malformed=False, admission_year=2024):
    output = BytesIO()
    pdf = canvas.Canvas(output, pagesize=(640, 800), encrypt=StandardEncryption('secret') if encrypted else None)
    if text:
        pdf.drawString(20, 780, f'Programme B.Tech CSE | Admission {admission_year} | SYNTHETIC')
        for x, y, term in [(20, 740, '2024-25 Semester I'), (340, 740, '2024-25 Semester II'), (20, 400, '2025-26 Semester I'), (340, 400, '2025-26 Semester II')]:
            pdf.setFont('Helvetica', 9)
            pdf.drawString(x, y, 'Academic Period: ' + term)
            for offset, header in [(0, 'Course No'), (72, 'Course Name'), (230, 'Credit'), (270, 'Grade')]:
                pdf.drawString(x + offset, y - 20, header)
            pdf.drawString(x, y - 40, 'ES 242(N)')
            pdf.drawString(x + 72, y - 40, 'Tools & Systems')
            pdf.drawString(x + 230, y - 40, '4')
            if not malformed:
                pdf.drawString(x + 270, y - 40, 'A')
            pdf.drawString(x + 72, y - 50, 'Wrapped title')
            pdf.drawString(x, y - 70, 'PE 101')
            pdf.drawString(x + 72, y - 70, 'Physical Education')
            pdf.drawString(x + 230, y - 70, '0')
            pdf.drawString(x + 270, y - 70, 'P')
        pdf.drawString(20, 30, 'Earned Credits: 16  Performance Credits: 16  Points: 160  CPI: 10.00')
    pdf.showPage()
    pdf.save()
    return output.getvalue()


class PDFTests(unittest.TestCase):
    def test_cp06_coordinate_blocks_wrapped_titles_and_controls(self):
        parsed = parse_pdf(transcript(), 'synthetic-pdf')
        self.assertEqual(len(parsed['candidate_attempts']), 8)
        self.assertEqual([a['term_id'] for a in parsed['candidate_attempts']].count('2024-25-I'), 2)
        first = parsed['candidate_attempts'][0]
        self.assertEqual(first['normalized_code'], 'ES 242(N)')
        self.assertIn('Wrapped title', first['title'])
        self.assertEqual(parsed['reported_controls']['earned_credits'], '16')
        self.assertEqual(first['source_refs'][0]['page'], 1)
        self.assertFalse(parsed['unparsed_rows'])
        self.assertEqual(parsed['profile_candidates']['admission_year'], 2024)

    def test_cp09_invalid_encrypted_image_only_and_limits(self):
        for data, limits in [(b'not-pdf', {}), (b'%PDF-broken', {}), (transcript(encrypted=True), {}),
                             (transcript(text=False), {}), (transcript(), {'max_bytes': 10}), (transcript(), {'max_pages': 0})]:
            with self.subTest(limits=limits, size=len(data)):
                result = parse_pdf(data, 'synthetic', **limits)
                self.assertTrue(result['issues'])
                self.assertEqual(result['candidate_attempts'], [])

    def test_missing_grade_is_disclosed(self):
        result = parse_pdf(transcript(malformed=True), 'synthetic')
        self.assertTrue(result['issues'])
        self.assertTrue(any(a['grade'] == '' for a in result['candidate_attempts']))

    def test_reported_control_labels_and_legend_not_course_rows(self):
        output = BytesIO()
        pdf = canvas.Canvas(output, pagesize=(640, 800))
        pdf.drawString(20, 740, 'Academic Period: 2024-2025 SEMESTER I')
        for x, label in [(20, 'Code'), (92, 'Course Name'), (250, 'Credit'), (290, 'Grade')]:
            pdf.drawString(x, 720, label)
        for x, value in [(20, 'CS 101'), (92, 'Synthetic course'), (250, '4'), (290, 'A')]:
            pdf.drawString(x, 700, value)
        pdf.setFont('Helvetica', 8)
        pdf.drawString(20, 50, 'TOTAL CREDITS EARNED : 4')
        pdf.drawString(20, 35, 'TOTAL CREDITS COUNTED TOWARDS PERFORMANCE : 4')
        pdf.drawString(340, 35, 'MONTH & YEAR OF ADMISSION : July 2024')
        pdf.showPage()
        pdf.drawString(20, 740, 'SYSTEM OF EVALUATION AND AWARD OF DEGREE')
        pdf.drawString(20, 720, 'The CPI 10 maximum is not a course registration.')
        pdf.save()
        result = parse_pdf(output.getvalue(), 'synthetic')
        self.assertEqual(len(result['candidate_attempts']), 1)
        self.assertEqual(result['unparsed_rows'], [])
        self.assertEqual(result['reported_controls']['earned_credits'], '4')
        self.assertEqual(result['reported_controls']['performance_credits'], '4')
