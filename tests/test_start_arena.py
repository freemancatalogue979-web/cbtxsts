"""Regression tests for the Unix launcher, using isolated local fixtures.

No system packages, real project data, or external network are touched.
Run with: python3 -m unittest discover -s tests -p 'test_start_arena.py' -v
"""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import platform
import shutil
import signal
import socket
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest
from pathlib import Path
from urllib.request import urlopen

SCRIPT = Path(__file__).resolve().parents[1] / "start-arena.sh"
PINNED_NODE_VERSION = "22.23.4"
ORIGINAL_HASHES = {
    (
        "Linux",
        "x86_64",
    ): "b8492284c76a54baf58d61668dd0e41ee0fc98adabf9503d30f05d08f55b4406",
    (
        "Linux",
        "aarch64",
    ): "f7a1e486dbc8b286847815b477d4fb5e9fb963ed4489c3e1588853d685f589f9",
    (
        "Darwin",
        "x86_64",
    ): "efcc2b0db6f94bf53eddb038fe2b370277a042bd29e4f19b8f8e23598795b819",
    (
        "Darwin",
        "arm64",
    ): "c9e1dbc748b33ed2d14f42445191ecaf14c56259c7a9a26d0042c49ec2b66428",
}


class LauncherTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="clover-launch-tests-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "project with spaces"
        self.root.mkdir()
        self.script = self.root / "start-arena.sh"
        shutil.copy2(SCRIPT, self.script)
        (self.root / "backend").mkdir()
        (self.root / "frontend").mkdir()
        self.tools = Path(self.temp.name) / "path"
        self.tools.mkdir()
        # Deliberately leave Node/npm out of PATH unless a test installs fakes.
        for name in (
            "bash",
            "uname",
            "curl",
            "wget",
            "tar",
            "gzip",
            "sha256sum",
            "shasum",
            "mktemp",
            "mkdir",
            "mv",
            "rm",
            "cat",
            "cmp",
            "date",
            "tr",
            "awk",
            "chmod",
            "cp",
            "flock",
            "nohup",
            "setsid",
            "ps",
            "sleep",
            "tail",
            "touch",
            "python3",
        ):
            path = shutil.which(name)
            if path:
                (self.tools / name).symlink_to(path)
        self.calls = Path(self.temp.name) / "npm-calls"
        self.mirror = Path(self.temp.name) / "mirror"
        self.mirror.mkdir()
        self.env = {
            "PATH": str(self.tools),
            "HOME": self.temp.name,
            "LANG": "C",
            "TEST_NPM_CALLS": str(self.calls),
            "CLOVER_NODE_DIST_BASE": self.mirror.as_uri(),
            "STARTUP_TIMEOUT": "12",
        }

    @staticmethod
    def executable(path: Path, content: str):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        path.chmod(0o755)

    def run_script(self, *args, env=None, timeout=45):
        return subprocess.run(
            [str(self.script), *args],
            env={**self.env, **(env or {})},
            cwd=self.root,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=timeout,
        )

    def source(self, command, env=None):
        return subprocess.run(
            [
                "/bin/bash",
                "-c",
                f'source "$1"; [[ "$ROOT" == "$2" ]] || exit 99; {command}',
                "launcher-test",
                str(self.script),
                str(self.root),
            ],
            env={**self.env, **(env or {})},
            cwd=self.root,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=45,
        )

    def fake_node(self, version="v22.22.3"):
        self.executable(self.tools / "node", f"#!/bin/bash\necho '{version}'\n")

    def fake_npm(self, version="10.9.8"):
        self.executable(
            self.tools / "npm",
            f"""#!/bin/bash
set -e
if [ "${{1:-}}" = "--version" ]; then echo '{version}'; exit 0; fi
if [ "${{1:-}}" = "ci" ]; then
  printf '%s\\n' "$*" >> "$TEST_NPM_CALLS"
  mkdir -p node_modules/.bin
  printf '#!/bin/sh\\nexit 0\\n' > node_modules/.bin/vite
  chmod +x node_modules/.bin/vite
  exit 0
fi
exit 1
""",
        )

    def make_node_archive(self, replace_checksum=True):
        system, machine = platform.system(), platform.machine()
        key = (system, machine)
        if key not in ORIGINAL_HASHES:
            self.skipTest(f"No Node bootstrap fixture for {system}/{machine}")
        os_part = "linux" if system == "Linux" else "darwin"
        arch_part = "x64" if machine == "x86_64" else "arm64"
        folder = f"node-v{PINNED_NODE_VERSION}-{os_part}-{arch_part}"
        archive_root = Path(self.temp.name) / "archive" / folder
        self.executable(
            archive_root / "bin/node", f"#!/bin/bash\necho v{PINNED_NODE_VERSION}\n"
        )
        self.executable(archive_root / "bin/npm", "#!/bin/bash\necho 10.9.8\n")
        archive = self.mirror / f"v{PINNED_NODE_VERSION}" / f"{folder}.tar.gz"
        archive.parent.mkdir(parents=True, exist_ok=True)
        with tarfile.open(archive, "w:gz") as tar:
            tar.add(archive_root, arcname=folder)
        if replace_checksum:
            # Only the temporary copy trusts this synthetic archive. The real
            # launcher keeps its official, hard-coded release checksum.
            content = self.script.read_text()
            self.assertIn(ORIGINAL_HASHES[key], content)
            self.script.write_text(
                content.replace(
                    ORIGINAL_HASHES[key],
                    hashlib.sha256(archive.read_bytes()).hexdigest(),
                )
            )
        return archive, folder

    def fake_app(self):
        """Small HTTP services exercise the actual launcher without network installs."""
        self.fake_node()
        self.fake_npm()
        backend = self.root / "backend"
        frontend = self.root / "frontend"
        (backend / "requirements.txt").write_text("")
        (backend / "app").mkdir()
        (frontend / "package-lock.json").write_text(
            '{"name":"fixture","lockfileVersion":3}\n'
        )
        api = backend / "uvicorn_fixture.py"
        api.write_text("""import http.server, json, sys
port = int(sys.argv[sys.argv.index("--port") + 1])
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps({"ok": True}).encode()
        self.send_response(200 if self.path == "/api/health" else 404)
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *args): pass
class Server(http.server.HTTPServer): allow_reuse_address = True
Server(("127.0.0.1", port), Handler).serve_forever()
""")
        self.executable(
            backend / ".venv/bin/python",
            f"""#!/bin/bash
if [ "${{1:-}}" = "-m" ] && [ "${{2:-}}" = "pip" ]; then
  if [ "${{3:-}}" = "install" ] && [ "${{TEST_PIP_FAIL:-0}}" = "1" ]; then echo 'simulated pip failure'; exit 1; fi
  exit 0
fi
if [ "${{1:-}}" = "-m" ] && [ "${{2:-}}" = "uvicorn" ]; then
  shift 2
  exec {str(sys.executable)!r} {str(api)!r} "$@"
fi
exec {str(sys.executable)!r} "$@"
""",
        )
        vite = frontend / "node_modules/.bin/vite"
        self.executable(
            vite,
            f"""#!{sys.executable}
import http.server, os, sys, urllib.request
port = int(sys.argv[sys.argv.index("--port") + 1])
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/health":
            try:
                body = urllib.request.urlopen(os.environ["VITE_API_TARGET"] + self.path, timeout=2).read()
            except Exception:
                self.send_response(502); self.end_headers(); return
        else:
            body = b"fixture web"
        self.send_response(200); self.end_headers(); self.wfile.write(body)
    def log_message(self, *args): pass
class Server(http.server.HTTPServer): allow_reuse_address = True
Server(("127.0.0.1", port), Handler).serve_forever()
""",
        )
        node_modules = frontend / "node_modules"
        shutil.copyfile(frontend / "package-lock.json", node_modules / ".arena-lock")
        (node_modules / ".arena-node-version").write_text(
            f"v22.22.3|10.9.8|{platform.system()}|{platform.machine()}\n"
        )
        self.addCleanup(self.stop_fixture)

    def stop_fixture(self):
        try:
            self.run_script("stop", timeout=20)
        except (OSError, subprocess.TimeoutExpired):
            pass
        # Last-resort cleanup is restricted to our own fixture processes.
        for name in ("api", "web"):
            pid_file = self.root / ".arena-run" / f"{name}.pid"
            try:
                pid = int(pid_file.read_text().strip())
                cmdline = Path(f"/proc/{pid}/cmdline").read_bytes()
                if str(self.root).encode() in cmdline and os.getpgid(pid) == pid:
                    os.killpg(pid, signal.SIGKILL)
            except (OSError, ValueError):
                pass

    @staticmethod
    def free_port():
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            return sock.getsockname()[1]

    @staticmethod
    def listening(port):
        with socket.socket() as sock:
            sock.settimeout(0.5)
            return sock.connect_ex(("127.0.0.1", port)) == 0

    def ports(self):
        api, web = self.free_port(), self.free_port()
        while api == web:
            web = self.free_port()
        return {"API_PORT": str(api), "WEB_PORT": str(web)}

    def test_missing_npm_gets_verified_local_node_and_reuses_it(self):
        self.fake_node()  # Reproduces Node installed but npm missing.
        archive, folder = self.make_node_archive()
        first = self.source("ensure_node; node --version; npm --version")
        self.assertEqual(first.returncode, 0, first.stdout)
        self.assertIn(f"installing Node.js {PINNED_NODE_VERSION} locally", first.stdout)
        self.assertIn(f"v{PINNED_NODE_VERSION}", first.stdout)
        self.assertIn("10.9.8", first.stdout)
        self.assertTrue((self.root / ".arena-run/tools" / folder / "bin/npm").exists())
        archive.unlink()  # A later start should not need another download.
        second = self.source("ensure_node; node --version; npm --version")
        self.assertEqual(second.returncode, 0, second.stdout)
        self.assertIn("Using locally installed", second.stdout)

    def test_missing_node_and_npm_also_bootstraps(self):
        _, folder = self.make_node_archive()
        result = self.source("ensure_node; node --version; npm --version")
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertTrue((self.root / ".arena-run/tools" / folder / "bin/node").exists())

    def test_broken_local_runtime_is_preserved_and_replaced(self):
        _, folder = self.make_node_archive()
        old = self.root / ".arena-run/tools" / folder
        self.executable(old / "bin/node", "#!/bin/bash\necho v18.0.0\n")
        self.executable(old / "bin/npm", "#!/bin/bash\necho 8.0.0\n")
        (old / "do-not-delete.txt").write_text("preserve")
        result = self.source("ensure_node")
        self.assertEqual(result.returncode, 0, result.stdout)
        backups = list(old.parent.glob(f"{folder}.broken-*"))
        self.assertEqual(len(backups), 1)
        self.assertEqual((backups[0] / "do-not-delete.txt").read_text(), "preserve")
        self.assertTrue((old / "bin/node").exists())

    def test_bad_checksum_is_rejected_before_install(self):
        _, folder = self.make_node_archive(replace_checksum=False)
        result = self.source("ensure_node")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("SHA-256 check", result.stdout)
        self.assertFalse((self.root / ".arena-run/tools" / folder).exists())
        self.assertEqual(
            list((self.root / ".arena-run/tools").glob(".node-install.*")), []
        )

    def test_unreachable_node_download_has_actionable_error(self):
        result = self.source("ensure_node")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Could not download Node.js", result.stdout)
        self.assertIn("npm 9+", result.stdout)
        self.assertNotIn("npm: command not found", result.stdout)

    def test_node_and_npm_version_matrix(self):
        for node, npm, expected in (
            ("v18.20.0", "10.9.8", False),
            ("v20.18.9", "10.9.8", False),
            ("v20.19.0", "9.0.0", True),
            ("v20.19.0-rc.1", "9.0.0", False),
            ("v21.9.0", "10.9.8", False),
            ("v22.11.0", "10.9.8", False),
            ("v22.12.0", "9.0.0", True),
            ("v23.0.0", "10.0.0", True),
            ("v24.0.0", "8.0.0", False),
        ):
            with self.subTest(node=node, npm=npm):
                self.fake_node(node)
                self.fake_npm(npm)
                result = self.source(
                    "if node_is_usable; then echo usable; else echo incompatible; fi"
                )
                self.assertEqual(result.returncode, 0, result.stdout)
                self.assertEqual(
                    result.stdout.strip(), "usable" if expected else "incompatible"
                )

    def test_frontend_install_is_reproducible_and_cache_tracks_versions(self):
        self.fake_node()
        self.fake_npm()
        lock = self.root / "frontend/package-lock.json"
        lock.write_text('{"name":"fixture"}\n')
        env = {"NODE_ENV": "production"}
        for _ in range(2):
            result = self.source("setup_frontend", env)
            self.assertEqual(result.returncode, 0, result.stdout)
        self.assertEqual(len(self.calls.read_text().splitlines()), 1)
        self.assertIn("--include=dev", self.calls.read_text())
        self.assertEqual(lock.read_text(), '{"name":"fixture"}\n')
        lock.write_text('{"name":"updated"}\n')
        self.assertEqual(self.source("setup_frontend", env).returncode, 0)
        self.fake_node("v22.22.4")
        self.assertEqual(self.source("setup_frontend", env).returncode, 0)
        self.assertEqual(len(self.calls.read_text().splitlines()), 3)

    def test_invalid_ports_and_missing_python_fail_before_setup(self):
        # Read-only status/stop do not try to install missing Node or npm.
        self.assertNotEqual(self.run_script("status").returncode, 0)
        self.assertFalse((self.root / ".arena-run").exists())
        result = self.run_script("start", env={"API_PORT": "oops"})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("API_PORT must be", result.stdout)
        self.assertFalse((self.root / ".arena-run").exists())
        result = self.run_script("start", env={"API_PORT": "9100", "WEB_PORT": "9100"})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("must be different", result.stdout)
        (self.tools / "python3").unlink(missing_ok=True)
        result = self.source("ensure_python")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("python3-venv", result.stdout)

    def test_stale_pid_does_not_kill_an_unrelated_process(self):
        sleeper = subprocess.Popen(["/bin/sleep", "60"])

        def reap_sleeper():
            if sleeper.poll() is None:
                sleeper.terminate()
            sleeper.wait(timeout=5)

        self.addCleanup(reap_sleeper)
        run_dir = self.root / ".arena-run"
        run_dir.mkdir()
        (run_dir / "api.pid").write_text(str(sleeper.pid))
        result = self.run_script("stop")
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("Ignoring stale API PID", result.stdout)
        self.assertIsNone(sleeper.poll())
        self.assertFalse((run_dir / "api.pid").exists())
        sleeper.terminate()
        sleeper.wait(timeout=5)

    def test_simultaneous_launcher_operations_are_rejected(self):
        if not (self.tools / "flock").exists():
            self.skipTest("flock unavailable")
        run_dir = self.root / ".arena-run"
        run_dir.mkdir()
        with (run_dir / "launcher.lock").open("w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = self.run_script("stop")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Another launcher operation", result.stdout)

    def test_daemon_start_status_restart_and_custom_port_proxy(self):
        self.fake_app()
        ports = self.ports()
        result = self.run_script("start", env=ports)
        self.assertEqual(result.returncode, 0, result.stdout)
        api_pid_file = self.root / ".arena-run/api.pid"
        web_pid_file = self.root / ".arena-run/web.pid"
        before = (api_pid_file.read_text(), web_pid_file.read_text())
        api_port, web_port = int(ports["API_PORT"]), int(ports["WEB_PORT"])
        self.assertEqual(
            json.loads(urlopen(f"http://127.0.0.1:{web_port}/api/health").read()),
            {"ok": True},
        )
        status = self.run_script(
            "status"
        )  # No port overrides are needed to report real ports.
        self.assertEqual(status.returncode, 0, status.stdout)
        self.assertIn(f"localhost:{api_port}", status.stdout)
        self.assertIn(f"localhost:{web_port}", status.stdout)
        # Legacy launchers wrote PID files but not port files.
        (self.root / ".arena-run/api.port").unlink()
        self.assertIn(f"localhost:{api_port}", self.run_script("status").stdout)
        again = self.run_script("start", env=ports)
        self.assertEqual(again.returncode, 0, again.stdout)
        self.assertEqual(before, (api_pid_file.read_text(), web_pid_file.read_text()))
        self.assertFalse(
            self.calls.exists(), "unchanged frontend dependencies should be reused"
        )
        # A live PID alone is not enough for a healthy status.
        os.kill(int(before[0]), signal.SIGSTOP)
        try:
            unhealthy = self.run_script("status")
            self.assertNotEqual(unhealthy.returncode, 0)
            self.assertIn("API      not responding", unhealthy.stdout)
        finally:
            os.kill(int(before[0]), signal.SIGCONT)
        # A failed dependency check must not stop already-running services.
        failed = self.run_script("restart", env={**ports, "TEST_PIP_FAIL": "1"})
        self.assertNotEqual(failed.returncode, 0)
        self.assertEqual(before, (api_pid_file.read_text(), web_pid_file.read_text()))
        self.assertTrue(self.listening(api_port) and self.listening(web_port))
        restarted = self.run_script("restart", env=ports)
        self.assertEqual(restarted.returncode, 0, restarted.stdout)
        self.assertNotEqual(before[0], api_pid_file.read_text())
        self.assertNotEqual(before[1], web_pid_file.read_text())
        self.assertEqual(self.run_script("stop").returncode, 0)
        self.assertFalse(self.listening(api_port))
        self.assertFalse(self.listening(web_port))

    def test_port_conflict_rolls_back_new_api_but_not_existing_api(self):
        self.fake_app()
        ports = self.ports()
        api_port, web_port = int(ports["API_PORT"]), int(ports["WEB_PORT"])
        with socket.socket() as blocker:
            blocker.bind(("0.0.0.0", web_port))
            blocker.listen()
            result = self.run_script("start", env=ports)
            self.assertNotEqual(result.returncode, 0, result.stdout)
            self.assertIn("WEB port", result.stdout)
            self.assertFalse(self.listening(api_port), result.stdout)
            self.assertTrue(self.listening(web_port))
            api_only = self.run_script("api", env=ports)
            self.assertEqual(api_only.returncode, 0, api_only.stdout)
            existing_pid = (self.root / ".arena-run/api.pid").read_text()
            result = self.run_script("start", env=ports)
            self.assertNotEqual(result.returncode, 0, result.stdout)
            self.assertTrue(self.listening(api_port))
            self.assertEqual(
                existing_pid, (self.root / ".arena-run/api.pid").read_text()
            )

    def test_share_tunnel_does_not_block_stop(self):
        self.fake_app()
        self.executable(
            self.tools / "cloudflared", "#!/bin/bash\nwhile :; do sleep 5; done\n"
        )
        ports = self.ports()
        api_port, web_port = int(ports["API_PORT"]), int(ports["WEB_PORT"])
        with (Path(self.temp.name) / "share.log").open("w+") as log:
            process = subprocess.Popen(
                [str(self.script), "share"],
                env={**self.env, **ports},
                cwd=self.root,
                stdout=log,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            try:
                deadline = time.monotonic() + 20
                output = ""
                while time.monotonic() < deadline:
                    log.flush()
                    log.seek(0)
                    output = log.read()
                    if (
                        "Opening a public HTTPS tunnel" in output
                        or process.poll() is not None
                    ):
                        break
                    time.sleep(0.1)
                self.assertIn("Opening a public HTTPS tunnel", output)
                stopped = self.run_script("stop")
                self.assertEqual(stopped.returncode, 0, stopped.stdout)
                self.assertFalse(self.listening(api_port))
                self.assertFalse(self.listening(web_port))
            finally:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                if process.poll() is None:
                    process.wait(timeout=5)

    def test_foreground_sigterm_stops_both_children(self):
        self.fake_app()
        ports = self.ports()
        api_port, web_port = int(ports["API_PORT"]), int(ports["WEB_PORT"])
        with (Path(self.temp.name) / "foreground.log").open("w+") as log:
            process = subprocess.Popen(
                [str(self.script), "foreground"],
                env={**self.env, **ports},
                cwd=self.root,
                stdout=log,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            try:
                deadline = time.monotonic() + 20
                while time.monotonic() < deadline and not self.listening(web_port):
                    if process.poll() is not None:
                        break
                    time.sleep(0.1)
                log.flush()
                log.seek(0)
                output = log.read()
                self.assertTrue(self.listening(api_port), output)
                self.assertTrue(self.listening(web_port), output)
                process.terminate()  # Only signal the launcher, not the whole group.
                process.wait(timeout=15)
                self.assertFalse(self.listening(api_port))
                self.assertFalse(self.listening(web_port))
            finally:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                if process.poll() is None:
                    process.wait(timeout=5)


if __name__ == "__main__":
    unittest.main()
