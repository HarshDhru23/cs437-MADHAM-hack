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

    def test_all_34_statements_published(self):
        spec = (ROOT / 'SPEC.md').read_text(encoding='utf-8-sig')
        for number in range(1, 35):
            self.assertIn(f'CP-{number:02}', spec)
