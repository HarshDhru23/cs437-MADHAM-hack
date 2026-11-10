"""CR-110 item 4: hashed build files are cached for good and served compressed; index.html is not cached for long."""
import gzip
import tempfile
import unittest
from pathlib import Path
from wsgiref.util import setup_testing_defaults

from whitenoise import WhiteNoise

from server.config import settings


def fetch(app, path, encoding=''):
    environ = {'REQUEST_METHOD': 'GET', 'PATH_INFO': path}
    if encoding:
        environ['HTTP_ACCEPT_ENCODING'] = encoding
    setup_testing_defaults(environ)
    seen = {}

    def start_response(status, headers, exc_info=None):
        seen['status'] = status
        seen['headers'] = {name.lower(): value for name, value in headers}
    body = b''.join(app(environ, start_response))
    return seen['status'], seen['headers'], body


class StaticAssetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix='coursepath-dist-')
        root = Path(cls.directory.name)
        (root / 'assets').mkdir()
        script = ('// synthetic built bundle\n' * 200).encode()
        (root / 'assets' / 'index-Ab3dE9xZ.js').write_bytes(script)
        (root / 'assets' / 'index-Ab3dE9xZ.js.gz').write_bytes(gzip.compress(script))
        (root / 'assets' / 'plain.js').write_bytes(b'// not hashed')
        (root / 'index.html').write_bytes(b'<html>synthetic</html>')
        cls.app = WhiteNoise(None, root=str(root), immutable_file_test=settings.WHITENOISE_IMMUTABLE_FILE_TEST)

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def test_cp32_a_hashed_asset_is_cached_for_a_year_or_more_and_marked_immutable(self):
        status, headers, _ = fetch(self.app, '/assets/index-Ab3dE9xZ.js')
        self.assertTrue(status.startswith('200'), status)
        cache = headers['cache-control']
        self.assertIn('immutable', cache)
        self.assertGreaterEqual(int(cache.split('max-age=')[1].split(',')[0]), 31536000)

    def test_cp32_index_html_and_unhashed_files_keep_the_short_cache(self):
        # Negative: caching the entry page for good would stop students getting a new release.
        for path in ('/index.html', '/assets/plain.js'):
            _, headers, _ = fetch(self.app, path)
            self.assertNotIn('immutable', headers['cache-control'], path)
            self.assertLessEqual(int(headers['cache-control'].split('max-age=')[1].split(',')[0]), 3600, path)

    def test_cp32_the_precompressed_copy_is_served_when_the_browser_accepts_gzip(self):
        _, headers, body = fetch(self.app, '/assets/index-Ab3dE9xZ.js', 'gzip')
        self.assertEqual(headers.get('content-encoding'), 'gzip')
        self.assertIn(b'synthetic built bundle', gzip.decompress(body))
        _, headers, _ = fetch(self.app, '/assets/index-Ab3dE9xZ.js')
        self.assertNotIn('content-encoding', headers)

    def test_cp32_the_immutable_test_only_accepts_hashed_files_under_assets(self):
        test = settings.immutable_asset
        self.assertTrue(test('', '/assets/index-Ab3dE9xZ.js'))
        self.assertTrue(test('', '/assets/logo-q1w2e3r4t5.svg'))
        for url in ('/index.html', '/assets/plain.js', '/other/index-Ab3dE9xZ.js', '/assets/'):
            self.assertFalse(test('', url), url)


if __name__ == '__main__':
    unittest.main()
