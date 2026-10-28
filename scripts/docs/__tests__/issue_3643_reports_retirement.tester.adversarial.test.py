#!/usr/bin/env python3
"""Issue #3643 adversarial guard for issue-owned release records and CI reachability."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


CLOSED_BANNER = (
    "> **Closed 2026-10-14.** Historical record only; do not add new entries. "
    "Current release records live on the shipping GitHub issue."
)
REPORTS_PATH = "REPORTS.md"
IMPLEMENTOR_COMMAND = (
    "python3 scripts/docs/__tests__/"
    "issue_3643_reports_retirement.implementor.happy.test.py --repo-root ."
)
TESTER_COMMAND = (
    "python3 scripts/docs/__tests__/"
    "issue_3643_reports_retirement.tester.adversarial.test.py --repo-root ."
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


def workflow_with_display_name(
    root: Path,
    display_name: str,
    failures: list[str],
) -> tuple[Path | None, str]:
    matches: list[tuple[Path, str]] = []
    for path in sorted((root / ".github" / "workflows").glob("*.y*ml")):
        source = path.read_text(encoding="utf-8")
        if source.startswith(f"name: {display_name}\n"):
            matches.append((path, source))
    require(
        len(matches) == 1,
        f"exactly one workflow must own the {display_name} display name",
        failures,
    )
    return matches[0] if len(matches) == 1 else (None, "")


def command_is_separate_step(source: str, command: str) -> bool:
    return bool(
        re.search(
            rf"(?m)^\s+- name: [^\n]+\n\s+run: {re.escape(command)}\s*$",
            source,
        )
    )


def process_contract_is_issue_owned(root: Path, failures: list[str]) -> None:
    reports = read(root, REPORTS_PATH)
    lines = reports.splitlines()
    require(bool(lines), "historical record must not be empty", failures)
    require(
        bool(lines) and lines[0] == CLOSED_BANNER,
        "historical record must begin with the exact closed-history banner",
        failures,
    )
    require("\n## Shipped\n" in reports, "historical shipped section must remain", failures)
    # Deliberately do not read, count, hash, order, or otherwise seal the body below
    # `## Shipped`; already-open pull requests may add grandfathered history.

    agents = read(root, "AGENTS.md")
    readme = read(root, "README.md")
    mobile_readme = read(root, "app-mobile/README.md")

    shipping_rule = next(
        (line for line in agents.splitlines() if line.startswith("- When something ships,")),
        "",
    )
    require(
        "release-record comment on the shipping issue" in shipping_rule
        and "after merge" in shipping_rule,
        "AGENTS must make the issue comment a post-merge action, never a PR-time shared edit",
        failures,
    )
    for field in ("PR", "merge commit", "migrations applied", "deploy", "live check"):
        require(
            field in shipping_rule,
            f"the atomic AGENTS release-record rule must name `{field}`",
            failures,
        )

    done_row = next(
        (line for line in readme.splitlines() if line.startswith("| 6. Done |")),
        "",
    )
    require(
        "only current release record" in done_row
        and "release-record comment on the shipping issue" in done_row,
        "README Done must identify one current release-record authority: the shipping issue",
        failures,
    )
    require(
        "Mingla Avengers board" in readme and "shipping issues" in readme,
        "README must route shipped history to the board and shipping issues",
        failures,
    )

    active_process_sources = {
        "AGENTS.md": agents,
        "README.md": readme,
        "app-mobile/README.md": mobile_readme,
    }
    old_mandate = re.compile(
        r"(?is)(?:every|each|one)\s+(?:shipping\s+)?(?:pull request|PR)"
        r".{0,120}(?:add|append|edit|write).{0,100}"
        r"(?:ship(?:ped)?[- ](?:log|work)|shipped-work log|release[- ]log)"
    )
    for relative_path, source in active_process_sources.items():
        require(
            REPORTS_PATH not in source,
            f"active process guidance still links the closed record: {relative_path}",
            failures,
        )
        require(
            old_mandate.search(source) is None,
            f"active process guidance recreated a per-PR ship-log mandate: {relative_path}",
            failures,
        )


def docs_ci_is_fail_closed(root: Path, failures: list[str]) -> None:
    workflow_path, workflow = workflow_with_display_name(
        root,
        "Docs Artifact Regression",
        failures,
    )
    if not workflow:
        return

    require(
        REPORTS_PATH not in workflow,
        "closed history must not allocate the docs workflow",
        failures,
    )
    for command in (IMPLEMENTOR_COMMAND, TESTER_COMMAND):
        require(
            workflow.count(command) == 1,
            f"docs CI must invoke exactly once: {command}",
            failures,
        )
        require(
            command_is_separate_step(workflow, command),
            f"docs CI must run the guard as its own named step: {command}",
            failures,
        )

    for command in (
        "python3 scripts/docs/check_links.py --format markdown --baseline-file scripts/docs/link_baseline.json",
        "python3 scripts/docs/check_artifact_placement.py",
        "python3 scripts/docs/check_readme_snapshot.py",
    ):
        require(
            command in workflow,
            f"active docs protection is no longer CI-reachable: {command}",
            failures,
        )

    require(
        workflow.count('"scripts/docs/**"') == 2,
        "both pull-request and main-push docs triggers must cover the two guards",
        failures,
    )
    if workflow_path is not None:
        discovered_path = workflow_path.relative_to(root).as_posix()
        require(
            workflow.count(f'"{discovered_path}"') == 2,
            "the docs workflow must trigger on changes to its discovered workflow file",
            failures,
        )
    require(
        "cancel-in-progress: ${{ github.event_name == 'pull_request'" in workflow,
        "docs CI must keep PR-only cancellation while main verification completes",
        failures,
    )


def generic_protections_remain_reachable(root: Path, failures: list[str]) -> None:
    link_gate_path = ".github/scripts/strict-grep/orch-0860-markdown-link-unescaped-parens.mjs"
    strict_manifest = json.loads(read(root, ".github/scripts/strict-grep/MANIFEST.json"))
    link_entries = [
        entry
        for entry in strict_manifest.get("gates", [])
        if entry.get("script") == link_gate_path
    ]
    require(
        len(link_entries) == 1 and link_entries[0].get("enforcement") == "batch:A",
        "the active Markdown-link gate must remain registered in fail-closed class A",
        failures,
    )
    _, host_workflow = workflow_with_display_name(
        root,
        "Strict Grep Gates (Mingla Host)",
        failures,
    )
    require(
        "node .github/scripts/strict-grep/run-batch.mjs --class A" in host_workflow,
        "strict-grep class A must remain CI-reachable",
        failures,
    )

    live_routing_path = (
        ".github/scripts/ci-batch/__tests__/"
        "issue-3072-live-provider-routing.implementor.test.mjs"
    )
    _, batch_workflow = workflow_with_display_name(
        root,
        "CI batch (per-issue suites)",
        failures,
    )
    require(
        live_routing_path in batch_workflow,
        "the docs-only routing and push-backstop proof must remain CI-reachable",
        failures,
    )
    live_routing = read(root, live_routing_path)
    require(
        'test("13. a change routing SKIPS on a pull request is still executed by the push-to-main run"' in live_routing
        and 'GITHUB_EVENT_NAME: "push"' in live_routing
        and "declaresBackstopPushToMain(provider)" in live_routing,
        "the push-backstop adversarial assertion must remain load-bearing",
        failures,
    )

    stale_path = "scripts/ci/__tests__/issue-2062-expo-config-node20.tester.adversarial.test.mjs"
    ci_manifest = read(root, ".github/ci-batch/MANIFEST.json")
    require(
        f"node --test {stale_path}" in ci_manifest,
        "the active stale-guidance inventory must remain CI-reachable",
        failures,
    )
    stale_source = read(root, stale_path)
    exact_exclusion = (
        'if (relativePath.endsWith(".md") && '
        'source.startsWith(`${CLOSED_HISTORY_BANNER}\\n`)) continue;'
    )
    require(
        exact_exclusion in stale_source,
        "closed-history exclusion must require Markdown plus the exact line-1 banner",
        failures,
    )
    require(
        "for (const [lineIndex, line] of source.split" in stale_source,
        "active tracked guidance must still be scanned after the narrow history exclusion",
        failures,
    )

    venue_test_path = (
        "supabase/migrations/__tests__/"
        "issue_2855_pending_venue_schema_pin.implementor.test.ts"
    )
    _, venue_workflow = workflow_with_display_name(
        root,
        "issue-2099-pending-venue-identity-correction",
        failures,
    )
    require(
        venue_test_path in venue_workflow,
        "the shared bundle-verdict regression must remain CI-reachable",
        failures,
    )
    venue_source = read(root, venue_test_path)
    # [TEST-MOD-APPROVED #3493] The six-file classifier let a Business bundle
    # change merge green and fail only on main. Preserve the replacement proof,
    # including #3643's two non-product process-document fixtures.
    require(
        'Deno.test("#2855/#3493 SC-4 reuses the universal verdict without a private scope skip"'
        in venue_source
        and 'CURRENT_DIFF_NON_PRODUCT_FIXTURE = "AGENTS.md"' in venue_source
        and 'EXCLUDED_NON_PRODUCT_FIXTURE = "AGENTS.md"' in venue_source
        and "for (const processDoc of [" in venue_source
        and "bundle-baseline-movement\\.mjs" in venue_source,
        "the #2855/#3493 guard must protect universal measurement and both non-product fixtures",
        failures,
    )


def main() -> int:
    root = parse_args().repo_root.resolve()
    failures: list[str] = []

    process_contract_is_issue_owned(root, failures)
    docs_ci_is_fail_closed(root, failures)
    generic_protections_remain_reachable(root, failures)

    if failures:
        print("#3643 tester adversarial contract FAILED:")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("#3643 tester adversarial contract PASS")
    print("- the issue release record is atomic, post-merge and the sole current authority")
    print("- grandfathered historical entries remain unconstrained below the shipped marker")
    print("- both #3643 guards run as separate docs-CI steps discovered by display name")
    print("- link, routing, stale-guidance and exact product-path protections remain CI-reachable")
    return 0


if __name__ == "__main__":
    sys.exit(main())
