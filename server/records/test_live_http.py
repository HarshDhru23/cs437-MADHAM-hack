"""Real HTTP, independent cookie jars and an actual server process restart."""
import http.cookiejar
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from tests.imports.test_ims import TABLE

ROOT = Path(__file__).resolve().parents[2]


class LivePersistenceTests(unittest.TestCase):
    def test_cp29_http_cookie_sessions_and_process_restart(self):
        with tempfile.TemporaryDirectory(dir=ROOT / 'server/.local') as directory:
            environment = {**os.environ, 'COURSEPATH_SQLITE_PATH': str(Path(directory) / 'http-test.sqlite3'), 'COURSEPATH_ENV': 'development'}
            setup = subprocess.run([sys.executable, 'server/manage.py', 'migrate', '--noinput'], cwd=ROOT, env=environment, capture_output=True, timeout=30)
            self.assertEqual(setup.returncode, 0, 'Isolated database migrations failed')
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0))
                port = sock.getsockname()[1]
            base = f'http://127.0.0.1:{port}/api/v1'

            def client():
                return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

            def call(opener, method, route, payload=None):
                token = opener.open(base + '/session', timeout=5)
                csrf = json.load(token)['data']['csrf_token']
                request = urllib.request.Request(base + route, method=method,
                    data=json.dumps(payload).encode() if payload is not None else None,
                    headers={'Content-Type': 'application/json', 'X-CSRFToken': csrf})
                try:
                    with opener.open(request, timeout=10) as result:
                        return result.status, json.load(result)
                except urllib.error.HTTPError as error:
                    return error.code, json.load(error)

            process = None

            def start():
                running = subprocess.Popen([sys.executable, 'server/manage.py', 'runserver', f'127.0.0.1:{port}', '--noreload'], cwd=ROOT, env=environment,
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                    creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0)
                for _ in range(100):
                    try:
                        urllib.request.urlopen(base + '/session', timeout=0.2).close()
                        return running
                    except (OSError, urllib.error.URLError):
                        if running.poll() is not None:
                            self.fail('HTTP server exited before readiness')
                        time.sleep(0.05)
                running.terminate()
                running.wait(timeout=5)
                self.fail('HTTP server did not become ready')

            try:
                process = start()
                first, second = client(), client()
                credentials = {'username': 'synthetic-http', 'password': 'Synthetic-river-946!'}
                self.assertEqual(call(first, 'POST', '/auth/signup', credentials)[0], 201)
                self.assertEqual(call(second, 'POST', '/auth/login', credentials)[0], 200)
                code, preview = call(first, 'POST', '/imports/preview', {'kind': 'ims', 'text': TABLE, 'expected_revision': 0})
                self.assertEqual(code, 201)
                preview = preview['data']
                code, saved = call(first, 'POST', '/imports/' + preview['id'] + '/commit', {'expected_revision': 0, 'resolutions': {}, 'accepted_candidate_ids': [a['id'] for a in preview['candidate_attempts']]})
                self.assertEqual(code, 200)
                self.assertEqual(call(second, 'GET', '/record')[1]['data']['revision'], 1)
                self.assertEqual(call(second, 'PATCH', '/record', {'expected_revision': 0, 'attempts': []})[0], 409)
                code, plan = call(first, 'POST', '/plans', {'semesters': []})
                self.assertEqual(code, 201)
                process.terminate()
                process.wait(timeout=10)
                process = start()
                self.assertEqual(len(call(second, 'GET', '/record')[1]['data']['attempts']), 5)
                self.assertEqual(call(second, 'GET', '/plans/' + plan['data']['id'])[0], 200)
                self.assertEqual(call(second, 'POST', '/analysis', {'record_revision': 1})[0], 200)
            finally:
                if process and process.poll() is None:
                    process.terminate()
                    process.wait(timeout=10)
