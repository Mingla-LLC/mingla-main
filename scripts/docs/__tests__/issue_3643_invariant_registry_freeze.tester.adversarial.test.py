#!/usr/bin/env python3
"""Independent adversarial proof for #3643 Phase 2 invariant ownership."""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path, PurePosixPath
from types import ModuleType
from typing import Callable


OWNER_ROUTES = {
    ".github/scripts/strict-grep/**",
    "scripts/**",
    "**/__tests__/**",
    "**/*.test.*",
    "**/*.spec.*",
}


def fail(message: str) -> None:
    raise AssertionError(message)


def check(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def git(root: Path, *args: str) -> bytes:
    process = subprocess.run(
        ["git", *args], cwd=root, stdout=subprocess.PIPE, stderr=subprocess.PIPE
    )
    if process.returncode != 0:
        fail(process.stderr.decode("utf-8", errors="replace").strip() or "git failed")
    return process.stdout


def load_guard(root: Path) -> ModuleType:
    path = root / "scripts/docs/check_invariant_declarations.py"
    spec = importlib.util.spec_from_file_location("issue_3643_adversarial_guard", path)
    check(spec is not None and spec.loader is not None, "cannot load invariant guard")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def expect_failure(action: Callable[[], object], fragment: str) -> str:
    try:
        action()
    except Exception as exc:
        detail = str(exc)
        check(fragment in detail, f"expected {fragment!r}, got {detail!r}")
        return detail
    fail(f"mutation unexpectedly passed: {fragment}")
    return ""


def optional_blob(root: Path, commit: str, path: str) -> bytes | None:
    process = subprocess.run(
        ["git", "show", f"{commit}:{path}"],
        cwd=root,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return process.stdout if process.returncode == 0 else None


def unique_transition(candidates: list[tuple[str, str]]) -> tuple[str, str]:
    check(
        len(candidates) == 1,
        f"expected exactly one banner-only freeze transition, found {len(candidates)}",
    )
    return candidates[0]


def find_transition(root: Path, head: str, guard: ModuleType) -> tuple[str, str]:
    prefix = (guard.BANNER + "\n\n").encode()
    candidates: list[tuple[str, str]] = []
    commits = git(root, "rev-list", head, "--", guard.REGISTRY_PATH).decode().splitlines()
    for commit in commits:
        current = optional_blob(root, commit, guard.REGISTRY_PATH)
        if current is None or not current.startswith(prefix):
            continue
        parents = git(root, "show", "-s", "--format=%P", commit).decode().split()
        for parent in parents:
            previous = optional_blob(root, parent, guard.REGISTRY_PATH)
            if previous is not None and current == prefix + previous:
                candidates.append((parent, commit))
    return unique_transition(candidates)


def workflow_name(text: str) -> str:
    for line in text.splitlines():
        match = re.fullmatch(r"name:\s*(.+?)\s*", line)
        if match:
            return match.group(1).strip("\"'")
    fail("workflow display name missing")
    return ""


def workflows(root: Path, commit: str) -> dict[str, tuple[str, str]]:
    workflow_root = str(PurePosixPath(".github") / "workflows") + "/"
    paths = [
        item.decode()
        for item in git(root, "ls-tree", "-r", "--name-only", "-z", commit).split(b"\0")
        if item
        and item.decode().startswith(workflow_root)
        and item.decode().endswith((".yml", ".yaml"))
    ]
    result: dict[str, tuple[str, str]] = {}
    for path in paths:
        text = git(root, "show", f"{commit}:{path}").decode()
        name = workflow_name(text)
        check(name not in result, f"duplicate workflow display name: {name}")
        result[name] = (path, text)
    return result


def trigger_paths(text: str, event: str) -> set[str]:
    lines = text.splitlines()
    try:
        event_index = lines.index(f"  {event}:")
    except ValueError:
        fail(f"docs workflow trigger missing: {event}")
    body: list[str] = []
    for line in lines[event_index + 1 :]:
        if line and not line.startswith("    "):
            break
        body.append(line)
    try:
        paths_index = body.index("    paths:")
    except ValueError:
        fail(f"docs workflow paths filter missing: {event}")
    result: set[str] = set()
    for line in body[paths_index + 1 :]:
        if not line.startswith("      - "):
            break
        result.add(line.removeprefix("      - ").strip().strip("\"'"))
    return result


def docs_contract(root: Path, head: str, tester_name: str) -> tuple[str, str]:
    inventory = workflows(root, head)
    check("Docs Artifact Regression" in inventory, "docs workflow was not discovered")
    check("Strict Grep Gates (Mingla Host)" in inventory, "broad strict workflow was not discovered")
    docs_path, docs_text = inventory["Docs Artifact Regression"]
    for event in ("pull_request", "push"):
        missing = OWNER_ROUTES - trigger_paths(docs_text, event)
        check(
            not missing,
            f"docs workflow {event} paths miss owner surfaces: {', '.join(sorted(missing))}",
        )
    check(tester_name in docs_text, "tester adversarial suite is not directly invoked")
    broad_path, broad_text = inventory["Strict Grep Gates (Mingla Host)"]
    exclusion = f'      - "!{load_guard(root).REGISTRY_PATH}"'
    check(broad_text.splitlines().count(exclusion) == 2, "broad strict exclusions changed")
    return docs_path, broad_path


def original_owners(root: Path, head: str, guard: ModuleType) -> dict[str, str]:
    _base, transition_head = find_transition(root, head, guard)
    tree = guard.GitTree(root)
    declarations = guard.collect_declarations(
        tree, transition_head, tree.files(transition_head)
    )
    owners = {key: declaration.path for key, declaration in declarations.items()}
    check(len(owners) == 35, f"freeze transition expected 35 owners, found {len(owners)}")
    return owners


def assert_original_subset(
    root: Path, head: str, guard: ModuleType, expected: dict[str, str]
) -> None:
    tree = guard.GitTree(root)
    declarations = guard.collect_declarations(tree, head, tree.files(head))
    actual = {key: declaration.path for key, declaration in declarations.items()}
    missing = {
        key: (path, actual.get(key))
        for key, path in expected.items()
        if actual.get(key) != path
    }
    check(
        not missing,
        "original local declaration disappeared or moved: "
        + ", ".join(
            f"{key} expected {path}, found {found or 'missing'}"
            for key, (path, found) in sorted(missing.items())
        ),
    )


class FreezeGit:
    def __init__(
        self,
        registry_path: str,
        base: bytes,
        head: bytes,
        *,
        patch_output: bytes = b"",
        patch: bytes = b"synthetic patch",
    ) -> None:
        self.registry_path = registry_path
        self.base = base
        self.head = head
        self.patch_output = patch_output
        self.patch = patch

    def blob(self, commit: str, path: str) -> bytes:
        check(path == self.registry_path, "classifier read an unexpected path")
        return self.base if commit == "base" else self.head

    def diff(self, base: str, head: str, *paths: str) -> bytes:
        del base, head
        check(paths == (self.registry_path,), "classifier diffed an unexpected path")
        return self.patch

    def run(self, *args: str, input_bytes: bytes | None = None) -> bytes:
        check(args == ("patch-id", "--stable"), "classifier ran an unexpected command")
        check(input_bytes == self.patch, "classifier changed patch-id input")
        return self.patch_output


class DeclarationGit:
    def __init__(self, lines: list[tuple[str, int, str]]) -> None:
        self.lines = lines

    def grep(self, commit: str, pattern: str, *options: str) -> bytes:
        del pattern, options
        return "".join(
            f"{commit}:{path}:{line_no}:{line}\n"
            for path, line_no, line in self.lines
        ).encode()


class NewIdGit:
    def __init__(self, changed: str) -> None:
        self.changed = changed

    def run(self, *args: str, input_bytes: bytes | None = None) -> bytes:
        del input_bytes
        check(args[:3] == ("diff", "--name-only", "-z"), "new-ID diff changed")
        return (self.changed + "\0").encode()


class RegistryRefGit:
    def __init__(self, registry_path: str, path: str) -> None:
        self.registry_path = registry_path
        self.path = path

    def grep(self, commit: str, pattern: str, *options: str) -> bytes:
        del pattern, options
        if commit == "base":
            return b""
        return f"{commit}:{self.path}:1:{self.registry_path}\n".encode()

    def blob(self, commit: str, path: str, *, required: bool = True) -> bytes:
        del commit, required
        check(path == self.path, "registry-reference probe read unexpected path")
        return f"# {self.registry_path}\n".encode()


class MissingMergeBaseGit:
    def run(self, *args: str, input_bytes: bytes | None = None) -> bytes:
        del args, input_bytes
        return b""


def exercise_freeze_matrix(guard: ModuleType) -> int:
    prefix = (guard.BANNER + "\n\n").encode()
    body = b"alpha\nbeta\n- **Status:** ACTIVE\n"
    base = prefix + body
    mutations = {
        "add": prefix + body + b"gamma\n",
        "delete": prefix + b"alpha\n- **Status:** ACTIVE\n",
        "edit": prefix + body.replace(b"alpha", b"altered"),
        "reorder": prefix + b"beta\nalpha\n- **Status:** ACTIVE\n",
        "status": prefix + body.replace(b"ACTIVE", b"RETIRED"),
    }
    for label, head in mutations.items():
        expect_failure(
            lambda head=head: guard.classify_freeze(
                FreezeGit(guard.REGISTRY_PATH, base, head), "base", "head", "merge"
            ),
            "frozen invariant history changed",
        )

    expect_failure(
        lambda: guard.classify_freeze(
            FreezeGit(guard.REGISTRY_PATH, body, prefix + body + b"one byte"),
            "base",
            "head",
            "merge",
        ),
        "frozen invariant history changed",
    )
    expect_failure(
        lambda: guard.classify_freeze(
            FreezeGit(guard.REGISTRY_PATH, base, prefix + body + b"replay"),
            "base",
            "head",
            "merge",
        ),
        "frozen invariant history changed",
    )

    exact = sorted(guard.TRANSITION_PATCH_IDS)
    for patch_id in exact:
        mode, _, _ = guard.classify_freeze(
            FreezeGit(
                guard.REGISTRY_PATH,
                body,
                body + b"transition",
                patch_output=f"{patch_id} {'0' * 40}\n".encode(),
            ),
            "base",
            "head",
            "merge",
        )
        check(mode == "transition", "approved transition patch was rejected")

    for bad_id in ("f" * 40, "e" * 40):
        expect_failure(
            lambda bad_id=bad_id: guard.classify_freeze(
                FreezeGit(
                    guard.REGISTRY_PATH,
                    body,
                    body + b"mutated",
                    patch_output=f"{bad_id} {'0' * 40}\n".encode(),
                ),
                "base",
                "head",
                "merge",
            ),
            "unrecognized pre-freeze registry patch identity",
        )
    expect_failure(
        lambda: guard.classify_freeze(
            FreezeGit(
                guard.REGISTRY_PATH,
                body,
                body + b"malformed",
                patch_output=b"not-a-patch-id\n",
            ),
            "base",
            "head",
            "merge",
        ),
        "malformed stable patch identity",
    )
    expect_failure(
        lambda: guard.classify_freeze(
            FreezeGit(guard.REGISTRY_PATH, body, body + b"empty", patch=b""),
            "base",
            "head",
            "merge",
        ),
        "empty registry patch",
    )
    expect_failure(
        lambda: guard.GitTree.merge_base(MissingMergeBaseGit(), "base", "head"),
        "no readable merge base",
    )
    expect_failure(lambda: unique_transition([]), "found 0")
    expect_failure(
        lambda: unique_transition([("a", "b"), ("c", "d")]), "found 2"
    )
    return len(mutations) + 12


def declaration_line(guard: ModuleType, invariant_id: str, rule: str) -> str:
    return f"// MINGLA-INVARIANT: {invariant_id} | issue #3643 | {rule}"


def exercise_declaration_matrix(guard: ModuleType) -> int:
    invariant_id = "I-" + "3643-ADVERSARIAL-OWNER"
    valid_rule = "Local ownership remains explicit beside the enforcing test."
    valid = declaration_line(guard, invariant_id, valid_rule)

    malformed = [
        ("scripts/check.mjs", 1, valid.replace("issue #3643", "issue #0"), "malformed"),
        ("scripts/check.mjs", 1, valid.replace("issue #3643", "issue #03643"), "malformed"),
        ("scripts/check.mjs", 1, valid.replace("issue #3643 | ", ""), "malformed"),
        ("scripts/check.mjs", 1, valid.replace(valid_rule, "too short"), "20–500"),
        ("scripts/check.mjs", 1, valid + " ", "trimmed"),
        ("scripts/check.mjs", 1, valid.replace(valid_rule, valid_rule + " | extra"), "malformed"),
        ("scripts/check.mjs", 1, valid.replace(valid_rule, valid_rule + " ACTIVE"), "lifecycle"),
        ("scripts/check.mjs", 61, valid, "after line 60"),
        ("src/check.mjs", 1, valid, "unsupported invariant owner"),
        ("scripts/check.mjs", 1, valid.replace("// ", "# ", 1), "comment syntax"),
    ]
    workflow_owner = str(PurePosixPath(".github") / "workflows" / ("synthetic" + ".yml"))
    malformed.append(
        (workflow_owner, 1, valid.replace("// ", "# ", 1), "unsupported invariant owner")
    )
    for path, line_no, line, fragment in malformed:
        expect_failure(
            lambda path=path, line_no=line_no, line=line: guard.collect_declarations(
                DeclarationGit([(path, line_no, line)]), "head", []
            ),
            fragment,
        )

    second_path = "scripts/other.mjs"
    expect_failure(
        lambda: guard.collect_declarations(
            DeclarationGit(
                [
                    ("scripts/check.mjs", 1, valid),
                    (second_path, 1, valid),
                ]
            ),
            "head",
            [],
        ),
        "expected exactly one owner",
    )

    changed_path = "scripts/check.mjs"
    original = guard.invariant_ids
    try:
        guard.invariant_ids = (
            lambda _git, commit, _files: set() if commit == "base" else {invariant_id}
        )
        expect_failure(
            lambda: guard.check_new_ids(
                NewIdGit(changed_path), "base", "head", [], [], {}
            ),
            "require one declaration",
        )
        declaration = guard.Declaration(
            invariant_id, 3643, valid_rule, "scripts/unchanged.mjs", 1
        )
        expect_failure(
            lambda: guard.check_new_ids(
                NewIdGit(changed_path),
                "base",
                "head",
                [],
                [],
                {invariant_id: declaration},
            ),
            "require one declaration",
        )
    finally:
        guard.invariant_ids = original

    ref_path = "scripts/phase2_reference_probe.py"
    expect_failure(
        lambda: guard.check_new_registry_refs(
            RegistryRefGit(guard.REGISTRY_PATH, ref_path),
            "base",
            "head",
            [],
            [],
        ),
        "new frozen-history references outside policy surfaces",
    )
    return len(malformed) + 4


def commit_paths(root: Path, message: str, *paths: str) -> str:
    git(root, "add", "--", *paths)
    git(root, "commit", "--quiet", "-m", message)
    return git(root, "rev-parse", "HEAD").decode().strip()


def exercise_repository_mutations(
    root: Path,
    head: str,
    guard: ModuleType,
    expected_owners: dict[str, str],
    tester_name: str,
) -> int:
    with tempfile.TemporaryDirectory(prefix="issue-3643-adversarial-") as temp_dir:
        clone = Path(temp_dir) / "repo"
        git(root, "clone", "--quiet", "--shared", str(root), str(clone))
        git(clone, "switch", "--quiet", "--detach", head)
        git(clone, "config", "user.name", "Phase 2 adversarial proof")
        git(clone, "config", "user.email", "phase2-adversarial@example.invalid")
        git(clone, "config", "commit.gpgsign", "false")

        def restore() -> None:
            git(clone, "switch", "--quiet", "--detach", head)

        owner_id, owner_path = sorted(expected_owners.items())[0]
        owner_file = clone / owner_path
        marker = f"MINGLA-INVARIANT: {owner_id} |"
        source = owner_file.read_text()
        changed = "".join(
            line for line in source.splitlines(keepends=True) if marker not in line
        )
        check(changed != source, "declaration-removal fixture disappeared")
        owner_file.write_text(changed)
        missing_owner = commit_paths(clone, "remove original declaration", owner_path)
        expect_failure(
            lambda: assert_original_subset(
                clone, missing_owner, guard, expected_owners
            ),
            "original local declaration disappeared",
        )

        restore()
        probe_path = "scripts/phase2_registry_reference_probe.py"
        (clone / probe_path).write_text(f"# forbidden dependency: {guard.REGISTRY_PATH}\n")
        ref_head = commit_paths(clone, "restore frozen history reader", probe_path)
        expect_failure(
            lambda: guard.check_new_registry_refs(
                guard.GitTree(clone), head, ref_head, [], []
            ),
            "new frozen-history references outside policy surfaces",
        )

        restore()
        docs_path, broad_path = docs_contract(clone, head, tester_name)
        docs_file = clone / docs_path
        docs_text = docs_file.read_text()
        first_paths = docs_text.index("    paths:") + len("    paths:")
        docs_file.write_text(
            docs_text[:first_paths]
            + f'\n      - "{guard.REGISTRY_PATH}"'
            + docs_text[first_paths:]
        )
        workflow_head = commit_paths(clone, "reintroduce registry workflow route", docs_path)
        expect_failure(
            lambda: guard.check_workflow_routing(
                guard.GitTree(clone), workflow_head, guard.GitTree(clone).files(workflow_head)
            ),
            "functional workflows still route on frozen history",
        )

        restore()
        manifest_path = ".github/ci-batch/MANIFEST.json"
        manifest_file = clone / manifest_path
        manifest = json.loads(manifest_file.read_text())
        check(manifest.get("suites"), "manifest suite fixture disappeared")
        manifest["suites"][0].setdefault("originPaths", []).append(guard.REGISTRY_PATH)
        manifest_file.write_text(json.dumps(manifest, indent=2) + "\n")
        manifest_head = commit_paths(clone, "reintroduce registry manifest route", manifest_path)
        expect_failure(
            lambda: guard.check_manifest_routing(guard.GitTree(clone), manifest_head),
            "CI-batch routing/provenance still names frozen history",
        )

        restore()
        broad_file = clone / broad_path
        broad_text = broad_file.read_text()
        exclusion = f'      - "!{guard.REGISTRY_PATH}"\n'
        check(broad_text.count(exclusion) == 2, "strict-exclusion fixture changed")
        broad_file.write_text(broad_text.replace(exclusion, "", 1))
        strict_head = commit_paths(clone, "remove broad strict exclusion", broad_path)
        expect_failure(
            lambda: guard.check_workflow_routing(
                guard.GitTree(clone), strict_head, guard.GitTree(clone).files(strict_head)
            ),
            "broad strict workflow must exclude frozen history",
        )

        restore()
        reader_path = sorted(guard.READER_PATHS)[0]
        reader = clone / reader_path
        reader.write_text(reader.read_text() + f"\n// restored reader: {guard.REGISTRY_PATH}\n")
        reader_head = commit_paths(clone, "restore original registry reader", reader_path)
        expect_failure(
            lambda: guard.check_reader_zero(
                guard.GitTree(clone), reader_head, set(guard.GitTree(clone).files(reader_head))
            ),
            "migrated content readers still name frozen history",
        )

        restore()
        docs_file = clone / docs_path
        docs_text = docs_file.read_text()
        route = '      - "**/*.test.*"\n'
        check(docs_text.count(route) == 2, "owner-route fixture changed")
        docs_file.write_text(docs_text.replace(route, "", 1))
        route_head = commit_paths(clone, "remove owner-surface route", docs_path)
        expect_failure(
            lambda: docs_contract(clone, route_head, tester_name),
            "pull_request paths miss owner surfaces",
        )

        restore()
        docs_file = clone / docs_path
        docs_text = docs_file.read_text()
        invocation_lines = [line for line in docs_text.splitlines(keepends=True) if tester_name in line]
        check(len(invocation_lines) == 1, "tester invocation fixture changed")
        docs_file.write_text(docs_text.replace(invocation_lines[0], "", 1))
        invocation_head = commit_paths(clone, "remove tester invocation", docs_path)
        expect_failure(
            lambda: docs_contract(clone, invocation_head, tester_name),
            "tester adversarial suite is not directly invoked",
        )

        restore()
        registry = clone / guard.REGISTRY_PATH
        registry.write_text(guard.BANNER + "\n\n" + registry.read_text())
        double_head = commit_paths(clone, "replay freeze bootstrap", guard.REGISTRY_PATH)
        expect_failure(
            lambda: find_transition(clone, double_head, guard),
            "found 2",
        )

    return 9


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, required=True)
    parser.add_argument("--base-sha", required=True)
    parser.add_argument("--head-sha", required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = args.repo_root.resolve()
    guard = load_guard(root)
    tree = guard.GitTree(root)
    base = tree.commit(args.base_sha, "base SHA")
    head = tree.commit(args.head_sha, "head SHA")

    mode, declarations = guard.validate(root, base, head)
    check(mode in {"bootstrap", "frozen"}, f"unexpected event mode: {mode}")
    expected_owners = original_owners(root, head, guard)
    assert_original_subset(root, head, guard, expected_owners)
    tester_name = Path(__file__).name
    docs_contract(root, head, tester_name)
    check(len(declarations) >= 35, "current declaration census fell below the frozen transition")

    freeze_cases = exercise_freeze_matrix(guard)
    declaration_cases = exercise_declaration_matrix(guard)
    repository_cases = exercise_repository_mutations(
        root, head, guard, expected_owners, tester_name
    )
    print(
        "PASS: invariant freeze adversarial matrix; "
        f"{freeze_cases} history/transition cases, "
        f"{declaration_cases} declaration/reference cases, "
        f"{repository_cases} repository mutations"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        if isinstance(exc, SystemExit):
            raise
        print(f"FAIL: {exc}", file=sys.stderr)
        raise SystemExit(1)
