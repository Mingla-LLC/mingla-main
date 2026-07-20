#!/usr/bin/env python3
"""Check Mingla documentation placement invariants (Avengers era).

Work documentation lives as issues on the Mingla Avengers board
(https://github.com/orgs/Mingla-LLC/projects/4). The repo carries exactly
four canonical docs at the root plus engineering references under docs/.
This gate keeps the retired artifact system from growing back.

History pre-2026-07-19 is preserved at git tag `pre-avengers-archive`.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]

CANONICAL_DOCS = (
    "README.md",
    "AGENTS.md",
    "PRODUCT_AND_STRATEGY.md",
    "MARKETING.md",
    "COMMS.md",
    "REPORTS.md",
)

ENGINEERING_REFERENCES = (
    "docs/INVARIANT_REGISTRY.md",
    "docs/MINGLA_ENGINEERING_HANDBOOK.md",
    "docs/WORKTREE_STRATEGY.md",
    "docs/IOS_DEV_BUILD_REBUILD_RUNBOOK.md",
)

# Legacy roots that must never hold tracked files again. Pathspecs are
# root-relative, so bare names only match the top-level directories.
RETIRED_ROOTS = (
    "Mingla_Artifacts",
    "Mingla_Roadmap",
    "outputs",
    "clade transfer",
    "investigations",
    "specs",
    "reports",
)

# Per-work-item documentation belongs in the work item's issue, not the repo.
LEGACY_WORK_DOC = re.compile(
    r"^(CLOSE_NOTE_|INVESTIGATE_|INVESTIGATION_"
    r"|SPEC_(ORCH|META)|IMPLEMENT(ATION)?_(ORCH|META)"
    r"|TEST_(ORCH|META)|DESIGN_(ORCH|META)|HANDOFF_(ORCH|META))"
)

FORBIDDEN_OUTPUT_DESTINATION = re.compile(
    r"outputs/(INVESTIGATION|SPEC|IMPLEMENTATION|QA|DESIGN|COMPONENT|FLOW|DESIGN_SYSTEM)"
)

SKILL_GLOBS = (
    ".codex/skills/*-mingla/SKILL.md",
    ".codex/skills/*-mingla/references/*.md",
    ".claude/skills/mingla-*/SKILL.md",
    ".claude/skills/mingla-*/references/*.md",
)

GENERATED_PARTS = {"dist", "build", "web-build"}


def git_ls_files(*paths: str) -> list[str]:
    result = subprocess.run(
        ["git", "ls-files", "--", *paths],
        cwd=ROOT,
        check=True,
        text=True,
        stdout=subprocess.PIPE,
    )
    return [line for line in result.stdout.splitlines() if line.strip()]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def require(condition: bool, message: str, failures: list[str]) -> None:
    if not condition:
        failures.append(message)


def tracked_existing_generated_outputs() -> list[str]:
    violations: list[str] = []
    for path in git_ls_files():
        parts = set(Path(path).parts)
        if parts & GENERATED_PARTS and (ROOT / path).exists():
            violations.append(path)
    return violations


def skill_files() -> list[Path]:
    files: list[Path] = []
    for glob in SKILL_GLOBS:
        files.extend(ROOT.glob(glob))
    return sorted({path for path in files if path.is_file()})


def check_skill_output_destinations(failures: list[str]) -> None:
    for path in skill_files():
        text = path.read_text(encoding="utf-8")
        for match in FORBIDDEN_OUTPUT_DESTINATION.finditer(text):
            rel = path.relative_to(ROOT)
            failures.append(f"{rel}: stale current output destination `{match.group(0)}`")


def check_gitignore(failures: list[str]) -> None:
    text = read(".gitignore")
    for required in (".claude/", ".codex/", "outputs/"):
        require(required in text, f".gitignore must keep `{required}` ignored/private", failures)


def check_retired_roots(failures: list[str]) -> None:
    for root in RETIRED_ROOTS:
        tracked = git_ls_files(root)
        for path in tracked[:5]:
            failures.append(
                f"tracked file under retired root `{root}/`: {path} "
                "(work docs belong in the issue; history is at tag pre-avengers-archive)"
            )
        if len(tracked) > 5:
            failures.append(f"...and {len(tracked) - 5} more under `{root}/`")


def check_canonical_docs(failures: list[str]) -> None:
    tracked = set(git_ls_files())
    for doc in CANONICAL_DOCS:
        require(doc in tracked, f"canonical doc missing: {doc}", failures)
    for doc in ENGINEERING_REFERENCES:
        require(doc in tracked, f"engineering reference missing: {doc}", failures)


def check_no_legacy_work_docs(failures: list[str]) -> None:
    for path in git_ls_files():
        p = Path(path)
        if p.suffix.lower() != ".md":
            continue
        if LEGACY_WORK_DOC.match(p.name):
            failures.append(
                f"per-work-item doc tracked in repo (belongs in its issue): {path}"
            )


def main() -> int:
    failures: list[str] = []

    check_retired_roots(failures)
    check_canonical_docs(failures)
    check_no_legacy_work_docs(failures)
    check_gitignore(failures)

    generated = tracked_existing_generated_outputs()
    for path in generated:
        failures.append(f"tracked generated output exists in worktree: {path}")

    check_skill_output_destinations(failures)

    if failures:
        print("Artifact placement check FAILED:")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("Artifact placement check PASS")
    print("- retired roots (Mingla_Artifacts/, Mingla_Roadmap/, outputs/, ...) hold no tracked files")
    print("- canonical docs and docs/ engineering references are present")
    print("- no per-work-item docs tracked (work documentation lives in issues)")
    print("- no tracked existing dist/build/web-build artifacts")
    print("- private tool roots remain ignored")
    return 0


if __name__ == "__main__":
    sys.exit(main())
