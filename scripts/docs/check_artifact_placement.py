#!/usr/bin/env python3
"""Check Mingla documentation/artifact placement invariants."""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]

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
    for required in (".claude/", ".codex/", "outputs/", "Mingla_Artifacts/prompts/"):
        require(required in text, f".gitignore must keep `{required}` ignored/private", failures)


def check_breadcrumbs(failures: list[str]) -> None:
    breadcrumbs = {
        "Mingla_Artifacts/SPEC_QUEUE.md": "archive/old_trackers/SPEC_QUEUE.md",
        "Mingla_Artifacts/TEST_QUEUE.md": "archive/old_trackers/TEST_QUEUE.md",
        "Mingla_Artifacts/RETEST_LEDGER.md": "archive/old_trackers/RETEST_LEDGER.md",
    }
    for path, archive_target in breadcrumbs.items():
        full_path = ROOT / path
        require(full_path.exists(), f"{path} breadcrumb is missing", failures)
        if not full_path.exists():
            continue
        text = full_path.read_text(encoding="utf-8")
        require("DEPRECATED" in text, f"{path} must stay labeled deprecated", failures)
        require("AGENT_HANDOFFS.md" in text, f"{path} must point to AGENT_HANDOFFS.md", failures)
        require(archive_target in text, f"{path} must point to {archive_target}", failures)


def check_archive_index(failures: list[str]) -> None:
    text = read("Mingla_Artifacts/archive/README.md")
    for required in (
        "Mingla_Artifacts/ARTIFACT_MANIFEST.md",
        "outputs_legacy/",
        "handoffs_legacy/",
        "old_trackers/",
    ):
        require(required in text, f"archive README must mention `{required}`", failures)


def check_roadmap_system(failures: list[str]) -> None:
    required_paths = (
        "Mingla_Roadmap/README.md",
        "Mingla_Roadmap/ROADMAP_MANIFEST.md",
        "Mingla_Roadmap/FEATURE_REGISTRY.md",
        "Mingla_Roadmap/HIGH_LEVEL_ROADMAP.md",
        "Mingla_Roadmap/CURRENT_BUILD.md",
        "Mingla_Roadmap/NEXT_UP.md",
        "Mingla_Roadmap/living/PRODUCT_STRATEGY.md",
        "Mingla_Roadmap/living/GTM_AND_POSITIONING.md",
        "Mingla_Roadmap/living/CUSTOMER_AND_ICP.md",
        "Mingla_Roadmap/living/FEATURE_PORTFOLIO.md",
        "Mingla_Roadmap/archive/README.md",
        "Mingla_Roadmap/drafts/README.md",
    )
    for path in required_paths:
        require((ROOT / path).exists(), f"roadmap system path is missing: {path}", failures)

    manifest = ROOT / "Mingla_Roadmap/ROADMAP_MANIFEST.md"
    if manifest.exists():
        text = manifest.read_text(encoding="utf-8")
        for required in ("living/", "source-summaries/", "drafts/", "archive/", "Mingla_Artifacts/ARTIFACT_MANIFEST.md"):
            require(required in text, f"roadmap manifest must mention `{required}`", failures)


def main() -> int:
    failures: list[str] = []

    require(not git_ls_files("outputs"), "tracked files must not live under root outputs/", failures)
    require(not git_ls_files("clade transfer"), "tracked files must not live under root clade transfer/", failures)

    generated = tracked_existing_generated_outputs()
    for path in generated:
        failures.append(f"tracked generated output exists in worktree: {path}")

    check_gitignore(failures)
    check_breadcrumbs(failures)
    check_archive_index(failures)
    check_roadmap_system(failures)
    check_skill_output_destinations(failures)

    if failures:
        print("Artifact placement check FAILED:")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("Artifact placement check PASS")
    print("- no tracked files under root outputs/ or clade transfer/")
    print("- no tracked existing dist/build/web-build artifacts")
    print("- private prompt/tool roots remain ignored")
    print("- deprecated queues remain breadcrumbs")
    print("- Mingla skills avoid stale outputs/* current destinations")
    print("- Mingla roadmap system paths remain present")
    return 0


if __name__ == "__main__":
    sys.exit(main())
