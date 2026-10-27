#!/usr/bin/env python3
"""#3643: the new-workflow-literal guard exempts only the ci-batch registry.

Builds a throwaway git repo. Adding a workflow path to the registry passes;
adding the same path to any other file still fails.
"""
from __future__ import annotations

import importlib.util
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("guard", HERE.parent / "check_invariant_declarations.py")
guard = importlib.util.module_from_spec(SPEC)
sys.modules["guard"] = guard
SPEC.loader.exec_module(guard)

# Assembled so this file does not itself add a workflow-path literal.
LITERAL = "/".join([".github", "workflows", "example-lane.yml"])


def git(root: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=root, check=True, capture_output=True, text=True).stdout.strip()


def commit_with(root: Path, path: str, text: str) -> str:
    target = root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text)
    git(root, "add", path)
    git(root, "commit", "-q", "-m", f"edit {path}")
    return git(root, "rev-parse", "HEAD")


def check(path: str) -> str | None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        git(root, "init", "-q")
        git(root, "config", "user.email", "ci@example.invalid")
        git(root, "config", "user.name", "ci")
        base = commit_with(root, path, "{}\n")
        head = commit_with(root, path, f'{{"providerWorkflow": "{LITERAL}"}}\n')
        try:
            guard.check_new_workflow_literals(guard.GitTree(root), base, head)
        except guard.GuardFailure as error:
            return str(error)
        return None


def main() -> int:
    failures = []
    if check(".github/ci-batch/MANIFEST.json") is not None:
        failures.append("the ci-batch registry was refused for naming its own provider workflow")
    for other in ("docs/runbooks/example.md", ".github/scripts/example.mjs", ".github/ci-batch/patches/x.ci-batch.patch.json"):
        error = check(other)
        if error is None or LITERAL not in error:
            failures.append(f"{other} added a workflow literal and was not refused")
    if failures:
        print("FAIL: " + "; ".join(failures))
        return 1
    print("PASS: only the ci-batch registry may add workflow-path literals")
    return 0


if __name__ == "__main__":
    sys.exit(main())
