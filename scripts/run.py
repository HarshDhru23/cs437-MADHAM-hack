"""One run command: start the Django API and the Vite dev server together.

    python scripts/run.py [--api-port 8000] [--web-port 5173]

Never installs anything. If setup is incomplete it prints what is missing and
exits 2. Ctrl+C stops both servers. This starts development servers only; the
Django dev server is not the hosted production server.
"""
import argparse
import os
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


@dataclass
class Service:
    name: str
    argv: list
    cwd: Path
    env: dict
    port: object  # TCP port to wait for, or None


def parse_args(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--api-port", type=int, default=int(os.environ.get("PORT", 8000)))
    p.add_argument("--web-port", type=int, default=int(os.environ.get("VITE_PORT", 5173)))
    p.add_argument("--ready-timeout", type=int, default=90, help="seconds to wait for each server")
    return p.parse_args(argv)


def check_prerequisites(root):
    root, problems = Path(root), []
    if not (root / "server" / "manage.py").is_file():
        problems.append("Django API not found (server/manage.py). It is Harsh's backend; merge it first.")
    else:
        code = subprocess.run([sys.executable, "-c", "import django"], capture_output=True).returncode
        if code != 0:
            problems.append("Django is not installed for this Python: pip install -r requirements.txt")
    if not (root / "frontend" / "package.json").is_file():
        problems.append("Frontend not found (frontend/package.json). It is Aaryan's; merge it first.")
    else:
        if not shutil.which("npm"):
            problems.append("npm not found on PATH (install a Node LTS release).")
        if not (root / "frontend" / "node_modules").is_dir():
            problems.append("Frontend dependencies missing: npm ci --prefix frontend")
    return problems


def _popen(svc):
    kwargs = {}
    if os.name == "nt":
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
    else:
        kwargs["start_new_session"] = True
    return subprocess.Popen(svc.argv, cwd=svc.cwd, env={**os.environ, **svc.env}, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace", **kwargs)


def _kill_tree(proc):
    if proc.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
    else:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
            proc.wait(5)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
    try:
        proc.wait(10)
    except subprocess.TimeoutExpired:
        pass


def _pump(name, proc):
    for line in proc.stdout:
        text = f"[{name}] {line.rstrip()}"
        try:
            print(text, flush=True)
        except UnicodeEncodeError:  # e.g. Vite's arrow on a cp1252 Windows console
            enc = getattr(sys.stdout, "encoding", None) or "ascii"
            print(text.encode(enc, "replace").decode(enc), flush=True)


def _listening(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.5):
            return True
    except OSError:
        return False


def supervise(services, ready_timeout, stop, pids, url):
    """Run services until `stop` is set or one exits. Returns an exit code."""
    procs = {}
    try:
        for svc in services:
            procs[svc.name] = _popen(svc)
            pids[svc.name] = procs[svc.name].pid
            threading.Thread(target=_pump, args=(svc.name, procs[svc.name]), daemon=True).start()
        deadline = time.time() + ready_timeout
        pending = [s for s in services if s.port]
        while pending:
            for name, proc in procs.items():
                if proc.poll() is not None:
                    print(f"{name} exited early with code {proc.returncode}", file=sys.stderr)
                    return proc.returncode or 1
            if stop.is_set():
                return 0
            if time.time() > deadline:
                print(f"timed out waiting for {pending[0].name} on port {pending[0].port}", file=sys.stderr)
                return 1
            pending = [s for s in pending if not _listening(s.port)]
            time.sleep(0.2)
        print(f"\nCoursePath is running: {url}\nPress Ctrl+C to stop.", flush=True)
        while not stop.is_set():
            for name, proc in procs.items():
                if proc.poll() is not None:
                    print(f"{name} exited with code {proc.returncode}", file=sys.stderr)
                    return proc.returncode or 1
            time.sleep(0.2)
        return 0
    except KeyboardInterrupt:
        return 0
    finally:
        for proc in procs.values():
            _kill_tree(proc)


def build_services(root, args, npm):
    return [
        Service("api", [sys.executable, str(root / "server" / "manage.py"), "runserver", f"127.0.0.1:{args.api_port}",
                        "--noreload"], root, {}, args.api_port),
        # frontend/vite.config.ts proxies /api to COURSEPATH_API_ORIGIN (default 127.0.0.1:8000).
        Service("web", [npm, "--prefix", "frontend", "run", "dev", "--", "--host", "127.0.0.1",
                        "--port", str(args.web_port), "--strictPort"], root,
                {"COURSEPATH_API_ORIGIN": f"http://127.0.0.1:{args.api_port}"}, args.web_port),
    ]


def main(argv=None, root=ROOT):
    args = parse_args(argv)
    problems = check_prerequisites(root)
    if problems:
        print("Cannot start CoursePath yet:", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        print("See README.md > Setup.", file=sys.stderr)
        return 2
    services = build_services(Path(root), args, shutil.which("npm"))
    return supervise(services, args.ready_timeout, threading.Event(), {}, f"http://localhost:{args.web_port}")


if __name__ == "__main__":
    sys.exit(main())
