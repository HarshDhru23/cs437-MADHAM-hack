"""Write a small synthetic transcript-layout PDF for browser tests.

Synthetic identity and courses only. Requires reportlab from the backend's
pinned requirements. Layout: four semester blocks in two columns with
Course No / Course Name / Credit / Grade headers, one wrapped title, and a
printed totals line, matching the supported text-PDF layout.
"""
import sys
from reportlab.pdfgen import canvas


def main(path):
    pdf = canvas.Canvas(path, pagesize=(640, 800))
    pdf.drawString(20, 780, 'Programme B.Tech CSE | Admission 2024 | SYNTHETIC')
    blocks = [(20, 740, '2024-25 Semester I'), (340, 740, '2024-25 Semester II'),
              (20, 400, '2025-26 Semester I'), (340, 400, '2025-26 Semester II')]
    for x, y, term in blocks:
        pdf.setFont('Helvetica', 9)
        pdf.drawString(x, y, 'Academic Period: ' + term)
        for offset, header in [(0, 'Course No'), (72, 'Course Name'), (230, 'Credit'), (270, 'Grade')]:
            pdf.drawString(x + offset, y - 20, header)
        pdf.drawString(x, y - 40, 'ES 242(N)')
        pdf.drawString(x + 72, y - 40, 'Synthetic Tools &')
        pdf.drawString(x + 230, y - 40, '4')
        pdf.drawString(x + 270, y - 40, 'A')
        pdf.drawString(x + 72, y - 50, 'Systems')
        pdf.drawString(x, y - 70, 'PE 101')
        pdf.drawString(x + 72, y - 70, 'Synthetic Physical Education')
        pdf.drawString(x + 230, y - 70, '0')
        pdf.drawString(x + 270, y - 70, 'P')
    pdf.drawString(20, 30, 'Earned Credits: 16  Performance Credits: 16  Points: 160  CPI: 10.00')
    pdf.showPage()
    pdf.save()


if __name__ == '__main__':
    main(sys.argv[1])
