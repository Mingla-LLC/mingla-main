#!/usr/bin/env python3
"""Check that README remains a snapshot front door, not a second manifest."""

from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
README = ROOT / "README.md"


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
        "Mingla_Artifacts/ARTIFACT_MANIFEST.md",
        "Mingla_Artifacts/archive/README.md",
        "Mingla_Artifacts/reports/ORCH-0750A_LINK_AUDIT.md",
        "python3 scripts/docs/check_links.py --baseline-file scripts/docs/link_baseline.json",
        "python3 scripts/docs/check_artifact_placement.py",
        "python3 scripts/docs/check_readme_snapshot.py",
    )
    for needle in required:
        require(needle in text, f"README must contain `{needle}`", failures)

    source_table = re.search(
        r"## Source Of Truth\n(?P<body>.*?)(?:\n## |\Z)",
        text,
        re.DOTALL,
    )
    require(source_table is not None, "README must contain a Source Of Truth section", failures)
    if source_table:
        source_body = source_table.group("body")
        require(
            "Mingla_Artifacts/ARTIFACT_MANIFEST.md" in source_body,
            "Source Of Truth must point to the artifact manifest",
            failures,
        )
        require(
            "Mingla_Artifacts/archive/README.md" in source_body,
            "Source Of Truth must point to the archive index",
            failures,
        )

    repo_map = repo_map_block(text)
    require(repo_map, "README must contain a fenced Repo Map block", failures)
    if repo_map:
        require("Mingla_Artifacts/" in repo_map, "Repo Map must include Mingla_Artifacts/", failures)
        require("archive/" in repo_map, "Repo Map must include the archive under Mingla_Artifacts/", failures)
        for stale_root in ("outputs/", "clade transfer/"):
            require(stale_root not in repo_map, f"Repo Map must not list `{stale_root}` as active", failures)

    if failures:
        print("README snapshot check FAILED:")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("README snapshot check PASS")
    print("- README declares itself a snapshot")
    print("- source-of-truth links point to manifest/archive authorities")
    print("- docs lock-in commands are present")
    print("- repo map avoids stale active docs roots")
    return 0


if __name__ == "__main__":
    sys.exit(main())
