#!/usr/bin/env python3
"""Run one CI assertion inside an ownership boundary established before fork.

On Linux, PR_SET_CHILD_SUBREAPER makes every orphaned descendant reparent to
this supervisor instead of escaping to PID 1.  That property is installed
before suite code is spawned, so immediate double-fork + setsid cannot outrun
observation.  macOS has no equivalent unprivileged job primitive; its local-only
fallback retains process-group cleanup while the production workflow remains
locked to ubuntu-latest by the Phase 2 validator.
"""

from __future__ import annotations

import argparse
import ctypes
import errno
import os
import signal
import subprocess
import sys
import time


PR_SET_CHILD_SUBREAPER = 36


def install_subreaper() -> bool:
    if not sys.platform.startswith("linux"):
        return False
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) != 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error))
    return True


def linux_descendants(root_pid: int) -> set[int]:
    found: set[int] = set()
    pending = [root_pid]
    while pending:
        parent = pending.pop()
        children_path = f"/proc/{parent}/task/{parent}/children"
        try:
            children = [int(value) for value in open(children_path, encoding="utf-8").read().split()]
        except (FileNotFoundError, ProcessLookupError):
            children = []
        for child in children:
            if child not in found:
                found.add(child)
                pending.append(child)
    return found


def darwin_descendants(root_pid: int) -> set[int]:
    found: set[int] = set()
    pending = [root_pid]
    while pending:
        parent = pending.pop()
        result = subprocess.run(["/usr/bin/pgrep", "-P", str(parent)], check=False, capture_output=True, text=True)
        for value in result.stdout.split():
            child = int(value)
            if child not in found:
                found.add(child)
                pending.append(child)
    return found


def owned_descendants(root_pid: int) -> set[int]:
    return linux_descendants(root_pid) if sys.platform.startswith("linux") else darwin_descendants(root_pid)


def signal_pid(pid: int, sig: signal.Signals) -> None:
    try:
        os.kill(pid, sig)
    except OSError as error:
        if error.errno != errno.ESRCH:
            raise


def signal_owned(child: subprocess.Popen[bytes], sig: signal.Signals, subreaper: bool, owned_pids: set[int]) -> None:
    owned_pids.update(owned_descendants(os.getpid()))
    for pid in owned_pids:
        signal_pid(pid, sig)
    try:
        os.killpg(child.pid, sig)
    except OSError as error:
        if error.errno not in (errno.ESRCH, errno.EPERM):
            raise


def reap_nonblocking() -> None:
    while True:
        try:
            pid, _ = os.waitpid(-1, os.WNOHANG)
        except ChildProcessError:
            return
        if pid == 0:
            return


def contain_until_empty(child: subprocess.Popen[bytes], sig: signal.Signals, subreaper: bool, owned_pids: set[int], deadline: float) -> None:
    while time.monotonic() < deadline:
        signal_owned(child, sig, subreaper, owned_pids)
        reap_nonblocking()
        if not owned_descendants(os.getpid()):
            return
        time.sleep(0.01)


def main() -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--timeout-ms", type=int, required=True)
    parser.add_argument("--grace-ms", type=int, required=True)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command or args.timeout_ms < 1 or args.grace_ms < 0:
        return 125

    subreaper = install_subreaper()
    owned_pids: set[int] = set()
    child = subprocess.Popen(command, start_new_session=True)
    deadline = time.monotonic() + args.timeout_ms / 1000
    timed_out = False
    while child.poll() is None:
        if time.monotonic() >= deadline:
            timed_out = True
            break
        time.sleep(min(0.01, max(0.001, deadline - time.monotonic())))

    if timed_out:
        signal_owned(child, signal.SIGTERM, subreaper, owned_pids)
        term_deadline = time.monotonic() + args.grace_ms / 1000
        while child.poll() is None and time.monotonic() < term_deadline:
            time.sleep(0.01)
        contain_until_empty(child, signal.SIGKILL, subreaper, owned_pids, time.monotonic() + 1.0)
        try:
            child.wait(timeout=1)
        except subprocess.TimeoutExpired:
            signal_pid(child.pid, signal.SIGKILL)
            child.wait()
        reap_nonblocking()
        return 124

    code = child.returncode if child.returncode is not None else 125
    # A successful or failed assertion owns no durable background service.
    # TERM gives cooperative children a bounded cleanup opportunity; KILL then
    # closes the boundary, including subreaper-adopted setsid descendants.
    signal_owned(child, signal.SIGTERM, subreaper, owned_pids)
    contain_until_empty(child, signal.SIGTERM, subreaper, owned_pids, time.monotonic() + min(args.grace_ms / 1000, 0.2))
    contain_until_empty(child, signal.SIGKILL, subreaper, owned_pids, time.monotonic() + 1.0)
    reap_nonblocking()
    return code if code >= 0 else 128 + abs(code)


if __name__ == "__main__":
    raise SystemExit(main())
