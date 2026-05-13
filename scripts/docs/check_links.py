#!/usr/bin/env python3
"""Check repo-local markdown links for Mingla documentation.

This is intentionally standard-library only so it can run anywhere the repo runs.
By default it reports missing links without failing; use --max-missing 0 for a
strict gate once the known debt is burned down.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from urllib.parse import unquote, urlparse


DEFAULT_SCAN_ROOTS = [
    "README.md",
    "app-mobile/README.md",
    "mingla-admin/README.md",
    "mingla-business/README.md",
    ".github/scripts/strict-grep/README.md",
    "scripts/deferred-migrations/README.md",
    "docs",
    "Mingla_Artifacts",
    "outputs",
    "clade transfer",
]

IGNORED_PARTS = {
    ".git",
    ".expo",
    ".vercel",
    "node_modules",
    "dist",
    # Mingla_Artifacts/prompts is explicitly private/ignored per the
    # mingla-orchestrator skill ("Mingla_Artifacts/prompts/ is private/ignored
    # unless explicitly versioned"). Prompt files often reference memory
    # files that live outside the repo (~/.claude/projects/.../memory/) —
    # scanning them as durable documentation produces false-positives.
    "prompts",
}

EXTERNAL_SCHEMES = {"http", "https", "mailto", "tel", "sms", "ftp"}

LINK_RE = re.compile(r"(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
IMAGE_LINK_RE = re.compile(r"!\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")


@dataclass(frozen=True)
class MissingLink:
    source: str
    line: int
    raw_target: str
    resolved_target: str
    classification: str
    suggested_action: str


def rel(path: Path, root: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return path.as_posix()


def has_ignored_part(path: Path) -> bool:
    return any(part in IGNORED_PARTS for part in path.parts)


def iter_markdown_files(root: Path, scan_roots: list[str]) -> list[Path]:
    files: list[Path] = []
    for raw in scan_roots:
        path = root / raw
        if not path.exists():
            continue
        if path.is_file():
            if path.suffix.lower() in {".md", ".mdx", ".txt"} and not has_ignored_part(path):
                files.append(path)
            continue
        for current, dirs, names in os.walk(path):
            dirs[:] = [d for d in dirs if d not in IGNORED_PARTS]
            current_path = Path(current)
            if has_ignored_part(current_path):
                continue
            for name in names:
                candidate = current_path / name
                if candidate.suffix.lower() in {".md", ".mdx", ".txt"}:
                    files.append(candidate)
    return sorted(set(files))


def build_basename_index(root: Path) -> dict[str, list[Path]]:
    index: dict[str, list[Path]] = defaultdict(list)
    for current, dirs, names in os.walk(root):
        dirs[:] = [d for d in dirs if d not in IGNORED_PARTS]
        current_path = Path(current)
        if has_ignored_part(current_path):
            continue
        for name in names:
            index[name].append(current_path / name)
    return index


def strip_angle_brackets(target: str) -> str:
    if target.startswith("<") and target.endswith(">"):
        return target[1:-1]
    return target


def split_anchor(target: str) -> tuple[str, str]:
    if "#" not in target:
        return target, ""
    base, anchor = target.split("#", 1)
    return base, anchor


def is_external_or_anchor_only(target: str) -> bool:
    if not target or target.startswith("#"):
        return True
    parsed = urlparse(target)
    return bool(parsed.scheme and parsed.scheme.lower() in EXTERNAL_SCHEMES)


def classify_missing(
    source: Path,
    raw_target: str,
    resolved: Path,
    root: Path,
    basename_index: dict[str, list[Path]],
) -> tuple[str, str]:
    raw_parts = Path(raw_target.split("#", 1)[0]).parts
    source_rel = rel(source, root)

    if "prompts" in raw_parts:
        return (
            "PROMPT_PRIVATE_OR_IGNORED",
            "Version the prompt, replace the link with report/spec evidence, or mark PRIVATE_PROMPT_NOT_VERSIONED.",
        )

    if any(part in IGNORED_PARTS for part in raw_parts) or has_ignored_part(resolved):
        return (
            "GENERATED_OR_IGNORED_TARGET",
            "Do not use generated or ignored output as durable documentation evidence.",
        )

    if resolved.name and basename_index.get(resolved.name):
        return (
            "MOVED_OR_ARCHIVED_CANDIDATE",
            "Check candidate paths by basename and redirect through the manifest before moving anything.",
        )

    if (
        source_rel.startswith("Mingla_Artifacts/reports/")
        or source_rel.startswith("Mingla_Artifacts/specs/")
        or source_rel.startswith("outputs/")
        or source_rel.startswith("clade transfer/")
    ):
        return (
            "HISTORICAL_SOURCE_MISSING",
            "Keep as historical evidence; rewrite to a manifest entry or textual citation when the archive pass runs.",
        )

    return (
        "TRUE_MISSING_REFERENCE",
        "Find the correct current artifact/source or remove the link in a later scoped cleanup.",
    )


def extract_links(text: str) -> list[tuple[int, str]]:
    links: list[tuple[int, str]] = []
    for regex in (LINK_RE, IMAGE_LINK_RE):
        for match in regex.finditer(text):
            line = text.count("\n", 0, match.start()) + 1
            links.append((line, strip_angle_brackets(match.group(1).strip())))
    return sorted(links, key=lambda item: item[0])


def audit(root: Path, scan_roots: list[str]) -> dict[str, object]:
    files = iter_markdown_files(root, scan_roots)
    basename_index = build_basename_index(root)
    missing: list[MissingLink] = []
    skipped = Counter()
    total_links = 0

    for source in files:
        text = source.read_text(encoding="utf-8", errors="replace")
        for line, raw_target in extract_links(text):
            total_links += 1
            if is_external_or_anchor_only(raw_target):
                skipped["external_or_anchor_only"] += 1
                continue

            target_no_anchor, _anchor = split_anchor(raw_target)
            if not target_no_anchor:
                skipped["anchor_only"] += 1
                continue

            target_no_anchor = unquote(target_no_anchor)
            resolved = (source.parent / target_no_anchor).resolve()

            if not str(resolved).startswith(str(root)):
                skipped["outside_repo"] += 1
                continue

            if resolved.exists():
                continue

            # Fallback: many Mingla artifacts write links as ROOT-RELATIVE
            # paths (e.g. `Mingla_Artifacts/reports/foo.md` from inside
            # `Mingla_Artifacts/reports/bar.md`). GitHub renders those fine,
            # and the target file genuinely exists at that root-relative
            # path. Try resolving against the repo root before declaring
            # the link missing.
            if not target_no_anchor.startswith(("/", ".")):
                root_resolved = (root / target_no_anchor).resolve()
                if (
                    str(root_resolved).startswith(str(root))
                    and root_resolved.exists()
                ):
                    continue

            classification, suggested_action = classify_missing(
                source=source,
                raw_target=raw_target,
                resolved=resolved,
                root=root,
                basename_index=basename_index,
            )
            missing.append(
                MissingLink(
                    source=rel(source, root),
                    line=line,
                    raw_target=raw_target,
                    resolved_target=rel(resolved, root),
                    classification=classification,
                    suggested_action=suggested_action,
                )
            )

    by_source = Counter(item.source for item in missing)
    by_target = Counter(item.raw_target for item in missing)
    by_class = Counter(item.classification for item in missing)

    return {
        "files_checked": len(files),
        "total_links": total_links,
        "missing_links": len(missing),
        "skipped": dict(sorted(skipped.items())),
        "by_classification": dict(by_class.most_common()),
        "top_sources": by_source.most_common(25),
        "top_targets": by_target.most_common(25),
        "examples": [asdict(item) for item in missing[:50]],
        "missing": [asdict(item) for item in missing],
    }


def render_plain(result: dict[str, object]) -> str:
    lines = [
        f"files_checked={result['files_checked']}",
        f"total_links={result['total_links']}",
        f"missing_links={result['missing_links']}",
        "",
        "missing_by_classification:",
    ]
    for key, value in result["by_classification"].items():
        lines.append(f"  {key}: {value}")
    lines.append("")
    lines.append("top_sources:")
    for source, count in result["top_sources"]:
        lines.append(f"  {count}\t{source}")
    lines.append("")
    lines.append("top_targets:")
    for target, count in result["top_targets"]:
        lines.append(f"  {count}\t{target}")
    return "\n".join(lines)


def render_markdown(result: dict[str, object]) -> str:
    lines = [
        "# Markdown Link Audit",
        "",
        "| Metric | Count |",
        "|---|---:|",
        f"| Files checked | {result['files_checked']} |",
        f"| Total links | {result['total_links']} |",
        f"| Missing links | {result['missing_links']} |",
        "",
        "## Missing By Classification",
        "",
        "| Classification | Count |",
        "|---|---:|",
    ]
    for key, value in result["by_classification"].items():
        lines.append(f"| `{key}` | {value} |")

    lines.extend(["", "## Top Sources", "", "| Missing | Source |", "|---:|---|"])
    for source, count in result["top_sources"]:
        lines.append(f"| {count} | `{source}` |")

    lines.extend(["", "## Top Targets", "", "| Missing | Target |", "|---:|---|"])
    for target, count in result["top_targets"]:
        lines.append(f"| {count} | `{target}` |")

    lines.extend(
        [
            "",
            "## Representative Examples",
            "",
            "| Source | Line | Target | Classification | Suggested Action |",
            "|---|---:|---|---|---|",
        ]
    )
    for item in result["examples"]:
        lines.append(
            "| `{source}` | {line} | `{raw_target}` | `{classification}` | {suggested_action} |".format(
                **item
            )
        )
    return "\n".join(lines)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=".", help="Repo root. Defaults to current directory.")
    parser.add_argument(
        "--format",
        choices=("plain", "markdown", "json"),
        default="plain",
        help="Output format.",
    )
    parser.add_argument(
        "--max-missing",
        type=int,
        default=None,
        help="Exit non-zero when missing link count exceeds this value.",
    )
    parser.add_argument(
        "--baseline-file",
        default=None,
        help="JSON file containing max_missing for the regression gate.",
    )
    parser.add_argument(
        "--scan-root",
        action="append",
        default=None,
        help="Override default scan roots. Repeatable.",
    )
    return parser.parse_args(argv)


def read_baseline_max_missing(root: Path, baseline_file: str) -> int:
    path = Path(baseline_file)
    if not path.is_absolute():
        path = root / path

    data = json.loads(path.read_text(encoding="utf-8"))
    value = data.get("max_missing")
    if not isinstance(value, int):
        raise ValueError(f"{path} must contain integer field max_missing")
    return value


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    root = Path(args.root).resolve()
    scan_roots = args.scan_root if args.scan_root else DEFAULT_SCAN_ROOTS
    result = audit(root, scan_roots)
    max_missing = args.max_missing
    if args.baseline_file:
        max_missing = read_baseline_max_missing(root, args.baseline_file)

    if args.format == "json":
        print(json.dumps(result, indent=2, sort_keys=True))
    elif args.format == "markdown":
        print(render_markdown(result))
    else:
        print(render_plain(result))

    if max_missing is not None and int(result["missing_links"]) > max_missing:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
