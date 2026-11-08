"""D-45 (CP-36): a requirement that asks for a number of courses is not covered by credits alone.

Physical Education needs four courses and no credits (ADV13 p. 3 A.14; `pe`, minimum_courses 4); the GE basket needs 4 credits over two
courses (p. 1 A.2, p. 2 A.4; `ge`, minimum_courses 2). A plan that leaves either short is not valid, even though no credit is uncovered.
"""
import json
from pathlib import Path
from django.test import Client, TestCase
from jsonschema import Draft202012Validator, FormatChecker
from server.records.testing import AccountAPIMixin
from tests.plan_fixtures import TERMS, attempt, synthetic_attempts

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = json.loads((ROOT / 'schemas/coursepath-v1.schema.json').read_text(encoding='utf-8'))


class PlanCheckCourseMinimumTests(AccountAPIMixin, TestCase):
    def start(self, attempts):
        self.client = Client()
        self.signup(self.client, 'min-courses-student')
        saved = self.request(self.client, 'patch', '/record', {'expected_revision': 0, 'attempts': attempts})
        self.assertEqual(saved.status_code, 200, saved.content)
        self.revision = saved.json()['data']['revision']
        generated = self.request(self.client, 'post', '/plans/generate', {'record_revision': self.revision}).json()['data']
        self.assertTrue(generated['summary']['complete'])
        return generated['semesters']

    def check(self, semesters):
        response = self.request(self.client, 'post', '/plans/check', {'record_revision': self.revision, 'semesters': semesters})
        self.assertEqual(response.status_code, 200, response.content)
        Draft202012Validator(SCHEMA, format_checker=FormatChecker()).validate(response.json())
        return response.json()['data']

    @staticmethod
    def without(semesters, prefix):
        trimmed = json.loads(json.dumps(semesters))
        for s in trimmed:
            s['courses'] = [c for c in s['courses'] if not c['normalized_code'].startswith(prefix)]
        return trimmed

    def shortfall(self, result, requirement_id):
        return [i for i in result['validation']['issues'] if i['severity'] == 'error' and requirement_id in i['entity_refs']]

    def test_cp36_a_plan_missing_physical_education_courses_is_not_valid(self):
        # Record: PE 101 and PE 102 only, so 4 - 2 = 2 PE courses are still needed. The generated plan places them and is valid.
        semesters = self.start(synthetic_attempts(without=('PE 103', 'PE 104')))
        self.assertEqual(sum(c['normalized_code'].startswith('PE') for s in semesters for c in s['courses']), 2)
        full = self.check(semesters)
        self.assertEqual(full['status'], {'valid': True, 'problems': 0, 'uncovered_credits': '0'})   # negative: a plan with the PE courses stays valid
        self.assertEqual(self.shortfall(full, 'pe'), [])
        # Without them the plan covers every credit (PE carries none) but leaves PE two courses short.
        result = self.check(self.without(semesters, 'PE'))
        self.assertEqual(result['uncovered_credits'], '0')   # credits are reported as they are: PE needs no credits
        self.assertEqual(len(self.shortfall(result, 'pe')), 1, result['validation']['issues'])
        self.assertIn('2 more courses', self.shortfall(result, 'pe')[0]['message'])
        self.assertEqual(result['status'], {'valid': False, 'problems': 1, 'uncovered_credits': '0'})

    def test_cp36_one_four_credit_course_does_not_fill_the_two_course_ge_basket(self):
        # Record: one 4-credit GE course in place of GE 101 and GE 102 (2 + 2), so ge has 4 of 4 credits but 1 of 2 courses.
        rows = synthetic_attempts(without=('GE 101', 'GE 102'), extra=[attempt('GE 102', '4', TERMS[3], 'P')])
        semesters = self.start(rows)
        full = self.check(semesters)   # the generated plan adds a second GE course
        self.assertTrue(full['status']['valid'], full['validation']['issues'])
        # The student drops the plan's GE courses and holds their credits as open electives instead, so every credit stays covered.
        trimmed = self.without(semesters, 'GE')
        dropped = sum(int(c['credits']) for s in semesters for c in s['courses'] if c['normalized_code'].startswith('GE'))
        holder = next(p for s in trimmed for p in s['placeholders'] if p['requirement_id'] == 'open-electives' and not p.get('online'))
        holder['desired_credits'] = str(int(holder['desired_credits']) + dropped)
        result = self.check(trimmed)
        self.assertEqual(result['uncovered_credits'], '0')
        self.assertEqual([r['uncovered_credits'] for r in result['requirements'] if r['id'] == 'ge'], ['0'])
        self.assertEqual(len(self.shortfall(result, 'ge')), 1, result['validation']['issues'])
        self.assertIn('1 more course', self.shortfall(result, 'ge')[0]['message'])
        self.assertFalse(result['status']['valid'])
        # Negative: a satisfied course minimum on the record raises nothing, even when the plan has no course for it (PE 101-104 are on it).
        self.assertEqual(self.shortfall(result, 'pe'), [])
