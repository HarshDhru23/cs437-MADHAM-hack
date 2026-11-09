"""CP-32: release bundles must not collect unreviewed local personal files."""
import contextlib
import io
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from tests.tooling.test_scripts import load


class AzurePackagePrivacyTests(unittest.TestCase):
    def test_cp32_only_tracked_source_and_built_frontend_enter_the_bundle(self):
        with tempfile.TemporaryDirectory(prefix='coursepath-package-') as directory:
            root = Path(directory)
            files = {
                'requirements.txt': 'synthetic dependency list',
                'coursepath/module.py': '# synthetic source',
                'frontend/src/app.ts': '// source is not a deployed asset',
                'frontend/dist/index.html': '<html>synthetic app</html>',
                'frontend/dist/assets/app-123.js': '// synthetic built asset',
                'docs/note.md': 'synthetic development note',
                '.env': 'synthetic sentinel',
                'private-export.json': '{"synthetic_private_record": true}',
                'local-helper.py': '# unreviewed local helper',
            }
            for name, content in files.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding='utf-8')
            subprocess.run(['git', 'init', '--quiet', str(root)], check=True)
            subprocess.run(['git', '-C', str(root), 'add', '--', 'requirements.txt', 'coursepath/module.py',
                            'frontend/src/app.ts', 'docs/note.md', '.env'], check=True)
            package = load('package_azure')
            target = root / 'release.zip'
            with patch.object(package, 'ROOT', root), patch('sys.argv', ['package_azure.py', '--out', str(target)]), contextlib.redirect_stdout(io.StringIO()):
                package.main()
            with zipfile.ZipFile(target) as bundle:
                self.assertEqual(set(bundle.namelist()), {
                    'requirements.txt', 'coursepath/module.py',
                    'frontend/dist/index.html', 'frontend/dist/assets/app-123.js',
                })
                self.assertEqual(bundle.read('frontend/dist/assets/app-123.js'), b'// synthetic built asset')
