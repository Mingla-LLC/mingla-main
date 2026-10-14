#!/usr/bin/env python3
"""Issue #3643: the shared ship log is closed and issue release records are canonical."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


CLOSED_BANNER = (
    "> **Closed 2026-10-14.** Historical record only; do not add new entries. "
    "Current release records live on the shipping GitHub issue."
)
REPORTS_PATH = "REPORTS.md"
IMPLEMENTOR_PATH = (
    "scripts/docs/__tests__/issue_3643_reports_retirement.implementor.happy.test.py"
)
TESTER_PATH = (
    "scripts/docs/__tests__/issue_3643_reports_retirement.tester.adversarial.test.py"
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parents[3],
    )
    return parser.parse_args()


def read(root: Path, relative_path: str) -> str:
    return (root / relative_path).read_text(encoding="utf-8")


def require(condition: bool, message: str, failures: list[str]) -> None:
    if not condition:
        failures.append(message)


def tracked_and_untracked_files(root: Path) -> list[str]:
    result = subprocess.run(
        ["git", "ls-files", "-co", "--exclude-standard", "-z"],
        cwd=root,
        check=True,
        stdout=subprocess.PIPE,
    )
    return [path for path in result.stdout.decode("utf-8").split("\0") if path]


def direct_reports_references(root: Path) -> set[str]:
    references: set[str] = set()
    for relative_path in tracked_and_untracked_files(root):
        if relative_path == REPORTS_PATH:
            continue
        path = root / relative_path
        if not path.is_file():
            continue
        data = path.read_bytes()
        if b"\0" in data:
            continue
        if REPORTS_PATH in data.decode("utf-8", errors="replace"):
            references.add(relative_path)
    return references


def workflow_with_display_name(
    root: Path,
    display_name: str,
    failures: list[str],
) -> str:
    matches = []
    for path in sorted((root / ".github" / "workflows").glob("*.y*ml")):
        source = path.read_text(encoding="utf-8")
        if source.startswith(f"name: {display_name}\n"):
            matches.append(source)
    require(
        len(matches) == 1,
        f"exactly one workflow must own the {display_name} display name",
        failures,
    )
    return matches[0] if len(matches) == 1 else ""


def main() -> int:
    root = parse_args().repo_root.resolve()
    failures: list[str] = []

    reports = read(root, REPORTS_PATH)
    shipped_marker = "\n## Shipped\n"
    require(shipped_marker in reports, "historical shipped entries must remain present", failures)
    reports_preamble = reports.split(shipped_marker, 1)[0]
    require(reports.splitlines()[0] == CLOSED_BANNER, "closed-history banner must be line 1", failures)
    require(
        "# Mingla Reports — Historical Shipped-Work Log" in reports_preamble,
        "the ship-log title must identify the file as historical",
        failures,
    )
    for retired_instruction in (
        "single running log",
        "canonical record: if it shipped",
        "Going-forward format",
        "ONE entry is added",
        "Open the pull request first",
    ):
        require(
            retired_instruction not in reports_preamble,
            f"closed history still carries active instruction: {retired_instruction}",
            failures,
        )

    agents = read(root, "AGENTS.md")
    require(
        "release-record comment on the shipping issue" in agents,
        "AGENTS must make the shipping issue comment the release-record authority",
        failures,
    )
    for field in ("PR", "merge commit", "migrations applied", "deploy", "live check"):
        require(field in agents, f"AGENTS release record must require `{field}`", failures)
    require(
        "none`, `N/A`, or `pending" in agents,
        "AGENTS must require explicit none/N/A/pending values",
        failures,
    )
    for retired_instruction in (
        "ship-log line",
        "one `REPORTS.md` line",
        "replace `PR #TBD`",
        "Shipped-work log",
    ):
        require(
            retired_instruction not in agents,
            f"AGENTS still mandates the shared ship log: {retired_instruction}",
            failures,
        )

    readme = read(root, "README.md")
    require(
        "only current release record is a complete release-record comment on the shipping issue" in readme,
        "README Done contract must make the issue comment the only current release record",
        failures,
    )
    require(
        "What shipped, when | [Mingla Avengers board]" in readme,
        "README shipment history must route to the board and issues",
        failures,
    )

    require(
        REPORTS_PATH not in read(root, "app-mobile/README.md"),
        "mobile documentation boundary must not route to the closed log",
        failures,
    )
    require(
        REPORTS_PATH not in read(root, "scripts/docs/check_artifact_placement.py"),
        "artifact placement must not classify the closed log as canonical",
        failures,
    )
    readme_gate = read(root, "scripts/docs/check_readme_snapshot.py")
    require(REPORTS_PATH not in readme_gate, "README snapshot gate still requires the closed log", failures)
    for field in ("PR", "merge commit", "migrations applied", "deploy", "live check"):
        require(field in readme_gate, f"README snapshot gate must protect `{field}`", failures)

    workflow = workflow_with_display_name(root, "Docs Artifact Regression", failures)
    require(REPORTS_PATH not in workflow, "docs workflow still triggers on the closed log", failures)
    require(
        f"python3 {IMPLEMENTOR_PATH} --repo-root ." in workflow,
        "docs workflow must execute the #3643 implementor contract",
        failures,
    )

    link_gate = read(root, ".github/scripts/strict-grep/orch-0860-markdown-link-unescaped-parens.mjs")
    require(REPORTS_PATH not in link_gate, "link gate still scans the closed log as an active root", failures)

    live_routing = read(
        root,
        ".github/scripts/ci-batch/__tests__/issue-3072-live-provider-routing.implementor.test.mjs",
    )
    require(REPORTS_PATH not in live_routing, "live-provider fixture still uses the closed log", failures)
    require(
        live_routing.count('"docs/WORKTREE_STRATEGY.md"') == 2,
        "both live-provider docs-only fixtures must use the stable worktree strategy path",
        failures,
    )

    stale_guidance = read(
        root,
        "scripts/ci/__tests__/issue-2062-expo-config-node20.tester.adversarial.test.mjs",
    )
    require(REPORTS_PATH not in stale_guidance, "stale-guidance scan still special-cases the closed log", failures)
    require(
        CLOSED_BANNER in stale_guidance,
        "stale-guidance scan must exclude closed historical Markdown by the exact banner",
        failures,
    )

    venue_pin = read(
        root,
        "supabase/migrations/__tests__/issue_2855_pending_venue_schema_pin.implementor.test.ts",
    )
    require(REPORTS_PATH not in venue_pin, "#2855 fixture still uses the closed log", failures)
    require(
        venue_pin.count('"AGENTS.md"') == 2,
        "both #2855 non-product fixtures must use the stable process document",
        failures,
    )

    host_gate_workflow = workflow_with_display_name(root, "Strict Grep Gates (Mingla Host)", failures)
    require(
        REPORTS_PATH not in host_gate_workflow,
        "retired shared-log commentary remains in the Mingla Host strict-grep workflow",
        failures,
    )

    for relative_path in (
        "mingla-business/app/attendance/claim.tsx",
        "scripts/ci/main-health.mjs",
        ".github/scripts/strict-grep/issue-2851-pr-concurrency-policy.implementor.test.mjs",
    ):
        require(
            REPORTS_PATH not in read(root, relative_path),
            f"retired shared-log commentary remains in {relative_path}",
            failures,
        )

    allowed_references = {IMPLEMENTOR_PATH}
    if (root / TESTER_PATH).is_file():
        allowed_references.add(TESTER_PATH)
    references = direct_reports_references(root)
    require(
        references == allowed_references,
        "direct closed-log references drifted: "
        f"expected {sorted(allowed_references)}, found {sorted(references)}",
        failures,
    )

    if failures:
        print("#3643 ship-log retirement contract FAILED:")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("#3643 ship-log retirement contract PASS")
    print("- release records are issue comments with all five required fields")
    print("- the historical log is closed without sealing or counting shipped entries")
    print("- former readers and fixtures no longer depend on the shared log")
    print("- the docs lane executes this contract")
    return 0


if __name__ == "__main__":
    sys.exit(main())
