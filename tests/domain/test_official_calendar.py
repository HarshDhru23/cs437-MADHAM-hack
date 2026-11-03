"""The committed 2026-27 academic calendar and the internship presets (CP-33; D-24, D-25).

Expected dates are copied by hand from the published table (CAL-2026-27); each one is
also checked against the committed page text, so a typo in the data file or in this
test fails. End dates are exclusive: the day after the published last day.
"""
from datetime import date
import json
import unittest
from pathlib import Path
from coursepath.calendar import internship_presets, load_calendar, preset_dates, validate_calendar
from coursepath.internships import evaluate_internship

ROOT = Path(__file__).resolve().parents[2]
SOURCE = (ROOT / 'data/calendars/acadcal-2026-27.txt').read_text(encoding='utf-8')
DATA = json.loads((ROOT / 'data/calendars/2026-27.json').read_text(encoding='utf-8'))

# (published text, term, field, expected [start, end-exclusive])
PUBLISHED = [
    ('Aug 04, 2026', '2026-27-I', 'start_date', '2026-08-04'),
    ('Nov 20 – 28, 2026', '2026-27-I', 'end_date_exclusive', '2026-11-29'),
    ('Nov 19, 2026', '2026-27-I', 'classes_end_date_exclusive', '2026-11-20'),
    ('Jan 04, 2027', '2026-27-II', 'start_date', '2027-01-04'),
    ('Apr 23 – 30, 2027', '2026-27-II', 'end_date_exclusive', '2027-05-01'),
    ('Apr 22, 2027', '2026-27-II', 'classes_end_date_exclusive', '2027-04-23'),
    ('May 07, 2027', '2026-27-SUMMER', 'start_date', '2027-05-07'),
    ('Jun 30 – Jul 02, 2027', '2026-27-SUMMER', 'end_date_exclusive', '2027-07-03'),
]
EXAMS = {
    '2026-27-I': [('Sep 18 – 23, 2026', '2026-09-18', '2026-09-24'), ('Nov 20 – 28, 2026', '2026-11-20', '2026-11-29')],
    '2026-27-II': [('Feb 19 – 24, 2027', '2027-02-19', '2027-02-25'), ('Apr 23 – 30, 2027', '2027-04-23', '2027-05-01')],
    '2026-27-SUMMER': [('Jun 02 – 04, 2027', '2027-06-02', '2027-06-05'), ('Jun 30 – Jul 02, 2027', '2027-06-30', '2027-07-03')],
}
# Quad Q1 starts with classes; Q2-Q4 start on "Classes Commence for ... Quad"; each ends the day after its last day of classes.
QUADS = {
    '2026-27-I': [('2026-08-04', '2026-08-26'), ('2026-08-27', '2026-09-18'), ('2026-09-24', '2026-10-17'), ('2026-10-26', '2026-11-20')],
    '2026-27-II': [('2027-01-04', '2027-01-28'), ('2027-01-28', '2027-02-19'), ('2027-02-25', '2027-03-20'), ('2027-03-29', '2027-04-23')],
    '2026-27-SUMMER': [('2027-05-07', '2027-06-02'), ('2027-06-07', '2027-06-30')],
}
QUAD_TEXT = ['Aug 25, 2026', 'Aug 27, 2026', 'Sep 17, 2026', 'Sep 24, 2026', 'Oct 16, 2026', 'Oct 26, 2026',
             'Jan 27, 2027', 'Jan 28, 2027', 'Feb 18, 2027', 'Feb 25, 2027', 'Mar 19, 2027', 'Mar 29, 2027', 'Jun 01, 2027', 'Jun 07, 2027', 'Jun 29, 2027']


def term(term_id):
    return next(t for t in DATA['terms'] if t['id'] == term_id)


class OfficialCalendarTests(unittest.TestCase):
    def test_cp33_terms_exams_and_quads_match_the_published_calendar(self):
        for text, term_id, field, expected in PUBLISHED:
            with self.subTest(term=term_id, field=field):
                self.assertIn(text, SOURCE)
                self.assertEqual(term(term_id)[field], expected)
        for term_id, exams in EXAMS.items():
            self.assertEqual([(e['start_date'], e['end_date_exclusive']) for e in term(term_id)['exams']], [(s, e) for _, s, e in exams])
            for text, _, _ in exams:
                self.assertIn(text, SOURCE)
        for term_id, quads in QUADS.items():
            self.assertEqual([(q['start_date'], q['end_date_exclusive']) for q in term(term_id)['quads']], quads)
        for text in QUAD_TEXT:
            self.assertIn(text, SOURCE)
        # Make-up exams are kept apart from the exam windows (D-24): only some students sit them.
        self.assertIn('Nov 30 – Dec 01, 2026', SOURCE)
        self.assertEqual(term('2026-27-I')['make_up_exams'], {'start_date': '2026-11-30', 'end_date_exclusive': '2026-12-02'})
        self.assertEqual(DATA['review_status'], 'reviewed')

    def test_cp33_the_loader_validates_and_merges_committed_years(self):
        loaded = load_calendar()
        self.assertEqual([t['id'] for t in loaded['terms']], ['2026-27-I', '2026-27-II', '2026-27-SUMMER'])
        self.assertEqual(loaded['review_status'], 'reviewed')
        broken = [
            {**DATA, 'terms': [{**term('2026-27-I'), 'id': '2026-I'}]},
            {**DATA, 'terms': [{**term('2026-27-I'), 'end_date_exclusive': '2026-08-04'}]},
            {**DATA, 'terms': [{**term('2026-27-I'), 'exams': [{'id': 'x', 'start_date': '2026-12-01', 'end_date_exclusive': '2026-12-05'}]}]},
            {**DATA, 'terms': [{**term('2026-27-I'), 'quads': [{'id': 'Q1', 'start_date': '2026-07-01', 'end_date_exclusive': '2026-08-26'}]}]},
            {**DATA, 'terms': [term('2026-27-I'), term('2026-27-I')]},
            {**DATA, 'review_status': 'draft'},
        ]
        for calendar in broken:
            with self.assertRaises(ValueError):
                validate_calendar(calendar)

    def test_cp33_presets_follow_the_may_and_july_starts(self):
        # D-25: two or three month internships start in May; six-month ones in May or July. Presets only seed dates.
        self.assertEqual(preset_dates('three_months', 'summer', '2026-27-SUMMER'), (date(2027, 5, 1), date(2027, 8, 1)))
        self.assertEqual(preset_dates('six_months', 'summer', '2026-27-SUMMER'), (date(2027, 5, 1), date(2027, 11, 1)))
        self.assertEqual(preset_dates('six_months', 'semester', '2027-28-I'), (date(2027, 7, 1), date(2028, 1, 1)))
        for args in [('three_months', 'semester', '2027-28-I'), ('six_months', 'semester', '2027-28-II'), ('six_months', 'semester', '2026-27-SUMMER'),
                     ('three_months', 'summer', '2027-28-I'), ('none', 'summer', '2026-27-SUMMER'), ('three_months', 'custom', '2026-27-SUMMER')]:
            with self.subTest(args=args), self.assertRaises(ValueError):
                preset_dates(*args)

    def test_cp33_the_published_summer_offers_three_presets(self):
        presets = [(p['duration_choice'], p['preset'], p['term_id'], p['start_date'], p['end_date_exclusive']) for p in internship_presets(load_calendar())]
        self.assertEqual(presets, [('three_months', 'summer', '2026-27-SUMMER', '2027-05-01', '2027-08-01'),
                                   ('six_months', 'summer', '2026-27-SUMMER', '2027-05-01', '2027-11-01'),
                                   ('six_months', 'semester', '2027-28-I', '2027-07-01', '2028-01-01')])
        self.assertEqual(internship_presets({'terms': []}), [])


class InternshipAgainstTheCalendarTests(unittest.TestCase):
    PLAN = {'id': 'p', 'semesters': [{'term_id': '2026-27-II', 'courses': [{'id': 'spring', 'normalized_code': 'CS 432', 'credits': '4'}]},
                                     {'term_id': '2026-27-SUMMER', 'courses': [{'id': 'summer', 'normalized_code': 'ZZ 301', 'credits': '4'}]},
                                     {'term_id': '2027-28-I', 'courses': [{'id': 'autumn', 'normalized_code': 'CS 331', 'credits': '4'}]}]}

    def evaluate(self, start, end, choice='three_months'):
        internship = {'id': 'i', 'duration_choice': choice, 'preset': 'custom', 'start_date': start, 'end_date_exclusive': end,
                      'placement_mode': 'onsite_full_time', 'modules': []}
        return evaluate_internship({'attempts': [], 'approvals': [], 'catalogue': {}}, internship, self.PLAN, load_calendar())

    def test_cp33_a_may_internship_overlaps_the_summer_term_but_not_the_spring_exams(self):
        result = self.evaluate('2027-05-01', '2027-08-01')
        # Semester II ends with Examination II on 30 Apr (exclusive 1 May), so a 1 May start does not touch it.
        self.assertEqual([(t['term_id'], t['overlap_days'], t['exam_overlap']) for t in result['overlapping_terms']], [('2026-27-SUMMER', 57, True)])
        self.assertEqual(result['affected_courses'], ['summer'])
        # 2027-28 dates are not published (D-24), so its course stays unchecked rather than clear.
        self.assertEqual(result['unchecked_courses'], ['autumn'])
        self.assertIn('CALENDAR_MISSING', [i['code'] for i in result['issues']])
        early = self.evaluate('2027-04-26', '2027-07-26')
        self.assertEqual([(t['term_id'], t['overlap_days'], t['exam_overlap']) for t in early['overlapping_terms']][0], ('2026-27-II', 5, True))
        self.assertIn('spring', early['affected_courses'])


if __name__ == '__main__':
    unittest.main()
