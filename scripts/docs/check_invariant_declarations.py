#!/usr/bin/env python3
"""Fail-closed guard for the frozen invariant history and local declarations."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path, PurePosixPath


REGISTRY_PATH = "docs/INVARIANT_REGISTRY.md"
BANNER = (
    "> **FROZEN 2026-10-14.** Historical record only—do not add, edit, remove, "
    "reorder, or change status here. New invariants are declared beside their "
    "enforcing gate or test; lifecycle, decisions, and evidence live on the GitHub issue."
)
TRANSITION_PATCH_IDS = frozenset(
    {
        "0c55b3d404c76f3a543ec9769e18ec367e892f5c",
        "b16ccf7e8dd956f42c5fcd4de7f7c770bb66be12",
    }
)
REGISTRY_BYTES = REGISTRY_PATH.encode()
DECLARATION_RE = re.compile(
    r"^(?P<indent>\s*)(?P<comment>//|#|--) MINGLA-INVARIANT: "
    r"(?P<id>I-[A-Z0-9][A-Z0-9-]*) \| issue #(?P<issue>[1-9][0-9]*) \| "
    r"(?P<rule>[^|\r\n]+)$"
)
WORKFLOW_LITERAL_RE = re.compile(r"\.github/workflows/[A-Za-z0-9_./-]+\.ya?ml\b")
LIFECYCLE_RE = re.compile(r"\b(?:DRAFT|ACTIVE|RETIRED)\b", re.IGNORECASE)

POLICY_REF_SURFACES = frozenset(
    {
        "AGENTS.md",
        "README.md",
        ".github/scripts/strict-grep/README.md",
        ".github/skills/code-review/SKILL.md",
        "scripts/docs/check_artifact_placement.py",
        "scripts/docs/check_readme_snapshot.py",
        "scripts/docs/check_invariant_declarations.py",
        "scripts/docs/__tests__/issue_3643_invariant_registry_freeze.implementor.happy.test.py",
        "scripts/docs/__tests__/issue_3643_invariant_registry_freeze.tester.adversarial.test.py",
        REGISTRY_PATH,
    }
)

READER_PATHS = frozenset(
    {
        ".github/scripts/strict-grep/issue-1436-secret-capacity-exit.mjs",
        ".github/scripts/strict-grep/issue-1772-brand-person-maintenance.happy.mjs",
        ".github/scripts/strict-grep/issue-1772-brand-person-maintenance.happy.self-test.mjs",
        ".github/scripts/strict-grep/issue-1773-reservation-stay-ingest.mjs",
        ".github/scripts/strict-grep/issue-1777-brand-circle-reach.mjs",
        ".github/scripts/strict-grep/issue-1817-free-plan-invite-send.mjs",
        ".github/scripts/strict-grep/issue-1821-accepted-email-sms-invites.mjs",
        ".github/scripts/strict-grep/issue-1857-phone-country-authority.mjs",
        ".github/scripts/strict-grep/issue-1858-explicit-brand-export.mjs",
        ".github/scripts/strict-grep/issue-1863-payments-permission-gate.mjs",
        ".github/scripts/strict-grep/issue-1902-rsvp-backend-safety.mjs",
        ".github/scripts/strict-grep/issue-2060-ari-reliability-foundation.mjs",
        ".github/scripts/strict-grep/issue-2714-campaign-open-truth.mjs",
        ".github/scripts/strict-grep/issue-2719-brand-payout-first.mjs",
        ".github/scripts/strict-grep/issue-2830-sites-foundation.mjs",
        ".github/scripts/strict-grep/issue-2981-marketing-search-foundation.mjs",
        ".github/scripts/strict-grep/issue-3060-attendance-noncustomer-closure.mjs",
        "app-mobile/src/components/swipeDeck/__tests__/issue_1579_tap_expand_admission.adversarial.test.mjs",
        "mingla-admin/src/__tests__/orch1272_identity_console_read.test.js",
        "mingla-admin/src/__tests__/orch1273_offerings_console_read.test.js",
        "mingla-business/src/utils/__tests__/orch_0893_adversarial_edit_route_wrapper.test.ts",
    }
)


class GuardFailure(RuntimeError):
    """A validation failure that should produce a concise CI diagnostic."""


@dataclass(frozen=True)
class Declaration:
    invariant_id: str
    issue: int
    rule: str
    path: str
    line: int


class GitTree:
    def __init__(self, root: Path) -> None:
        self.root = root

    def run(self, *args: str, input_bytes: bytes | None = None) -> bytes:
        proc = subprocess.run(
            ["git", *args],
            cwd=self.root,
            input=input_bytes,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        if proc.returncode != 0:
            detail = proc.stderr.decode("utf-8", errors="replace").strip()
            raise GuardFailure(f"git {' '.join(args)} failed: {detail or 'unknown error'}")
        return proc.stdout

    def commit(self, value: str, label: str) -> str:
        if not value or value == "0" * 40:
            raise GuardFailure(f"{label} is missing or all zeroes")
        resolved = self.run("rev-parse", "--verify", f"{value}^{{commit}}").decode().strip()
        if not re.fullmatch(r"[0-9a-f]{40}", resolved):
            raise GuardFailure(f"{label} did not resolve to a commit")
        return resolved

    def merge_base(self, base: str, head: str) -> str:
        value = self.run("merge-base", base, head).decode().strip()
        if not re.fullmatch(r"[0-9a-f]{40}", value):
            raise GuardFailure("base and head have no readable merge base")
        return value

    def files(self, commit: str) -> list[str]:
        raw = self.run("ls-tree", "-r", "--name-only", "-z", commit)
        return [item.decode("utf-8") for item in raw.split(b"\0") if item]

    def grep(self, commit: str, pattern: str, *options: str) -> bytes:
        proc = subprocess.run(
            ["git", "grep", *options, pattern, commit, "--"],
            cwd=self.root,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        if proc.returncode == 1:
            return b""
        if proc.returncode != 0:
            detail = proc.stderr.decode("utf-8", errors="replace").strip()
            raise GuardFailure(f"git grep failed: {detail or 'unknown error'}")
        return proc.stdout

    def blob(self, commit: str, path: str, *, required: bool = True) -> bytes:
        proc = subprocess.run(
            ["git", "show", f"{commit}:{path}"],
            cwd=self.root,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        if proc.returncode == 0:
            return proc.stdout
        if not required:
            return b""
        detail = proc.stderr.decode("utf-8", errors="replace").strip()
        raise GuardFailure(f"cannot read {path} at {commit}: {detail or 'unknown error'}")

    def diff(self, base: str, head: str, *paths: str, unified: int | None = None) -> bytes:
        args = ["diff", "--no-ext-diff", "--binary"]
        if unified is not None:
            args.append(f"--unified={unified}")
        args.extend([base, head, "--", *paths])
        return self.run(*args)


def stable_patch_id(git: GitTree, merge_base: str, head: str) -> str:
    patch = git.diff(merge_base, head, REGISTRY_PATH)
    if not patch:
        raise GuardFailure("pre-freeze transition has an empty registry patch")
    output = git.run("patch-id", "--stable", input_bytes=patch).decode().strip().splitlines()
    if len(output) != 1:
        raise GuardFailure("registry transition did not produce exactly one stable patch identity")
    fields = output[0].split()
    if len(fields) != 2 or not re.fullmatch(r"[0-9a-f]{40}", fields[0]):
        raise GuardFailure("registry transition produced a malformed stable patch identity")
    return fields[0]


def classify_freeze(
    git: GitTree, base: str, head: str, merge_base: str
) -> tuple[str, bytes, bytes]:
    base_body = git.blob(base, REGISTRY_PATH)
    head_body = git.blob(head, REGISTRY_PATH)
    banner_prefix = (BANNER + "\n\n").encode()

    if head_body == banner_prefix + base_body:
        return "bootstrap", base_body, head_body
    if head_body == base_body and head_body.startswith(banner_prefix):
        return "frozen", base_body, head_body
    if head_body.startswith(banner_prefix):
        raise GuardFailure("frozen invariant history changed after the banner")

    patch_id = stable_patch_id(git, merge_base, head)
    if patch_id not in TRANSITION_PATCH_IDS:
        raise GuardFailure(f"unrecognized pre-freeze registry patch identity: {patch_id}")
    return "transition", base_body, head_body


def owner_comment(path: str) -> str | None:
    pure = PurePosixPath(path)
    suffix = pure.suffix.lower()
    if suffix in {".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"}:
        return "//"
    if suffix in {".py", ".sh", ".bash", ".zsh"}:
        return "#"
    if suffix == ".sql" and ("__tests__" in pure.parts or ".test." in pure.name):
        return "--"
    return None


def is_supported_owner(path: str) -> bool:
    pure = PurePosixPath(path)
    parts = pure.parts
    if path.startswith(".github/workflows/"):
        return False
    if any(part in {"node_modules", "vendor", "generated", "dist", "build"} for part in parts):
        return False
    route_ok = (
        path.startswith(".github/scripts/strict-grep/")
        or path.startswith("scripts/")
        or "__tests__" in parts
        or ".test." in pure.name
        or ".spec." in pure.name
    )
    if not route_ok or owner_comment(path) is None:
        return False
    if suffix_is_ordinary_migration(path):
        return False
    return True


def suffix_is_ordinary_migration(path: str) -> bool:
    pure = PurePosixPath(path)
    return (
        pure.suffix.lower() == ".sql"
        and path.startswith("supabase/migrations/")
        and "__tests__" not in pure.parts
        and ".test." not in pure.name
    )


def text_blob(
    git: GitTree, commit: str, path: str, *, required: bool = True
) -> str | None:
    raw = git.blob(commit, path, required=required)
    if b"\0" in raw:
        return None
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return None


def collect_declarations(git: GitTree, head: str, files: list[str]) -> dict[str, Declaration]:
    declarations: dict[str, list[Declaration]] = defaultdict(list)
    errors: list[str] = []
    del files
    output = git.grep(head, "MINGLA-INVARIANT", "-I", "-n")
    prefix = f"{head}:"
    for raw in output.decode("utf-8").splitlines():
        if not raw.startswith(prefix):
            raise GuardFailure("git grep returned a malformed declaration location")
        path, line_number, line = raw[len(prefix) :].split(":", 2)
        stripped = line.lstrip()
        if not any(
            stripped.startswith(comment) and "MINGLA-INVARIANT" in stripped
            for comment in ("//", "#", "--")
        ):
            continue
        try:
            line_no = int(line_number)
        except ValueError as exc:
            raise GuardFailure("git grep returned a malformed declaration line number") from exc
        match = DECLARATION_RE.fullmatch(line)
        if match is None:
            errors.append(f"{path}:{line_no}: malformed invariant declaration")
            continue
        if line_no > 60:
            errors.append(f"{path}:{line_no}: invariant declaration is after line 60")
            continue
        if not is_supported_owner(path):
            errors.append(f"{path}:{line_no}: unsupported invariant owner")
            continue
        expected_comment = owner_comment(path)
        if match.group("comment") != expected_comment:
            errors.append(f"{path}:{line_no}: unsupported comment syntax for owner type")
            continue
        rule = match.group("rule")
        if rule != rule.strip() or not 20 <= len(rule) <= 500:
            errors.append(f"{path}:{line_no}: rule must be trimmed and 20–500 characters")
            continue
        if LIFECYCLE_RE.search(rule):
            errors.append(f"{path}:{line_no}: lifecycle terms belong on the issue")
            continue
        declarations[match.group("id")].append(
            Declaration(
                invariant_id=match.group("id"),
                issue=int(match.group("issue")),
                rule=rule,
                path=path,
                line=line_no,
            )
        )
    for invariant_id, owners in declarations.items():
        if len(owners) != 1:
            locations = ", ".join(f"{item.path}:{item.line}" for item in owners)
            errors.append(f"{invariant_id}: expected exactly one owner, found {locations}")
    if errors:
        raise GuardFailure("invalid local declarations:\n  " + "\n  ".join(errors))
    return {key: values[0] for key, values in declarations.items()}


def invariant_ids(git: GitTree, commit: str, files: list[str]) -> set[str]:
    del files
    output = git.grep(commit, r"I-[A-Z0-9][A-Z0-9-]*", "-I", "-h", "-o", "-E")
    return set(output.decode("utf-8").splitlines())


def check_new_ids(
    git: GitTree,
    base: str,
    head: str,
    base_files: list[str],
    head_files: list[str],
    declarations: dict[str, Declaration],
) -> None:
    new_ids = invariant_ids(git, head, head_files) - invariant_ids(git, base, base_files)
    changed = set(
        git.run("diff", "--name-only", "-z", base, head).decode("utf-8").split("\0")
    )
    missing = sorted(
        invariant_id
        for invariant_id in new_ids
        if invariant_id not in declarations or declarations[invariant_id].path not in changed
    )
    if missing:
        raise GuardFailure(
            "new invariant-like IDs require one declaration in a changed enforcing file: "
            + ", ".join(missing)
        )


def workflow_display_name(text: str, path: str) -> str:
    for line in text.splitlines():
        match = re.fullmatch(r"name:\s*(.+?)\s*", line)
        if match:
            return match.group(1).strip('"\'')
    raise GuardFailure(f"workflow has no discoverable display name: {path}")


def check_workflow_routing(git: GitTree, head: str, files: list[str]) -> None:
    workflows: dict[str, tuple[str, str]] = {}
    comment_refs = 0
    noncomment_refs: list[tuple[str, str, str]] = []
    for path in files:
        if not path.startswith(".github/workflows/") or not path.endswith((".yml", ".yaml")):
            continue
        text = text_blob(git, head, path)
        if text is None:
            raise GuardFailure(f"workflow is not readable UTF-8 text: {path}")
        name = workflow_display_name(text, path)
        if name in workflows:
            raise GuardFailure(f"duplicate workflow display name: {name}")
        workflows[name] = (path, text)
        for line in text.splitlines():
            if REGISTRY_PATH not in line:
                continue
            if line.lstrip().startswith("#"):
                comment_refs += 1
            else:
                noncomment_refs.append((name, path, line.strip()))

    broad_name = "Strict Grep Gates (Mingla Host)"
    docs_name = "Docs Artifact Regression"
    if broad_name not in workflows or docs_name not in workflows:
        raise GuardFailure("required strict/docs workflow display names were not discovered")
    invalid = [
        (name, path, line)
        for name, path, line in noncomment_refs
        if name != broad_name or f"!{REGISTRY_PATH}" not in line
    ]
    if invalid:
        details = ", ".join(f"{path}: {line}" for _, path, line in invalid)
        raise GuardFailure(f"functional workflows still route on frozen history: {details}")
    broad_text = workflows[broad_name][1]
    broad_lines = broad_text.splitlines()
    docs_positions = [index for index, line in enumerate(broad_lines) if '"docs/**"' in line]
    exclusion_positions = [
        index for index, line in enumerate(broad_lines) if f'"!{REGISTRY_PATH}"' in line
    ]
    if (
        len(docs_positions) != 2
        or len(exclusion_positions) != 2
        or any(docs >= exclusion for docs, exclusion in zip(docs_positions, exclusion_positions))
    ):
        raise GuardFailure("broad strict workflow must exclude frozen history after docs/** on PR and push")
    docs_text = workflows[docs_name][1]
    required_docs_tokens = (
        "fetch-depth: 0",
        "check_invariant_declarations.py --repo-root . --base-sha",
        "issue_3643_invariant_registry_freeze.implementor.happy.test.py --repo-root . --base-sha",
    )
    if any(token not in docs_text for token in required_docs_tokens):
        raise GuardFailure("docs workflow is missing full history, the guard, or implementor proof")
    if docs_text.count('"docs/**"') < 2:
        raise GuardFailure("docs workflow no longer retains docs/** on PR and push")
    if comment_refs < 1:
        raise GuardFailure("the historical comment-only workflow reference disappeared")


def check_manifest_routing(git: GitTree, head: str) -> None:
    path = ".github/ci-batch/MANIFEST.json"
    try:
        manifest = json.loads(git.blob(head, path))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise GuardFailure(f"CI-batch manifest is unreadable: {exc}") from exc
    occurrences: list[str] = []

    def walk(value: object, trail: tuple[str, ...] = ()) -> None:
        if isinstance(value, dict):
            for key, child in value.items():
                walk(child, (*trail, str(key)))
        elif isinstance(value, list):
            for index, child in enumerate(value):
                walk(child, (*trail, str(index)))
        elif value == REGISTRY_PATH:
            occurrences.append("/".join(trail))

    walk(manifest)
    if occurrences:
        raise GuardFailure(
            "CI-batch routing/provenance still names frozen history: " + ", ".join(occurrences)
        )


def check_reader_zero(git: GitTree, head: str, files: set[str]) -> None:
    missing = sorted(READER_PATHS - files)
    if missing:
        raise GuardFailure("expected invariant reader files disappeared: " + ", ".join(missing))
    residual = [
        path for path in sorted(READER_PATHS) if REGISTRY_BYTES in git.blob(head, path)
    ]
    if residual:
        raise GuardFailure("migrated content readers still name frozen history: " + ", ".join(residual))


def is_policy_ref_surface(path: str, content: str | None) -> bool:
    if path in POLICY_REF_SURFACES:
        return True
    if path.startswith(".github/workflows/") and content is not None:
        return workflow_display_name(content, path) in {
            "Docs Artifact Regression",
            "Strict Grep Gates (Mingla Host)",
        }
    return False


def check_new_registry_refs(
    git: GitTree,
    base: str,
    head: str,
    base_files: list[str],
    head_files: list[str],
) -> None:
    del base_files, head_files
    def counts(commit: str) -> Counter[str]:
        result: Counter[str] = Counter()
        prefix = f"{commit}:"
        output = git.grep(commit, REGISTRY_PATH, "-I", "-n", "-o", "-F")
        for raw in output.decode("utf-8").splitlines():
            if not raw.startswith(prefix):
                raise GuardFailure("git grep returned a malformed registry-reference location")
            path, _line_number, _match = raw[len(prefix) :].split(":", 2)
            result[path] += 1
        return result

    before_counts = counts(base)
    after_counts = counts(head)
    violations: list[str] = []
    for path in sorted(set(before_counts) | set(after_counts)):
        before = before_counts[path]
        after = after_counts[path]
        if after <= before:
            continue
        content = text_blob(git, head, path)
        if not is_policy_ref_surface(path, content):
            violations.append(f"{path} ({before}→{after})")
    if violations:
        raise GuardFailure("new frozen-history references outside policy surfaces: " + ", ".join(violations))


def check_new_workflow_literals(git: GitTree, base: str, head: str) -> None:
    violations: list[str] = []
    changed = [
        path
        for path in git.run("diff", "--name-only", "-z", base, head).decode().split("\0")
        if path
    ]
    for path in changed:
        if path.startswith(".github/workflows/"):
            continue
        before = text_blob(git, base, path, required=False) or ""
        after = text_blob(git, head, path, required=False) or ""
        before_counts = Counter(WORKFLOW_LITERAL_RE.findall(before))
        after_counts = Counter(WORKFLOW_LITERAL_RE.findall(after))
        for literal, count in after_counts.items():
            if count > before_counts[literal]:
                violations.append(
                    f"{path}: {literal} ({before_counts[literal]}→{count})"
                )
    if violations:
        raise GuardFailure("new non-workflow text names workflow files: " + ", ".join(violations))


def validate(root: Path, base_arg: str, head_arg: str) -> tuple[str, dict[str, Declaration]]:
    git = GitTree(root)
    base = git.commit(base_arg, "base SHA")
    head = git.commit(head_arg, "head SHA")
    merge_base = git.merge_base(base, head)
    mode, _, _ = classify_freeze(git, base, head, merge_base)
    if mode == "transition":
        return mode, {}

    base_files = git.files(base)
    head_files = git.files(head)
    head_set = set(head_files)
    declarations = collect_declarations(git, head, head_files)
    check_new_ids(git, base, head, base_files, head_files, declarations)
    check_reader_zero(git, head, head_set)
    check_new_registry_refs(git, base, head, base_files, head_files)
    check_new_workflow_literals(git, base, head)
    check_workflow_routing(git, head, head_files)
    check_manifest_routing(git, head)
    return mode, declarations


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", required=True, type=Path)
    parser.add_argument("--base-sha", required=True)
    parser.add_argument("--head-sha", required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        mode, declarations = validate(args.repo_root.resolve(), args.base_sha, args.head_sha)
    except GuardFailure as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1
    if mode == "transition":
        print("PASS: exact pre-freeze transition patch accepted")
    else:
        print(
            f"PASS: invariant history {mode}; {len(declarations)} unique local declarations validated"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
