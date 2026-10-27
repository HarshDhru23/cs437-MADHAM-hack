import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _source(path):
    # Compare against unescaped string-literal content, e.g. account\'s -> account's.
    return path.read_text(encoding='utf-8').replace("\\'", "'").replace('\\"', '"')


def _resolve_python(test_id):
    parts = test_id.split('.')
    for split in range(len(parts) - 1, 0, -1):
        path = ROOT.joinpath(*parts[:split - 1], parts[split - 1] + '.py')
        if path.exists():
            text, names = path.read_text(encoding='utf-8'), parts[split:]
            if len(names) >= 2 and not re.search(rf'^\s*class\s+{re.escape(names[0])}\b', text, re.M):
                return f'missing class {names[0]}'
            if not re.search(rf'^\s*def\s+{re.escape(names[-1])}\s*\(', text, re.M):
                return f'missing test {names[-1]}'
            return None
    return 'missing file'


def _resolve_js(test_id, prefix):
    file_part, _, title = test_id.partition('::')
    if not file_part.startswith(prefix):
        return f'expected a file under {prefix}'
    path = ROOT / file_part
    if not path.exists():
        return 'missing file'
    text = _source(path)
    missing = [segment for segment in title.split(' > ') if f"'{segment}'" not in text and f'"{segment}"' not in text]
    return f'title not found: {missing}' if missing or not title else None


class StatementTestMapTests(unittest.TestCase):
    """The statement-test map is graded evidence: every ID in it must name a test that exists."""

    def setUp(self):
        self.map = json.loads((ROOT / 'schemas/statement-test-map.json').read_text(encoding='utf-8'))['statements']
        spec = (ROOT / 'SPEC.md').read_text(encoding='utf-8-sig')
        self.spec_ids = set(re.findall(r'^\|\s*(CP-\d{2,})\s*\|', spec, re.M))

    def test_map_and_spec_list_the_same_statements(self):
        self.assertEqual({s['id'] for s in self.map}, self.spec_ids)

    def test_every_mapped_test_exists(self):
        for statement in self.map:
            for test_id in statement['tests']:
                with self.subTest(statement=statement['id'], test=test_id):
                    self.assertIsNone(_resolve_python(test_id))
            for test_id in statement.get('frontend_tests', []):
                with self.subTest(statement=statement['id'], test=test_id):
                    self.assertIsNone(_resolve_js(test_id, 'frontend/src/'))
            for test_id in statement.get('browser_tests', []):
                with self.subTest(statement=statement['id'], test=test_id):
                    self.assertIsNone(_resolve_js(test_id, 'e2e/tests/'))

    def test_browser_evidence_flag_matches_browser_tests(self):
        for statement in self.map:
            with self.subTest(statement=statement['id']):
                if statement['release_evidence']['browser']:
                    self.assertTrue(statement.get('browser_tests'), 'browser evidence needs a real-stack browser test')
                if statement.get('browser_tests') and not statement['release_evidence']['browser']:
                    self.assertTrue(statement.get('release_evidence_note'), 'explain why mapped browser tests are not full evidence')

    def test_resolver_rejects_a_renamed_test(self):
        # Guard against a resolver that accepts anything.
        self.assertIsNotNone(_resolve_python('tests.domain.test_statement_map.StatementTestMapTests.test_no_such_test'))
        self.assertIsNotNone(_resolve_js('e2e/tests/public.spec.ts::a test that was renamed', 'e2e/tests/'))
        self.assertIsNotNone(_resolve_js('frontend/src/missing.test.tsx::x', 'frontend/src/'))
