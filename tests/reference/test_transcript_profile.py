"""Independent regressions (M05): the programme is read from the transcript's header, never from course titles.

Real IITGN transcripts print the discipline as "DISCIPLINE : Comp Science & Engg" beside "PROGRAMME : B.Tech", and a
CSE transcript need not contain the words "Computer Science" anywhere else. Course titles such as "Special Topics in
Computer Science: ..." can appear on any discipline's transcript. Every name, course and grade below is invented.
"""
from io import BytesIO
import unittest

from reportlab.pdfgen import canvas

from coursepath.imports.pdf_transcript import parse_pdf


def transcript(discipline_line, rows):
    output = BytesIO()
    pdf = canvas.Canvas(output, pagesize=(640, 800))
    pdf.setFont('Helvetica', 8)
    pdf.drawString(20, 780, 'NAME : Synthetic Student')
    pdf.drawString(20, 766, discipline_line)
    pdf.drawString(80, 740, 'Academic Period : 2025-2026 SEMESTER I')
    for x, header in [(20, 'Code'), (86, 'Course Name'), (270, 'Credit'), (310, 'Grade')]:
        pdf.drawString(x, 722, header)
    for n, (code, title, credits, grade) in enumerate(rows):
        for x, value in [(20, code), (86, title), (270, credits), (310, grade)]:
            pdf.drawString(x, 704 - 14 * n, value)
    pdf.drawString(20, 40, 'TOTAL CREDITS EARNED : 8')
    pdf.drawString(340, 40, 'MONTH & YEAR OF ADMISSION : July 2024')
    pdf.showPage()
    pdf.save()
    return output.getvalue()


PLAIN_ROWS = [('ZZ 201', 'Synthetic Theory', '4', 'A'), ('ZZ 202', 'Synthetic Systems', '4', 'B')]
CS_TITLE_ROWS = [('ZZ 201', 'Synthetic Circuits', '4', 'A'), ('ZZ 392-I', 'Special Topics in Computer Science: Synthetic', '4', 'B')]


class ProgrammeFromTheHeader(unittest.TestCase):
    def parsed(self, discipline_line, rows):
        result = parse_pdf(transcript(discipline_line, rows), 'synthetic-pdf')
        return result['profile_candidates'], [i['code'] for i in result['issues']]

    def test_cp06_the_printed_cse_discipline_establishes_the_programme_without_any_cs_course_title(self):
        profile, codes = self.parsed('DISCIPLINE : Comp Science & Engg        PROGRAMME : B.Tech', PLAIN_ROWS)
        self.assertEqual(profile, {'programme': 'BTECH_CSE', 'admission_year': 2024})
        self.assertNotIn('PROFILE_UNCONFIRMED', codes)

    def test_cp06_another_discipline_is_not_cse_even_with_a_computer_science_course_title(self):
        profile, codes = self.parsed('DISCIPLINE : Electrical Engg        PROGRAMME : B.Tech', CS_TITLE_ROWS)
        self.assertEqual(profile['programme'], 'BTECH')
        self.assertIn('PROFILE_UNCONFIRMED', codes)

    def test_cp06_spelled_out_and_abbreviated_cse_programme_lines_are_recognised(self):
        for line in ['DISCIPLINE : Computer Science and Engineering   PROGRAMME : B.Tech', 'Programme B.Tech CSE | Admission 2024']:
            with self.subTest(line=line):
                self.assertEqual(self.parsed(line, PLAIN_ROWS)[0]['programme'], 'BTECH_CSE')


if __name__ == '__main__':
    unittest.main()
