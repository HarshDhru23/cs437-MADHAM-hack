import contextlib
import importlib.util
import io
import os
import signal
import socket
import subprocess
import sys
import tempfile
import textwrap
import threading
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def load(name):
    spec = importlib.util.spec_from_file_location(f"cp_script_{name}", ROOT / "scripts" / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def pid_alive(pid):
    if os.name == "nt":
        out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True).stdout
        return str(pid) in out
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class TestRunnerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.t = load("test")

    def make_root(self, files):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        for rel, body in files.items():
            p = root / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(textwrap.dedent(body), encoding="utf-8")
        return root

    PASSING = {
        "tests/__init__.py": "",
        "tests/test_a.py": "import unittest\nclass A(unittest.TestCase):\n    def test_ok(self): pass\n",
        "tests/sub/__init__.py": "",
        "tests/sub/test_b.py": "import unittest\nclass B(unittest.TestCase):\n    def test_ok(self): pass\n",
    }

    def test_expected_modules_include_nested_tests(self):
        root = self.make_root(self.PASSING)
        self.assertEqual(self.t.expected_modules(root), {"tests.test_a", "tests.sub.test_b"})

    def test_python_suite_passes_and_reports_counts(self):
        root = self.make_root(self.PASSING)
        r = self.t.run_python_suite(root)
        self.assertEqual((r.status, r.tests), ("PASS", 2))

    def test_nested_directory_without_package_marker_is_not_silently_skipped(self):
        files = {k: v for k, v in self.PASSING.items() if k != "tests/sub/__init__.py"}
        root = self.make_root(files)
        r = self.t.run_python_suite(root)
        self.assertEqual(r.status, "FAIL")
        self.assertIn("tests.sub.test_b", r.detail)

    def test_failing_test_fails_suite(self):
        files = dict(self.PASSING)
        files["tests/test_c.py"] = "import unittest\nclass C(unittest.TestCase):\n    def test_bad(self): self.fail('x')\n"
        r = self.t.run_python_suite(self.make_root(files))
        self.assertEqual(r.status, "FAIL")

    def test_missing_components_are_reported_missing_not_passed(self):
        root = self.make_root(self.PASSING)
        for run in (self.t.run_django_suite, self.t.run_frontend_suite, self.t.run_e2e_suite):
            self.assertEqual(run(root).status, "MISSING", run.__name__)

    def test_e2e_suite_needs_installed_dependencies_and_free_ports(self):
        files = dict(self.PASSING)
        files["e2e/package.json"] = '{"scripts": {"test": "playwright test"}}'
        root = self.make_root(files)
        r = self.t.run_e2e_suite(root)
        self.assertEqual(r.status, "FAIL")
        self.assertIn("npm ci --prefix e2e", r.detail)

    def test_e2e_suite_without_test_script_is_missing(self):
        files = dict(self.PASSING)
        files["e2e/package.json"] = '{"scripts": {}}'
        self.assertEqual(self.t.run_e2e_suite(self.make_root(files)).status, "MISSING")

    def test_busy_port_is_reported_before_running_e2e(self):
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            s.listen()
            busy = s.getsockname()[1]
            self.assertEqual(self.t.busy_ports([busy, free_port()]), [busy])

    def test_main_exits_nonzero_when_any_required_suite_missing(self):
        root = self.make_root(self.PASSING)
        self.assertEqual(self.t.main([], root=root), 1)

    def test_main_selector_runs_only_selected_suite(self):
        root = self.make_root(self.PASSING)
        self.assertEqual(self.t.main(["--suite", "python"], root=root), 0)
        self.assertEqual(self.t.main(["--suite", "django"], root=root), 1)

    def test_no_failing_result_can_be_hidden_by_a_passing_one(self):
        R = self.t.Result
        self.assertEqual(self.t.exit_code([R("a", "PASS"), R("b", "FAIL")]), 1)
        self.assertEqual(self.t.exit_code([R("a", "PASS"), R("b", "MISSING")]), 1)
        self.assertEqual(self.t.exit_code([R("a", "PASS")]), 0)
        self.assertEqual(self.t.exit_code([]), 1)

    def test_failure_detail_the_console_cannot_encode_is_still_reported(self):
        # Vitest prints U+276F; a cp1252 console or redirected log must not turn a FAIL into a crash.
        self.t.RUNNERS["fake"] = lambda root: self.t.Result("fake", "FAIL", 0, "npm run test:\n" + chr(0x276F) + " broken.test.tsx")
        self.addCleanup(self.t.RUNNERS.pop, "fake")
        self.addCleanup(setattr, self.t, "SUITES", self.t.SUITES)
        self.t.SUITES = (*self.t.SUITES, "fake")
        raw = io.BytesIO()
        console = io.TextIOWrapper(raw, encoding="cp1252", errors="strict", write_through=True)
        with contextlib.redirect_stdout(console):
            code = self.t.main(["--suite", "fake"], root=ROOT)
        self.assertEqual(code, 1)
        self.assertIn(b"broken.test.tsx", raw.getvalue())
        self.assertIn(b"FAILED", raw.getvalue())

    def test_django_suite_that_runs_no_tests_fails(self):
        files = dict(self.PASSING)
        files["server/manage.py"] = "print('Ran 0 tests in 0.000s')\nprint()\nprint('OK')\n"
        r = self.t.run_django_suite(self.make_root(files))
        self.assertEqual((r.status, r.tests), ("FAIL", 0))
        self.assertIn("no Django tests ran", r.detail)

    def test_vitest_count_survives_colour_codes(self):
        coloured = "\x1b[2m      Tests \x1b[22m \x1b[1m\x1b[32m230 passed\x1b[39m\x1b[22m\x1b[90m (230)\x1b[39m"
        self.assertEqual(self.t.vitest_passed(coloured), 230)
        self.assertEqual(self.t.vitest_passed("      Tests  2 failed | 228 passed (230)"), 228)
        self.assertEqual(self.t.vitest_passed("no summary"), 0)

    def test_e2e_api_port_can_be_moved_off_a_busy_8000(self):
        old = os.environ.pop("COURSEPATH_E2E_API_PORT", None)
        try:
            self.assertEqual(self.t.e2e_ports(), (8000, 4173))
            os.environ["COURSEPATH_E2E_API_PORT"] = "8010"
            self.assertEqual(self.t.e2e_ports(), (8010, 4173))
        finally:
            os.environ.pop("COURSEPATH_E2E_API_PORT", None)
            if old is not None:
                os.environ["COURSEPATH_E2E_API_PORT"] = old


class RunScriptTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.r = load("run")

    def test_missing_setup_is_described_and_nothing_started(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        problems = self.r.check_prerequisites(Path(tmp.name))
        text = "\n".join(problems)
        self.assertIn("server/manage.py", text)
        self.assertIn("frontend/package.json", text)

    def test_main_exits_2_on_missing_setup_without_spawning(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.assertEqual(self.r.main([], root=Path(tmp.name)), 2)

    def test_supervise_reports_readiness_and_cleans_up_on_stop(self):
        port = free_port()
        server = f"import socket,time;s=socket.socket();s.bind(('127.0.0.1',{port}));s.listen();time.sleep(60)"
        sleeper = "import time;time.sleep(60)"
        stop, pids, out = threading.Event(), {}, []
        specs = [
            self.r.Service("api", [sys.executable, "-c", server], ROOT, {}, port),
            self.r.Service("web", [sys.executable, "-c", sleeper], ROOT, {}, None),
        ]
        t = threading.Thread(target=lambda: out.append(self.r.supervise(specs, 20, stop, pids, "http://127.0.0.1:1")))
        t.start()
        deadline = time.time() + 15
        while len(pids) < 2 and time.time() < deadline:
            time.sleep(0.1)
        self.assertEqual(len(pids), 2)
        self.assertTrue(all(pid_alive(p) for p in pids.values()))
        stop.set()
        t.join(30)
        self.assertEqual(out, [0])
        time.sleep(0.5)
        self.assertFalse(any(pid_alive(p) for p in pids.values()))

    def test_supervise_propagates_child_failure_and_stops_the_other(self):
        pids = {}
        specs = [
            self.r.Service("api", [sys.executable, "-c", "import sys;sys.exit(3)"], ROOT, {}, None),
            self.r.Service("web", [sys.executable, "-c", "import time;time.sleep(60)"], ROOT, {}, None),
        ]
        code = self.r.supervise(specs, 20, threading.Event(), pids, "http://127.0.0.1:1")
        self.assertEqual(code, 3)
        time.sleep(0.5)
        self.assertFalse(any(pid_alive(p) for p in pids.values()))

    def test_supervise_fails_when_service_never_becomes_ready(self):
        pids = {}
        port = free_port()
        specs = [self.r.Service("api", [sys.executable, "-c", "import time;time.sleep(60)"], ROOT, {}, port)]
        code = self.r.supervise(specs, 1, threading.Event(), pids, "http://127.0.0.1:1")
        self.assertNotEqual(code, 0)
        time.sleep(0.5)
        self.assertFalse(any(pid_alive(p) for p in pids.values()))

    def test_services_use_real_commands_and_proxy_origin_follows_api_port(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        api, web = self.r.build_services(root, self.r.parse_args(["--api-port", "9001", "--web-port", "9002"]), "npm")
        self.assertEqual(api.argv[1:4], [str(root / "server" / "manage.py"), "runserver", "127.0.0.1:9001"])
        self.assertEqual(web.env["COURSEPATH_API_ORIGIN"], "http://127.0.0.1:9001")
        self.assertIn("9002", web.argv)
        self.assertEqual((api.port, web.port), (9001, 9002))

    def test_output_with_characters_the_console_cannot_encode_does_not_kill_the_pump(self):
        import io
        import contextlib
        child = subprocess.Popen([sys.executable, "-c", "import sys;sys.stdout.buffer.write(('web '+chr(0x279c)+' Local'+chr(10)).encode())"],
                                 stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8")
        raw = io.BytesIO()
        console = io.TextIOWrapper(raw, encoding="cp1252", errors="strict", write_through=True)
        with contextlib.redirect_stdout(console):
            self.r._pump("web", child)
        child.wait()
        self.assertIn(b"[web] web", raw.getvalue())

    def test_unapplied_migrations_are_a_setup_problem(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        (root / "server").mkdir()
        # Stand-in manage.py: `migrate --check` exits 1, as Django does when migrations are unapplied.
        (root / "server" / "manage.py").write_text("import sys\nsys.exit(1 if sys.argv[1:3] == ['migrate', '--check'] else 0)\n")
        self.assertIn("python server/manage.py migrate", "\n".join(self.r.check_prerequisites(root)))
        (root / "server" / "manage.py").write_text("import sys\nsys.exit(0)\n")
        self.assertNotIn("migrate", "\n".join(self.r.check_prerequisites(root)))

    def test_busy_port_stops_before_starting_anything(self):
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            s.listen()
            busy = s.getsockname()[1]
            self.assertEqual(self.r.busy_ports([busy, free_port()]), [busy])
            problems = self.r.port_problems(self.r.parse_args(["--api-port", str(busy), "--web-port", str(free_port())]))
            self.assertTrue(problems and str(busy) in problems[0] and "--api-port" in problems[0])

    def test_termination_signals_stop_the_supervisor(self):
        stop = threading.Event()
        installed = self.r.install_stop_handlers(stop)
        self.addCleanup(lambda: [signal.signal(sig, old) for sig, old in installed.items()])
        self.assertIn(signal.SIGTERM, installed)
        signal.getsignal(signal.SIGTERM)(signal.SIGTERM, None)
        self.assertTrue(stop.is_set())

    def test_ports_can_be_overridden(self):
        a = self.r.parse_args(["--api-port", "9001", "--web-port", "9002"])
        self.assertEqual((a.api_port, a.web_port), (9001, 9002))
        d = self.r.parse_args([])
        self.assertEqual((d.api_port, d.web_port), (8000, 5173))


if __name__ == "__main__":
    unittest.main()
