"""Independent regressions (M05): offerings and clashes resolve course identity (D-04) before matching.

A student types a course as their transcript prints it, e.g. "ES 242(N)", which D-04 makes Data Structures and
Algorithms I (ES 242). Expected values are read by hand from `Timetable, Sem-I, 2026-27.xlsx`:
- row 48, ES 242, lecture "G1,G2"; row 112, CS 331, lecture "G1,G2";
- `Time Slots` row "11:30 - 12:50": T = G1, F = G2, so both meet Tuesday and Friday 11:30-12:50 (690-770 minutes).
"""
import unittest

from coursepath.data_sources.official_timetables import load_committed_snapshots
from coursepath.identity import identity_map
from coursepath.rules.loader import load_curriculum
from coursepath.semester_plan import validate_plan

SNAPSHOTS = load_committed_snapshots()
IDENTITY = identity_map(load_curriculum().get('identity_groups'))
TERM = '2026-27-I'


def checked(code):
    plan = {'semesters': [{'term_id': TERM, 'courses': [{'id': 'dsa', 'normalized_code': code, 'credits': '4'},
                                                        {'id': 'net', 'normalized_code': 'CS 331', 'credits': '4'}]}]}
    result = validate_plan({'standing': 'normal', 'identity': IDENTITY}, plan, SNAPSHOTS)
    rows = {r['id']: r for r in result['per_course']}
    clashes = sorted({(m['weekday'], m['start_minute'], m['end_minute'])
                      for c in result['meeting_checks'][TERM]['conflicts'] for m in c.get('meetings', [c])
                      if isinstance(m, dict) and 'weekday' in m})
    return rows, result['meeting_checks'][TERM]['status'], clashes, [i['code'] for i in result['issues']]


class IdentityBeforeOfferingMatch(unittest.TestCase):
    def test_cp23_es242n_is_offered_as_es242(self):
        rows, _, _, codes = checked('ES 242(N)')
        self.assertEqual(rows['dsa']['offering_status'], 'confirmed_in_snapshot')
        self.assertNotIn('OFFERING_NOT_IN_SNAPSHOT', codes)

    def test_cp24_es242n_and_cs331_clash_on_their_shared_lectures_never_clear(self):
        rows, status, clashes, _ = checked('ES 242(N)')
        self.assertEqual(status, 'conflicts')
        self.assertEqual(rows['net']['meeting_check_status'], 'conflicts')
        self.assertEqual(clashes, [(1, 690, 770), (4, 690, 770)])  # Tuesday (G1) and Friday (G2), weekday 0 = Monday
        # The same result as typing the code ES 242 itself: the identity, not the spelling, decides.
        self.assertEqual(checked('ES 242')[1:3], (status, clashes))

    def test_cp23_a_code_listed_under_its_own_name_is_never_swapped_for_its_identity(self):
        # ES 678 shares an identity with ES 335 (D-04 group) but is listed in 2026-27-I under its own code: it keeps its own offering.
        plan = {'semesters': [{'term_id': TERM, 'courses': [{'id': 'x', 'normalized_code': 'ES 678', 'credits': '4'}]}]}
        row = validate_plan({'standing': 'normal', 'identity': IDENTITY}, plan, SNAPSHOTS)['per_course'][0]
        self.assertEqual(IDENTITY.get('ES 678'), 'ES 335')
        self.assertEqual(row['offering_status'], 'confirmed_in_snapshot')
        listed = {o['id']: o['code'] for s in SNAPSHOTS if s['term_id'] == TERM for o in s['offerings']}
        self.assertEqual({listed[i] for i in row['offering_ids']}, {'ES 678'})

if __name__ == '__main__':
    unittest.main()
