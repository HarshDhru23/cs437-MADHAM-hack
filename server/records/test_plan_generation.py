"""POST /api/v1/plans/generate (D-35, CP-35): owner-scoped, revision-checked, nothing saved, response matches the published contract."""
import json
from decimal import Decimal
from pathlib import Path
from django.test import Client, TestCase
from jsonschema import Draft202012Validator, FormatChecker
from server.records.models import AcademicPlan, AcademicRecord
from server.records.testing import AccountAPIMixin
from tests.plan_fixtures import synthetic_attempts

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = json.loads((ROOT / 'schemas/coursepath-v1.schema.json').read_text(encoding='utf-8'))


class PlanGenerationAPITests(AccountAPIMixin, TestCase):
    def student(self, username, attempts=None):
        client = Client()
        self.signup(client, username)
        revision = 0
        if attempts is not None:
            saved = self.request(client, 'patch', '/record', {'expected_revision': 0, 'attempts': attempts})
            self.assertEqual(saved.status_code, 200, saved.content)
            revision = saved.json()['data']['revision']
        return client, revision

    def generate(self, client, revision, **extra):
        return self.request(client, 'post', '/plans/generate', {'record_revision': revision, **extra})

    def test_cp35_requires_sign_in(self):
        self.assertEqual(Client().post('/api/v1/plans/generate', data='{}', content_type='application/json').status_code, 401)

    def test_cp35_csrf_is_enforced_like_every_mutation(self):
        client, revision = self.student('csrf-student')
        strict = Client(enforce_csrf_checks=True)
        strict.cookies = client.cookies
        response = strict.post('/api/v1/plans/generate', data=json.dumps({'record_revision': revision}), content_type='application/json')
        self.assertEqual(response.status_code, 403)

    def test_cp35_the_response_follows_the_published_contract_and_the_hand_count(self):
        client, revision = self.student('plan-student', synthetic_attempts())
        response = self.generate(client, revision)
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        Draft202012Validator(SCHEMA, format_checker=FormatChecker()).validate(body)
        data = body['data']
        self.assertEqual(data['record_revision'], revision)
        self.assertEqual(data['summary']['remaining_before'], '78')  # 170 - 92 completed, counted by hand (tests/plan_fixtures.py)
        self.assertEqual([i for i in data['validation']['issues'] if i['severity'] == 'error'], [])
        self.assertTrue(data['semesters'])

    def test_cp35_generating_saves_nothing(self):
        client, revision = self.student('nosave-student', synthetic_attempts())
        self.assertEqual(self.generate(client, revision).status_code, 200)
        self.assertEqual(AcademicPlan.objects.count(), 0)
        self.assertEqual(AcademicRecord.objects.get(owner__username='nosave-student').revision, revision)

    def test_cp35_the_generated_semesters_save_through_the_normal_plan_path(self):
        client, revision = self.student('save-student', synthetic_attempts())
        semesters = self.generate(client, revision).json()['data']['semesters']
        saved = self.request(client, 'post', '/plans', {'label': 'Generated draft', 'semesters': semesters})
        self.assertEqual(saved.status_code, 201, saved.content)
        validation = saved.json()['data']['validation']
        self.assertEqual([i for i in validation['issues'] if i['severity'] == 'error'], [])

    def test_cp35_a_stale_record_revision_is_a_409_never_an_overwrite_or_a_silent_retry(self):
        client, revision = self.student('stale-student', synthetic_attempts())
        for stale in (revision - 1, revision + 5, None):
            response = self.request(client, 'post', '/plans/generate', {'record_revision': stale})
            self.assertEqual(response.status_code, 409, stale)
            self.assertEqual(response.json()['issues'][0]['code'], 'REVISION_CONFLICT')

    def test_cp35_invalid_options_and_fields_are_a_400(self):
        client, revision = self.student('options-student')
        for extra in ({'options': {'terms': ['not-a-term']}}, {'options': {'bogus': 1}}, {'options': 'x'}, {'options': {'max_credits_per_term': '99'}}, {'plan_id': 'x'}):
            with self.subTest(extra=extra):
                self.assertEqual(self.generate(client, revision, **extra).status_code, 400)

    def test_cp35_each_account_is_planned_from_its_own_record_only(self):
        first, first_revision = self.student('owner-a', synthetic_attempts())
        second, second_revision = self.student('owner-b')
        mine = self.generate(first, first_revision).json()['data']
        theirs = self.generate(second, second_revision).json()['data']
        self.assertEqual(mine['summary']['remaining_before'], '78')
        self.assertEqual(theirs['summary']['remaining_before'], '170')  # an empty record, whatever the other account holds
        stale_for_other = self.request(second, 'post', '/plans/generate', {'record_revision': first_revision + 3})
        self.assertEqual(stale_for_other.status_code, 409)

    def test_cp35_an_empty_record_still_gets_an_honest_plan_with_every_gap_listed(self):
        client, revision = self.student('empty-student')
        data = self.generate(client, revision).json()['data']
        self.assertEqual(data['summary']['remaining_before'], '170')
        covered = {p['requirement_id'] for p in data['placements']}
        unmet = {u['requirement_id'] for u in data['unmet']}
        self.assertTrue(covered or unmet)
        self.assertLessEqual(len(data['semesters']), len(data['options']['terms']))


class PlanCheckAPITests(AccountAPIMixin, TestCase):
    """POST /api/v1/plans/check (D-36): validates an edited, unsaved plan and reports the degree credits it covers."""

    def student(self, username, attempts):
        client = Client()
        self.signup(client, username)
        saved = self.request(client, 'patch', '/record', {'expected_revision': 0, 'attempts': attempts})
        return client, saved.json()['data']['revision']

    def check(self, client, revision, semesters):
        return self.request(client, 'post', '/plans/check', {'record_revision': revision, 'semesters': semesters})

    def test_cp35_requires_sign_in(self):
        self.assertEqual(Client().post('/api/v1/plans/check', data='{}', content_type='application/json').status_code, 401)

    def test_cp35_an_edited_plan_is_validated_and_its_degree_credits_reported_without_saving(self):
        client, revision = self.student('check-student', synthetic_attempts())
        semesters = [{'term_id': '2026-27-I', 'courses': [{'id': 'a', 'normalized_code': 'CS 330', 'credits': '4'}, {'id': 'b', 'normalized_code': 'CS 331', 'credits': '4'}],
                      'placeholders': [{'id': 'p', 'requirement_id': 'open-electives', 'desired_credits': '4', 'label': 'Open elective'}]}]
        response = self.check(client, revision, semesters)
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        Draft202012Validator(SCHEMA, format_checker=FormatChecker()).validate(body)
        data = body['data']
        self.assertEqual(data['degree'], {'total_credits': '170', 'counted_credits': '100', 'remaining_credits': '70'})   # 92 + two 4-credit core courses
        self.assertEqual(data['placeholder_credits'], '4')
        self.assertEqual(data['validation']['workload']['2026-27-I']['target_credits'], '12')
        # hand count (tests/plan_fixtures.py): 78 remaining - 8 for the two core courses - 4 held = 66 still uncovered
        self.assertEqual(data['uncovered_credits'], '66')
        rows = {r['id']: r for r in data['requirements']}
        self.assertEqual((rows['open-electives']['required_credits'], rows['open-electives']['counted_credits'], rows['open-electives']['held_credits'], rows['open-electives']['uncovered_credits']),
                         ('16', '0', '4', '12'))
        self.assertEqual((rows['os']['counted_credits'], rows['os']['remaining_credits']), ('4', '0'))
        self.assertEqual(rows['toc']['uncovered_credits'], '4')   # CS 201 is still to place
        self.assertEqual(data['load']['2026-27-I'], {'planned_credits': '12', 'limit_credits': '28', 'available_credits': '16'})
        self.assertEqual(AcademicPlan.objects.count(), 0)

    def test_cp35_a_term_over_28_credits_is_reported_as_an_error(self):
        client, revision = self.student('overload-student', synthetic_attempts())
        courses = [{'id': f'c{i}', 'normalized_code': f'CS 4{i:02d}', 'credits': '4'} for i in range(8)]   # 32 credits
        data = self.check(client, revision, [{'term_id': '2026-27-I', 'courses': courses}]).json()['data']
        self.assertTrue([i for i in data['validation']['issues'] if i['severity'] == 'error'])

    def test_cp35_a_stale_record_revision_is_a_409(self):
        client, revision = self.student('stale-check-student', synthetic_attempts())
        self.assertEqual(self.check(client, revision + 1, []).status_code, 409)

    def test_cp35_another_accounts_record_is_never_used(self):
        first, first_revision = self.student('check-owner-a', synthetic_attempts())
        second, second_revision = self.student('check-owner-b', [])
        data = self.check(second, second_revision, []).json()['data']
        self.assertEqual(data['degree']['counted_credits'], '0')   # not the 92 credits held by the other account
        self.assertEqual(self.check(second, first_revision + 7, []).status_code, 409)

    def test_cp35_a_placeholder_covers_a_requirement_only_up_to_what_it_still_needs(self):
        client, revision = self.student('cover-student', synthetic_attempts())
        # open electives need 16: a 20-credit placeholder covers 16 and the other 4 are not counted against anything else
        semesters = [{'term_id': '2026-27-I', 'courses': [], 'placeholders': [{'id': 'p', 'requirement_id': 'open-electives', 'desired_credits': '20', 'label': 'Open elective'}]}]
        data = self.check(client, revision, semesters).json()['data']
        rows = {r['id']: r for r in data['requirements']}
        self.assertEqual((rows['open-electives']['held_credits'], rows['open-electives']['uncovered_credits']), ('16', '0'))
        self.assertEqual(data['uncovered_credits'], '62')   # 78 - 16
        self.assertEqual(data['load']['2026-27-I']['available_credits'], '8')   # a 20-credit semester has 8 more credits of room

    def test_cp35_a_semester_over_28_has_no_room_left_and_is_an_error(self):
        client, revision = self.student('full-student', synthetic_attempts())
        courses = [{'id': f'c{i}', 'normalized_code': f'CS 4{i:02d}', 'credits': '4'} for i in range(8)]
        data = self.check(client, revision, [{'term_id': '2026-27-I', 'courses': courses}]).json()['data']
        self.assertEqual(data['load']['2026-27-I'], {'planned_credits': '32', 'limit_credits': '28', 'available_credits': '0'})


class OnlineBreakAPITests(AccountAPIMixin, TestCase):
    """D-41: a plan that ends in a summer break (online courses) saves and checks like any other, with the summer limit of 10 credits."""

    def test_cp35_a_plan_ending_in_a_summer_saves_and_is_checked_against_the_summer_limit(self):
        from tests.plan_fixtures import attempt
        extra = [attempt(f'HS 3{i:02d}', '4', '2025-26-II') for i in range(4)]   # leaves 62 credits: 28 + 28 + 6 online in the summer break
        client = Client()
        self.signup(client, 'summer-student')
        revision = self.request(client, 'patch', '/record', {'expected_revision': 0, 'attempts': synthetic_attempts(extra=extra)}).json()['data']['revision']
        data = self.request(client, 'post', '/plans/generate', {'record_revision': revision}).json()['data']
        self.assertEqual((data['graduation']['last_term'], data['graduation']['online_credits']), ('2026-27-SUMMER', '6'))
        saved = self.request(client, 'post', '/plans', {'label': 'With a summer', 'semesters': data['semesters']})
        self.assertEqual(saved.status_code, 201, saved.content)
        checked = self.request(client, 'post', '/plans/check', {'record_revision': revision, 'semesters': data['semesters']}).json()['data']
        self.assertEqual(checked['load']['2026-27-SUMMER'], {'planned_credits': '6', 'limit_credits': '10', 'available_credits': '4'})
        self.assertEqual(checked['uncovered_credits'], '0')
        self.assertEqual([i for i in checked['validation']['issues'] if i['severity'] == 'error'], [])

    def test_cp35_more_than_10_credits_in_a_summer_is_an_error(self):
        client = Client()
        self.signup(client, 'summer-limit-student')
        revision = self.request(client, 'patch', '/record', {'expected_revision': 0, 'attempts': synthetic_attempts()}).json()['data']['revision']
        semesters = [{'term_id': '2026-27-SUMMER', 'courses': [], 'placeholders': [{'id': 'o', 'requirement_id': 'open-electives', 'desired_credits': '12', 'label': 'Online course'}]}]
        checked = self.request(client, 'post', '/plans/check', {'record_revision': revision, 'semesters': semesters}).json()['data']
        self.assertEqual(checked['load']['2026-27-SUMMER']['available_credits'], '0')
        self.assertTrue([i for i in checked['validation']['issues'] if i['severity'] == 'error'])


class OnlineManualAPITests(AccountAPIMixin, TestCase):
    """D-42: a student adds online courses by hand; the check says how many count, and the generator can lighten a plan with them."""

    def student(self, username, attempts):
        client = Client()
        self.signup(client, username)
        revision = self.request(client, 'patch', '/record', {'expected_revision': 0, 'attempts': attempts}).json()['data']['revision']
        return client, revision

    @staticmethod
    def online(term, *items):
        return [{'term_id': term, 'courses': [], 'placeholders': [
            {'id': f'o{i}', 'requirement_id': requirement, 'desired_credits': credits, 'label': name, 'online': True} for i, (requirement, credits, name) in enumerate(items)]}]

    def test_cp35_online_placeholders_are_accepted_by_the_plan_save_path_and_must_be_true_or_false(self):
        client, revision = self.student('online-save', synthetic_attempts())
        semesters = self.online('2026-27-SUMMER', ('open-electives', '4', 'Machine Learning on NPTEL'))
        self.assertEqual(self.request(client, 'post', '/plans', {'label': 'With an online course', 'semesters': semesters}).status_code, 201)
        bad = self.online('2026-27-SUMMER', ('open-electives', '4', 'x'))
        bad[0]['placeholders'][0]['online'] = 'yes'
        self.assertEqual(self.request(client, 'post', '/plans', {'label': 'bad', 'semesters': bad}).status_code, 400)

    def test_cp35_the_check_reports_how_many_online_credits_count_and_warns_when_some_do_not(self):
        client, revision = self.student('online-check', synthetic_attempts())
        ok = self.request(client, 'post', '/plans/check', {'record_revision': revision, 'semesters': self.online('2026-27-SUMMER', ('hss-other', '8', 'Writing course'))})
        data = ok.json()['data']
        Draft202012Validator(SCHEMA, format_checker=FormatChecker()).validate(ok.json())
        self.assertEqual(data['online'], {'planned_credits': '8', 'counted_credits': '8'})
        self.assertNotIn('ONLINE_CREDIT_LIMIT', [i['code'] for i in data['validation']['issues']])
        rows = {r['id']: r for r in data['requirements']}
        self.assertEqual((rows['hss-other']['held_credits'], rows['hss-other']['uncovered_credits']), ('8', '0'))   # HSS electives may be taken online (D-42)
        # 20 online credits: the pool is 16 (hand count), so 4 do not count and the plan says so
        over = self.request(client, 'post', '/plans/check', {'record_revision': revision, 'semesters': self.online('2026-27-SUMMER', ('hss-other', '8', 'A'), ('open-electives', '12', 'B'))}).json()['data']
        self.assertEqual(over['online'], {'planned_credits': '20', 'counted_credits': '16'})
        warning = [i for i in over['validation']['issues'] if i['code'] == 'ONLINE_CREDIT_LIMIT']
        self.assertEqual([w['message'] for w in warning], ['Only 16 of your 20 online credits count toward your degree.'])
        rows = {r['id']: r for r in over['requirements']}
        self.assertEqual(Decimal(rows['hss-other']['held_credits']) + Decimal(rows['open-electives']['held_credits']), 16)   # credits that do not count hold nothing

    def test_cp35_generation_with_lighten_returns_a_lighter_plan_and_what_it_replaced(self):
        client, revision = self.student('online-lighten', synthetic_attempts())
        response = self.request(client, 'post', '/plans/generate', {'record_revision': revision, 'options': {'lighten_with_online': True}})
        self.assertEqual(response.status_code, 200, response.content)
        Draft202012Validator(SCHEMA, format_checker=FormatChecker()).validate(response.json())
        potential = response.json()['data']['online_potential']
        self.assertEqual((potential['lightened'], potential['busiest_before'], potential['busiest_semester_credits']), (True, '28', '24'))   # 24 + 22 + 22 + 10 online: held electives come in even pieces (CP-46)
        saved = self.request(client, 'post', '/plans', {'label': 'Lighter', 'semesters': response.json()['data']['semesters']})
        self.assertEqual(saved.status_code, 201, saved.content)   # online placeholders save like any other

    def test_cp35_a_non_boolean_lighten_option_is_a_400(self):
        client, revision = self.student('online-bad-option', synthetic_attempts())
        self.assertEqual(self.request(client, 'post', '/plans/generate', {'record_revision': revision, 'options': {'lighten_with_online': 'yes'}}).status_code, 400)
