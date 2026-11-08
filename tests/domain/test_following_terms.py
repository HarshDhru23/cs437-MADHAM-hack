"""D-36: later years follow the supplied odd-semester and even-semester timetables (CP-23, CP-24)."""
import unittest
from coursepath.offerings import derive_snapshot, offering_availability, with_following_terms
from coursepath.timetable import check_meetings
from tests.domain.test_plan_generation import SNAPSHOTS


def official(term):
    return next(s for s in SNAPSHOTS if s['term_id'] == term)


class FollowingTerms(unittest.TestCase):
    def test_every_later_year_has_a_snapshot_of_the_same_semester(self):
        terms = {s['term_id'] for s in with_following_terms(SNAPSHOTS)}
        for year in range(2027, 2032):
            for part in ('I', 'II'):
                self.assertIn(f'{year}-{(year + 1) % 100:02d}-{part}', terms)

    def test_the_published_terms_are_kept_unchanged(self):
        by_term = {s['term_id']: s for s in with_following_terms(SNAPSHOTS)}
        self.assertIs(by_term['2026-27-I'], official('2026-27-I'))

    def test_a_derived_term_lists_the_same_courses_credits_and_slots(self):
        source, derived = official('2026-27-II'), derive_snapshot(official('2026-27-II'), '2027-28-II')
        self.assertEqual([(o['code'], o['credits']) for o in derived['offerings']], [(o['code'], o['credits']) for o in source['offerings']])
        self.assertEqual(derived['term_id'], '2027-28-II')
        self.assertEqual(derived['derived_from'], '2026-27-II')
        first = source['offerings'][0]['meeting_groups'][0]['meetings'][0]
        moved = derived['offerings'][0]['meeting_groups'][0]['meetings'][0]
        self.assertEqual((moved['start_minute'], moved['end_minute'], moved.get('weekday')), (first['start_minute'], first['end_minute'], first.get('weekday')))
        self.assertTrue(moved['id'].startswith('2027-28-II:'))

    def test_active_dates_move_by_whole_years(self):
        source, derived = official('2026-27-I'), derive_snapshot(official('2026-27-I'), '2028-29-I')
        before = source['offerings'][0]['meeting_groups'][0]['meetings'][0]
        after = derived['offerings'][0]['meeting_groups'][0]['meetings'][0]
        self.assertEqual(after['active_start_date'], '2028' + before['active_start_date'][4:])
        self.assertEqual(after['active_end_date'], '2028' + before['active_end_date'][4:])

    def test_a_course_is_confirmed_in_a_later_term_and_never_borrowed_across_semesters(self):
        snapshots = with_following_terms(SNAPSHOTS)
        in_odd = {o['code'] for o in official('2026-27-I')['offerings']}
        in_even = {o['code'] for o in official('2026-27-II')['offerings']}
        only_even = sorted(in_even - in_odd)[0]
        self.assertEqual(offering_availability(snapshots, '2027-28-II', only_even)['status'], 'confirmed_in_snapshot')
        self.assertEqual(offering_availability(snapshots, '2027-28-I', only_even)['status'], 'not_offered')

    def test_clash_checking_works_in_a_derived_term_and_is_not_reported_as_unchecked(self):
        snapshots = with_following_terms(SNAPSHOTS)
        derived = next(s for s in snapshots if s['term_id'] == '2027-28-I')
        codes = [o['code'] for o in derived['offerings'] if o['meeting_groups']][:2]
        result = check_meetings([{'id': c, 'normalized_code': c} for c in codes], derived)
        self.assertNotEqual(result.get('status'), 'not_checked')
        self.assertNotIn('MEETINGS_UNKNOWN', [i['code'] for i in result.get('issues', [])])

    def test_an_unreviewed_snapshot_is_not_carried_forward(self):
        draft = {**official('2026-27-I'), 'review_status': 'draft'}
        self.assertEqual([s['term_id'] for s in with_following_terms([draft])], ['2026-27-I'])

    def test_a_derived_snapshot_must_be_a_later_year_of_the_same_semester(self):
        for bad in ('2026-27-II', '2025-26-I', '2026-27-I'):
            with self.subTest(term=bad), self.assertRaises(ValueError):
                derive_snapshot(official('2026-27-I'), bad)


if __name__ == '__main__':
    unittest.main()
