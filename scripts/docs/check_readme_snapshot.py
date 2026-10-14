#!/usr/bin/env python3
"""Check that README remains a snapshot front door for the Avengers-era repo."""

from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
README = ROOT / "README.md"

BOARD_URL = "https://github.com/orgs/Mingla-LLC/projects/4"


def require(condition: bool, message: str, failures: list[str]) -> None:
    if not condition:
        failures.append(message)


def repo_map_block(text: str) -> str:
    match = re.search(r"## Repo Map\n\n```text\n(?P<body>.*?)\n```", text, re.DOTALL)
    return match.group("body") if match else ""


def main() -> int:
    text = README.read_text(encoding="utf-8")
    failures: list[str] = []

    required = (
        "README is a snapshot",
        BOARD_URL,
        "PRODUCT_AND_STRATEGY.md",
        "MARKETING.md",
        "AGENTS.md",
        "docs/INVARIANT_REGISTRY.md",
        "pre-avengers-archive",
        "python3 scripts/docs/check_links.py --baseline-file scripts/docs/link_baseline.json",
        "python3 scripts/docs/check_artifact_placement.py",
        "python3 scripts/docs/check_readme_snapshot.py",
    )
    for needle in required:
        require(needle in text, f"README must contain `{needle}`", failures)
    # #3476: the COMMS.md coordination table is retired; the front door must not send chats to it.
    require("COMMS.md" not in text, "README must not point at the retired COMMS.md (#3476)", failures)

    source_table = re.search(
        r"## Source Of Truth\n(?P<body>.*?)(?:\n## |\Z)",
        text,
        re.DOTALL,
    )
    require(source_table is not None, "README must contain a Source Of Truth section", failures)
    if source_table:
        source_body = source_table.group("body")
        require(
            BOARD_URL in source_body,
            "Source Of Truth must point to the Mingla Avengers board",
            failures,
        )
        for doc in ("PRODUCT_AND_STRATEGY.md", "MARKETING.md", "AGENTS.md"):
            require(
                doc in source_body,
                f"Source Of Truth must point to {doc}",
                failures,
            )
        require(
            "Mingla Avengers board" in source_body and "shipping issues" in source_body,
            "Source Of Truth must route shipped-work history to the board and shipping issues",
            failures,
        )

    require(
        "complete release-record comment on the shipping issue" in text,
        "README Done contract must require a complete release record on the shipping issue",
        failures,
    )
    for field in ("PR", "merge commit", "migrations applied", "deploy", "live check"):
        require(field in text, f"README release record must name `{field}`", failures)

    require(
        "Historical engineering invariant record" in text
        and "(frozen)" in text
        and "current declarations live beside their enforcing gates or tests" in text,
        "README must describe the invariant registry as frozen history and route current declarations locally",
        failures,
    )

    repo_map = repo_map_block(text)
    require(repo_map, "README must contain a fenced Repo Map block", failures)
    if repo_map:
        for active_root in (
            "app-mobile/",
            "mingla-business/",
            "mingla-admin/",
            "mingla-marketing/",
            "supabase/",
            "docs/",
        ):
            require(active_root in repo_map, f"Repo Map must include {active_root}", failures)
        for stale_root in ("Mingla_Artifacts/", "Mingla_Roadmap/", "outputs/", "clade transfer/"):
            require(stale_root not in repo_map, f"Repo Map must not list `{stale_root}` as active", failures)

    if failures:
        print("README snapshot check FAILED:")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("README snapshot check PASS")
    print("- README declares itself a snapshot")
    print("- source-of-truth links point to the Avengers board, shipping issues and canonical docs")
    print("- the Done contract requires all five release-record fields")
    print("- invariant guidance points to frozen history plus local enforcing declarations")
    print("- docs lock-in commands are present")
    print("- repo map lists only active roots")
    return 0


if __name__ == "__main__":
    sys.exit(main())
