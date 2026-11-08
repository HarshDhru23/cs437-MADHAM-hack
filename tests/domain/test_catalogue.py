"""Course catalogue built from the reviewed rules and the official timetables (D-29, CP-01, CP-13, CP-17)."""
import json
import unittest
from pathlib import Path
from coursepath.rules.loader import load_curriculum
from coursepath.prerequisites import load_recommended_prerequisites
from coursepath.catalogue import build_catalogue, classify_code

ROOT = Path(__file__).resolve().parents[2]


def snapshots():
    return [json.loads((ROOT / 'data' / 'offerings' / f'{term}.json').read_text(encoding='utf-8')) for term in ('2026-27-I', '2026-27-II')]


class CatalogueTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.curriculum = load_curriculum()
        cls.catalogue = build_catalogue(cls.curriculum, snapshots(), load_recommended_prerequisites())
        cls.by_code = {c['normalized_code']: c for c in cls.catalogue['courses']}

    def test_catalogue_states_what_it_covers_and_that_it_is_reviewed(self):
        self.assertEqual((self.catalogue['coverage'], self.catalogue['review_status']), ('partial', 'reviewed'))
        self.assertGreater(len(self.by_code), 250)  # both official 2026-27 timetables
        self.assertEqual(len(self.by_code), len(self.catalogue['courses']))  # one entry per code
        self.assertEqual(len({c['id'] for c in self.catalogue['courses']}), len(self.catalogue['courses']))

    def test_titles_credits_and_offered_terms_come_from_the_timetables(self):
        os_course = self.by_code['CS 330']
        self.assertEqual((os_course['title'], os_course['credits'], os_course['department']), ('Operating Systems', '4', 'CS'))
        self.assertEqual(os_course['offered_terms'], ['2026-27-I'])
        self.assertEqual(os_course['offering_status'], 'confirmed_in_snapshot')
        self.assertEqual(self.by_code['CS 614']['offered_terms'], ['2026-27-I', '2026-27-II'])
        self.assertEqual(self.by_code['CS 327']['credits'], '5')  # credits are the timetable's, not assumed

    def test_core_course_fills_only_its_core_slot_never_an_elective_too(self):
        # D-05/D-06: a core course can never count twice, so it is listed for its core slot only.
        self.assertEqual(self.by_code['CS 330']['could_satisfy'], ['Operating Systems'])

    def test_basket_course_lists_every_requirement_it_can_fill(self):
        # D-06: a Theory basket course is also a CS-coded elective inside the 26 credits; D-07: and any course can be an open elective.
        self.assertEqual(self.by_code['CS 614']['could_satisfy'], ['Theory & Algorithms basket', 'General CSE electives', 'Open electives'])
        self.assertEqual(self.by_code['CS 614']['baskets'], ['theory', 'cse-general', 'open-electives'])
        # D-20: PH is a Basic Science elective prefix.
        self.assertIn('Basic Science elective', self.by_code['PH 202']['could_satisfy'])
        self.assertIn('Open electives', self.by_code['PH 202']['could_satisfy'])
        self.assertNotIn('General CSE electives', self.by_code['PH 202']['could_satisfy'])

    def test_zero_credit_and_short_courses_follow_the_decisions(self):
        self.assertEqual(self.by_code['PE 101']['could_satisfy'], ['Physical Education (four semesters)'])  # zero credit: obligations only
        self.assertEqual(classify_code(self.curriculum, 'SC 372', '1'), [])  # D-08: never counts toward graduation
        self.assertEqual([r['id'] for r in classify_code(self.curriculum, 'BE 303', '4')], ['open-electives'])  # D-07: any other course

    def test_prerequisite_summary_is_a_recommendation_or_says_none_is_recorded(self):
        self.assertEqual(self.by_code['CS 330']['prerequisite_summary'], 'ES 242')
        self.assertEqual(self.by_code['BE 303']['prerequisite_summary'], 'No recommendation recorded')  # D-30: informational, not "none"

    def test_identity_variants_resolve_before_matching(self):
        # D-04: ES 242(N) is DSA I, so it fills the same core slot.
        self.assertEqual([r['id'] for r in classify_code(self.curriculum, 'ES 242(N)', '4')], ['dsa'])
        self.assertEqual([r['id'] for r in classify_code(self.curriculum, 'CS 203', '4')], ['cse-general', 'open-electives'])  # D-03: CS 203 is an elective, not CS 202


if __name__ == '__main__':
    unittest.main()
