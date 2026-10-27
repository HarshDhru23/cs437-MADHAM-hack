import json
import unittest
from pathlib import Path
from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[2]


class ContractTests(unittest.TestCase):
    def test_examples_and_rejections(self):
        path = ROOT / 'schemas/coursepath-v1.schema.json'
        self.assertTrue(path.exists(), 'H01 must publish the machine-readable v1 contract')
        schema = json.loads(path.read_text())
        Draft202012Validator.check_schema(schema)
        validator = Draft202012Validator(schema, format_checker=FormatChecker())
        examples = list((ROOT / 'examples').glob('*.json'))
        self.assertGreaterEqual(len(examples), 6)
        for example in examples:
            with self.subTest(example=example.name):
                validator.validate(json.loads(example.read_text()))
        for field, value in [('credits', '-1'), ('credits', 1.5), ('completion_status', 'passed')]:
            attempt = json.loads((ROOT / 'examples/empty-record.json').read_text())
            attempt['data']['attempts'] = [{
                'id': 'a', 'normalized_code': 'ZZ 100', 'original_code': 'ZZ100',
                'title': 'Synthetic', 'credits': '1.5', 'grade': 'P',
                'term_id': '2024-25-I', 'completion_status': 'completed',
                'learning_designation': 'unknown', 'source_refs': [], 'user_corrections': [],
                field: value}]
            self.assertTrue(list(validator.iter_errors(attempt)), (field, value))

    def test_audit_and_plan_validation_shapes_match_the_server(self):
        schema = json.loads((ROOT / 'schemas/coursepath-v1.schema.json').read_text())
        validator = Draft202012Validator(schema, format_checker=FormatChecker())
        # Plan workload is keyed by term (semester_plan.validate_plan); a flat total is not the server's shape.
        flat = json.loads((ROOT / 'examples/plan-validation.json').read_text())
        flat['data']['workload'] = {'selected_credits': '8', 'placeholder_credits': '4'}
        self.assertTrue(list(validator.iter_errors(flat)))
        bad_term = json.loads((ROOT / 'examples/plan-validation.json').read_text())
        bad_term['data']['workload'] = {'2026-27-I': {'selected_credits': '8', 'placeholder_credits': '4'}}
        self.assertTrue(list(validator.iter_errors(bad_term)), 'target_credits is always sent')
        # The audit always carries these fields (degree_audit.evaluate_audit); clients read them without guards.
        for field in ['current_ledger', 'projected_ledger', 'excluded_attempts', 'issues', 'complete', 'rule_version']:
            with self.subTest(field=field):
                audit = json.loads((ROOT / 'examples/audit.json').read_text())
                del audit['data'][field]
                self.assertTrue(list(validator.iter_errors(audit)), field)
        # GET /record always includes enrolment and source-reported controls (records.services); the UI reads both.
        for field in ['current_enrolment', 'reported_controls']:
            with self.subTest(field=field):
                empty = json.loads((ROOT / 'examples/empty-record.json').read_text())
                del empty['data'][field]
                self.assertTrue(list(validator.iter_errors(empty)), field)
        leaf = json.loads((ROOT / 'examples/audit.json').read_text())
        del leaf['data']['actual'][0]['children']
        self.assertTrue(list(validator.iter_errors(leaf)), 'requirement results always include children')

    def test_all_34_statements_published(self):
        spec = (ROOT / 'SPEC.md').read_text(encoding='utf-8-sig')
        for number in range(1, 35):
            self.assertIn(f'CP-{number:02}', spec)
