"""CR-110 item 2: the private supplied files are named after a student's roll number, so preflight and .gitignore match them by pattern. These
tests use an invented number; the check against the real file names is done by hand with `git check-ignore -v`."""
import subprocess
import unittest
from pathlib import Path
from tests.tooling.test_scripts import ROOT, load

PREFLIGHT = None


def preflight():
    global PREFLIGHT
    if PREFLIGHT is None:
        import importlib.util
        path = ROOT / '.claude' / 'skills' / 'coursepath' / 'scripts' / 'preflight.py'
        spec = importlib.util.spec_from_file_location('cp_preflight_names', path)
        PREFLIGHT = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(PREFLIGHT)
    return PREFLIGHT


INVENTED = ['23123456-B.Tech-ASSISTANTREGISTRAR(ACADEMICS)AT.pdf', '23123456_Graduation Plan.xlsx']
GENERIC = ['Transcript_4th_sem.pdf', 'copied_input.txt']


class PrivateFileNames(unittest.TestCase):
    def test_preflight_refuses_every_private_file_name(self):
        for name in INVENTED + GENERIC + ['sub/' + INVENTED[0]]:
            self.assertTrue(preflight().is_never_commit(name), name)

    def test_preflight_does_not_refuse_ordinary_files(self):
        # Negative: the pattern must not swallow documents and fixtures that are meant to be committed.
        for name in ['SPEC.md', 'docs/team/README.md', 'tests/reference_fixtures/synthetic_transcript_rows.json', 'data/curricula/cse-2024.json']:
            self.assertFalse(preflight().is_never_commit(name), name)

    def test_gitignore_ignores_every_private_file_name_and_nothing_ordinary(self):
        def ignored(name):
            return subprocess.run(['git', 'check-ignore', '-q', '--', name], cwd=ROOT, stdin=subprocess.DEVNULL).returncode == 0
        for name in INVENTED + GENERIC:
            self.assertTrue(ignored(name), name)
        self.assertFalse(ignored('README.md'))
        self.assertFalse(ignored('SPEC.md'))

    def test_no_roll_number_shaped_literal_is_left_in_the_committed_text_of_the_scripts(self):
        text = (ROOT / '.claude' / 'skills' / 'coursepath' / 'scripts' / 'preflight.py').read_text(encoding='utf-8')
        self.assertNotRegex(text, r'\b2\d{7}\b')


if __name__ == '__main__':
    unittest.main()
