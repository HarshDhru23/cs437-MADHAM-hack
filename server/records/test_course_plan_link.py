"""CP-43 through the API: the timetable the planner reads carries each course's course-plan link, so the plan page can link to it or say that
the course plan is not available yet. The expected values are read off the official workbooks themselves (the Course Plan column, N, of
`Timetable, Sem-I, 2026-27.xlsx` row 192 for BE 303; the Semester II CSV export keeps the cell text but no hyperlink)."""
from django.test import Client, TestCase

# Time table!N192 of the Semester I workbook: the hyperlink on the cell "BE303- Bionanotechnology - 2026.docx".
BE303_TARGET_PREFIX = 'https://docs.google.com/document/d/1b2laxSvo5bNciFwLfeUkEfsFPkbQ3jkm/'


class CoursePlanLinkTests(TestCase):
    def offering(self, term, code):
        data = Client().get('/api/v1/offerings', {'term_id': term}).json()['data']
        found = [o for o in data['offerings'] if o['code'] == code]
        self.assertEqual(len(found), 1, f'{code} should be listed once in {term}')
        return found[0]

    def test_cp43_a_course_with_a_hyperlink_in_the_course_plan_column_carries_its_target(self):
        link = self.offering('2026-27-I', 'BE 303')['course_plan_link']
        self.assertIsNotNone(link)
        self.assertTrue(link['target'].startswith(BE303_TARGET_PREFIX), link)

    def test_cp43_a_cell_with_text_but_no_hyperlink_has_no_target(self):
        # Semester II is a CSV export of the sheet: the text of the cell survives, the hyperlink does not.
        link = self.offering('2026-27-II', 'BE 304')['course_plan_link']
        self.assertIsNotNone(link)
        self.assertIsNone(link['target'])

    def test_cp43_a_later_odd_year_keeps_the_links_of_the_semester_it_follows(self):
        # D-38: every later odd semester is the 2026-27 Semester I timetable, so the course plan link is the same one.
        link = self.offering('2027-28-I', 'BE 303')['course_plan_link']
        self.assertTrue(link['target'].startswith(BE303_TARGET_PREFIX), link)
