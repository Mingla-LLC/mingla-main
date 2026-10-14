#!/usr/bin/env python3
"""Implementor proof for #3643 Phase 2 invariant-history freeze."""

from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
import re
import subprocess
import sys
import tempfile
from collections.abc import Callable
from pathlib import Path
from types import ModuleType


EXPECTED_OWNERS = {
    "I-PROPOSED-1436-SECRET-CAPACITY-EXIT": ".github/scripts/strict-grep/issue-1436-secret-capacity-exit.mjs",
    "I-PROPOSED-1772-IDENTITY-MAINTENANCE-ATOMIC": ".github/scripts/strict-grep/issue-1772-brand-person-maintenance.happy.mjs",
    "I-PROPOSED-1772-NONUSER-ERASURE-TOMBSTONED": ".github/scripts/strict-grep/issue-1772-brand-person-maintenance.happy.mjs",
    "I-PROPOSED-1772-NO-ERASURE-UI": ".github/scripts/strict-grep/issue-1772-brand-person-maintenance.happy.mjs",
    "I-PROPOSED-PERSON-SUPPRESSION-1": ".github/scripts/strict-grep/issue-1773-reservation-stay-ingest.mjs",
    "I-PROPOSED-SOURCE-FAILOPEN-1": ".github/scripts/strict-grep/issue-1773-reservation-stay-ingest.mjs",
    "I-PROPOSED-1777-CIRCLE-FRESHNESS-FAILS-CLOSED": ".github/scripts/strict-grep/issue-1777-brand-circle-reach.mjs",
    "I-PROPOSED-1777-CIRCLE-CONSENT-AND-BLOCKS": ".github/scripts/strict-grep/issue-1777-brand-circle-reach.mjs",
    "I-876-CIRCLE-NO-CONTACT-FIELDS": ".github/scripts/strict-grep/issue-1777-brand-circle-reach.mjs",
    "I-OFFERING-PROVIDER-ACCEPTANCE-1": ".github/scripts/strict-grep/issue-1817-free-plan-invite-send.mjs",
    "I-PROPOSED-OFFERING-EMAIL-SMS-ACCEPTANCE-1": ".github/scripts/strict-grep/issue-1821-accepted-email-sms-invites.mjs",
    "I-PROPOSED-PHONE-COUNTRY-AUTHORITY-1": ".github/scripts/strict-grep/issue-1857-phone-country-authority.mjs",
    "I-PROPOSED-BRAND-EXPORT-EXPLICIT-TARGET-1": ".github/scripts/strict-grep/issue-1858-explicit-brand-export.mjs",
    "I-PROPOSED-1863-CLIENT-PAYMENTS-PERMISSION-PARITY": ".github/scripts/strict-grep/issue-1863-payments-permission-gate.mjs",
    "I-RSVP-WRITE-MASTER-END-GATED": ".github/scripts/strict-grep/issue-1902-rsvp-backend-safety.mjs",
    "I-PUBLIC-BRAND-UPCOMING-INCLUDES-RSVP": ".github/scripts/strict-grep/issue-1902-rsvp-backend-safety.mjs",
    "I-ARI-LOGICAL-TURN-ONCE": ".github/scripts/strict-grep/issue-2060-ari-reliability-foundation.mjs",
    "I-ARI-EXECUTION-ONCE": ".github/scripts/strict-grep/issue-2060-ari-reliability-foundation.mjs",
    "I-ARI-RESULT-HONESTY": ".github/scripts/strict-grep/issue-2060-ari-reliability-foundation.mjs",
    "I-ARI-RECOVERY-PARITY": ".github/scripts/strict-grep/issue-2060-ari-reliability-foundation.mjs",
    "I-ARI-CORRELATED-RELEASE-TRUTH": ".github/scripts/strict-grep/issue-2060-ari-reliability-foundation.mjs",
    "I-ARI-LEDGER-CERTIFICATION": ".github/scripts/strict-grep/issue-2060-ari-reliability-foundation.mjs",
    "I-2714-CAMPAIGN-OPEN-TRUTH": ".github/scripts/strict-grep/issue-2714-campaign-open-truth.mjs",
    "I-2719-CURRENCY-IS-NOT-PAYOUT-READINESS": ".github/scripts/strict-grep/issue-2719-brand-payout-first.mjs",
    "I-2719-FREE-CREATORS-ALWAYS-OPEN": ".github/scripts/strict-grep/issue-2719-brand-payout-first.mjs",
    "I-PROPOSED-2830-SITES-LAST-GOOD-TENANT-BOUNDARY": ".github/scripts/strict-grep/issue-2830-sites-foundation.mjs",
    "I-PROPOSED-2981-MARKETING-ORIGIN-ONE-OWNER": ".github/scripts/strict-grep/issue-2981-marketing-search-foundation.mjs",
    "I-PROPOSED-2981-SEARCH-LIFECYCLE-ONE-OWNER": ".github/scripts/strict-grep/issue-2981-marketing-search-foundation.mjs",
    "I-PROPOSED-2981-ENTITY-GRAPH-FACTUAL": ".github/scripts/strict-grep/issue-2981-marketing-search-foundation.mjs",
    "I-PROPOSED-3060-NONCUSTOMER-CLOSURE-EXACT-AND-NONSENDING": ".github/scripts/strict-grep/issue-3060-attendance-noncustomer-closure.mjs",
    "I-PROPOSED-1579-GESTURE-LEASE-RELEASE-COMPLETENESS": "app-mobile/src/components/swipeDeck/__tests__/issue_1579_tap_expand_admission.adversarial.test.mjs",
    "I-PROPOSED-1272-IDENTITY-ADMIN-READ": ".github/scripts/strict-grep/i-1272-identity-admin-read.mjs",
    "I-PROPOSED-1273-OFFERINGS-READ-ONLY": ".github/scripts/strict-grep/i-offerings-read-only.mjs",
    "I-PROPOSED-1273-OFFERINGS-ADMIN-READ-CROSSBRAND": ".github/scripts/strict-grep/i-offerings-read-only.mjs",
    "I-PROPOSED-CREATOR-ENTRY-IS-INSTANT": ".github/scripts/strict-grep/i-proposed-creator-entry-is-instant.mjs",
}

STRICT_READER_SCRIPTS = {
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
}

RETAINED_FIXTURES = {
    "supabase/migrations/20260605000002_orch_0829b_d1_checkout_expiry_tombstone.sql",
    ".github/scripts/ci-batch/__tests__/issue-2439-deno-wave-shadow-parity.implementor.test.mjs",
    "supabase/migrations/__tests__/issue_2855_pending_venue_schema_pin.implementor.test.ts",
    "docs/design/948-949-EXECUTION-SPEC.md",
}

DERIVED_TRIGGER_SUITES = {
    "issue-1902-public-event-lifecycle-tests",
    "issue-2230-consumer-multiday-tests",
}

OWNER_SURFACE_ROUTES = {
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
    proc = subprocess.run(
        ["git", *args], cwd=root, stdout=subprocess.PIPE, stderr=subprocess.PIPE
    )
    if proc.returncode != 0:
        fail(proc.stderr.decode("utf-8", errors="replace").strip() or "git command failed")
    return proc.stdout


def load_guard(root: Path) -> ModuleType:
    path = root / "scripts/docs/check_invariant_declarations.py"
    spec = importlib.util.spec_from_file_location("issue_3643_invariant_guard", path)
    check(spec is not None and spec.loader is not None, "cannot load invariant guard")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def blob(root: Path, commit: str, path: str) -> bytes:
    return git(root, "show", f"{commit}:{path}")


def optional_blob(root: Path, commit: str, path: str) -> bytes | None:
    proc = subprocess.run(
        ["git", "show", f"{commit}:{path}"],
        cwd=root,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return proc.stdout if proc.returncode == 0 else None


def find_freeze_transition(root: Path, guard: ModuleType, head: str) -> tuple[str, str]:
    banner_prefix = (guard.BANNER + "\n\n").encode()
    candidates: list[tuple[str, str]] = []
    commits = git(root, "rev-list", head, "--", guard.REGISTRY_PATH).decode().splitlines()
    for commit in commits:
        current = optional_blob(root, commit, guard.REGISTRY_PATH)
        if current is None or not current.startswith(banner_prefix):
            continue
        parents = git(root, "show", "-s", "--format=%P", commit).decode().split()
        for parent in parents:
            previous = optional_blob(root, parent, guard.REGISTRY_PATH)
            if previous is not None and current == banner_prefix + previous:
                candidates.append((parent, commit))
    check(
        len(candidates) == 1,
        f"expected exactly one banner-only freeze transition, found {len(candidates)}",
    )
    return candidates[0]


def workflow_name(text: str) -> str:
    for line in text.splitlines():
        match = re.fullmatch(r"name:\s*(.+?)\s*", line)
        if match:
            return match.group(1).strip('"\'')
    fail("workflow display name missing")
    return ""


def workflows(root: Path, commit: str) -> dict[str, tuple[str, str]]:
    paths = [
        item.decode()
        for item in git(root, "ls-tree", "-r", "--name-only", "-z", commit).split(b"\0")
        if item and item.startswith(b".github/workflows/") and item.endswith((b".yml", b".yaml"))
    ]
    result: dict[str, tuple[str, str]] = {}
    for path in paths:
        text = blob(root, commit, path).decode()
        name = workflow_name(text)
        check(name not in result, f"duplicate workflow display name: {name}")
        result[name] = (path, text)
    return result


def workflow_trigger_paths(text: str, event: str) -> set[str]:
    lines = text.splitlines()
    event_line = f"  {event}:"
    try:
        event_index = lines.index(event_line)
    except ValueError:
        fail(f"docs workflow trigger missing: {event}")

    event_body: list[str] = []
    for line in lines[event_index + 1 :]:
        if line and not line.startswith("    "):
            break
        event_body.append(line)

    try:
        paths_index = event_body.index("    paths:")
    except ValueError:
        fail(f"docs workflow paths filter missing: {event}")

    paths: set[str] = set()
    for line in event_body[paths_index + 1 :]:
        if not line.startswith("      - "):
            break
        paths.add(line.removeprefix("      - ").strip().strip("\"'"))
    return paths


def noncomment_registry_lines(text: str, registry_path: str) -> list[str]:
    return [
        line
        for line in text.splitlines()
        if registry_path in line and not line.lstrip().startswith("#")
    ]


def without_registry_lines(text: str, registry_path: str) -> str:
    return "\n".join(line for line in text.splitlines() if registry_path not in line)


def manifest_counts(value: object, registry_path: str) -> tuple[int, int, int]:
    origin_suites = trigger_refs = path_scopes = 0
    if not isinstance(value, dict):
        fail("CI-batch manifest root must be an object")
    for suite in value.get("suites", []):
        if registry_path in suite.get("originPaths", []):
            origin_suites += 1
        trigger = suite.get("triggerContract") or {}
        for event in ("pullRequest", "push"):
            contract = trigger.get(event) or {}
            trigger_refs += contract.get("paths", []).count(registry_path)
    for origin in value.get("legacyOrigins", []):
        metadata = origin.get("workflowMetadata") or {}
        path_scopes += metadata.get("pathScope", []).count(registry_path)
    return origin_suites, trigger_refs, path_scopes


def strip_manifest_registry(
    value: object, registry_path: str, live_digest_origins: set[str]
) -> object:
    clone = copy.deepcopy(value)

    def walk(node: object) -> None:
        if isinstance(node, dict):
            for child in node.values():
                walk(child)
        elif isinstance(node, list):
            node[:] = [child for child in node if child != registry_path]
            for child in node:
                walk(child)

    walk(clone)
    if not isinstance(clone, dict):
        fail("CI-batch manifest root must be an object")
    for suite in clone.get("suites", []):
        if suite.get("id") in DERIVED_TRIGGER_SUITES:
            suite["shadowContract"]["triggerSha256"] = json_sha256(
                suite["triggerContract"]
            )
    for origin in clone.get("legacyOrigins", []):
        name = f"{origin.get('stem')}.{origin.get('extension')}"
        if name in live_digest_origins:
            origin["workflowMetadata"]["sourceSha256"] = "<derived-workflow-source>"
    phase3b = [
        {
            "id": suite["id"],
            "origin": suite["origin"],
            "hostClass": suite["hostClass"],
            "executionClass": suite["executionClass"],
            "runtime": suite["runtime"],
            "setupProfile": suite["setupProfile"],
            "timeoutSeconds": suite["timeoutSeconds"],
            "triggerContract": suite["triggerContract"],
            "shadowContract": suite["shadowContract"],
        }
        for suite in clone.get("suites", [])
        if suite.get("migrationWave") == "phase3b-postgres-wave"
    ]
    clone["phase3bContractSha256"] = json_sha256(phase3b)
    phase3c_suites = [
        suite
        for suite in clone.get("suites", [])
        if suite.get("migrationWave") == "phase3c-deno-wave"
    ]
    terminal = {
        suite.get("lifecycle") for suite in phase3c_suites
    } == {"batched-historical"}
    phase3c = [
        {
            "id": suite["id"],
            "origin": suite["origin"],
            "lifecycle": "shadow-active" if terminal else suite["lifecycle"],
            "executionClass": suite["executionClass"],
            "hostClass": suite["hostClass"],
            "timeoutSeconds": suite["timeoutSeconds"],
            "shadowContract": suite["shadowContract"],
        }
        for suite in phase3c_suites
    ]
    clone["phase3cContractSha256"] = json_sha256(phase3c)
    return clone


def json_sha256(value: object) -> str:
    compact = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(compact.encode()).hexdigest()


class TransitionGit:
    def __init__(self, registry_path: str, patch_id: str) -> None:
        self.registry_path = registry_path
        self.patch_id = patch_id

    def blob(self, commit: str, path: str) -> bytes:
        del commit
        check(path == self.registry_path, "transition classifier read an unexpected path")
        return b"pre-freeze history\n"

    def diff(self, base: str, head: str, *paths: str) -> bytes:
        del base, head
        check(paths == (self.registry_path,), "transition classifier diffed an unexpected path")
        return b"synthetic nonempty patch"

    def run(self, *args: str, input_bytes: bytes | None = None) -> bytes:
        check(args == ("patch-id", "--stable"), "transition classifier ran an unexpected command")
        check(input_bytes == b"synthetic nonempty patch", "transition patch input changed")
        return f"{self.patch_id} {'0' * 40}\n".encode()


class NewIdGit:
    def __init__(self, changed_path: str) -> None:
        self.changed_path = changed_path

    def run(self, *args: str, input_bytes: bytes | None = None) -> bytes:
        del input_bytes
        check(args[:3] == ("diff", "--name-only", "-z"), "new-ID check ran an unexpected command")
        return (self.changed_path + "\0").encode()


def exercise_contract_helpers(guard: ModuleType) -> None:
    marker = "MINGLA-" + "INVARIANT"
    unit_id = "I-" + "UNIT-LOCAL-OWNER"
    samples = (
        ("scripts/check.py", f"# {marker}: {unit_id} | issue #1 | Python owners use hash comment declarations."),
        ("scripts/check.sh", f"# {marker}: {unit_id} | issue #1 | Shell owners use hash comment declarations."),
        (
            "scripts/__tests__/check.test.sql",
            f"-- {marker}: {unit_id} | issue #1 | SQL test owners use double-dash declarations.",
        ),
        (
            ".github/scripts/strict-grep/check.mjs",
            f"// {marker}: {unit_id} | issue #1 | JavaScript owners use slash comment declarations.",
        ),
    )
    for path, line in samples:
        match = guard.DECLARATION_RE.fullmatch(line)
        check(match is not None, f"supported declaration syntax rejected for {path}")
        check(guard.is_supported_owner(path), f"supported owner rejected: {path}")
        check(match.group("comment") == guard.owner_comment(path), f"comment mismatch for {path}")

    for patch_id in sorted(guard.TRANSITION_PATCH_IDS):
        mode, _, _ = guard.classify_freeze(
            TransitionGit(guard.REGISTRY_PATH, patch_id), "base", "head", "merge-base"
        )
        check(mode == "transition", f"approved transition patch was rejected: {patch_id}")

    changed_path = "scripts/check.py"
    declaration = guard.Declaration(unit_id, 1, "A sufficiently long local rule.", changed_path, 1)
    original = guard.invariant_ids
    try:
        guard.invariant_ids = lambda _git, commit, _files: set() if commit == "base" else {unit_id}
        guard.check_new_ids(
            NewIdGit(changed_path), "base", "head", [], [], {unit_id: declaration}
        )
        try:
            guard.check_new_ids(NewIdGit(changed_path), "base", "head", [], [], {})
        except guard.GuardFailure:
            pass
        else:
            fail("new invariant-like ID without an owner was accepted")
    finally:
        guard.invariant_ids = original


def strict_entries(manifest: object) -> dict[str, object]:
    check(isinstance(manifest, dict), "strict manifest root must be an object")
    result = {
        gate.get("script"): gate
        for gate in manifest.get("gates", [])
        if isinstance(gate, dict) and gate.get("script") in STRICT_READER_SCRIPTS
    }
    check(set(result) == STRICT_READER_SCRIPTS, "one or more strict-reader registrations are missing")
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", required=True, type=Path)
    parser.add_argument("--base-sha", required=True)
    parser.add_argument("--head-sha", required=True)
    return parser.parse_args()


def commit_paths(root: Path, message: str, *paths: str) -> str:
    git(root, "add", "--", *paths)
    git(root, "commit", "--quiet", "-m", message)
    return git(root, "rev-parse", "HEAD").decode().strip()


def expect_failure(action: Callable[[], object], fragment: str) -> None:
    try:
        action()
    except AssertionError as exc:
        check(fragment in str(exc), f"unexpected failure: {exc}")
    else:
        fail(f"mutation unexpectedly passed: {fragment}")


def exercise_future_states(root: Path, head: str) -> None:
    owner_id = "I-PROPOSED-1436-SECRET-CAPACITY-EXIT"
    owner_path = EXPECTED_OWNERS[owner_id]
    with tempfile.TemporaryDirectory(prefix="issue-3643-frozen-") as temp_dir:
        clone = Path(temp_dir) / "repo"
        git(root, "clone", "--quiet", "--shared", str(root), str(clone))
        git(clone, "switch", "--quiet", "--detach", head)
        git(clone, "config", "user.name", "Phase 2 proof")
        git(clone, "config", "user.email", "phase2-proof@example.invalid")
        git(clone, "config", "commit.gpgsign", "false")

        owner_file = clone / owner_path
        owner_file.write_text(
            owner_file.read_text() + "\n// Future frozen owner-surface change.\n"
        )
        ordinary_head = commit_paths(clone, "future frozen owner change", owner_path)
        check(
            validate_proof(clone, head, ordinary_head, exercise_future=False) == "frozen",
            "ordinary future owner-surface commit did not validate in frozen mode",
        )

        git(clone, "switch", "--quiet", "--detach", head)
        future_path = "scripts/docs/__tests__/issue_3643_future_owner.test.mjs"
        future_id = "I-" + "3643-FUTURE-LOCAL-OWNER"
        (clone / future_path).write_text(
            f"// MINGLA-INVARIANT: {future_id} | issue #3643 | "
            "Future invariants remain locally owned by their enforcing tests.\n"
            f'export const FUTURE_INVARIANT = "{future_id}";\n'
        )
        future_head = commit_paths(clone, "future local invariant", future_path)
        check(
            validate_proof(clone, head, future_head, exercise_future=False) == "frozen",
            "future valid local declaration did not validate in frozen mode",
        )

        git(clone, "switch", "--quiet", "--detach", head)
        original = owner_file.read_text()
        marker = f"MINGLA-INVARIANT: {owner_id} |"
        without_owner = "".join(
            line for line in original.splitlines(keepends=True) if marker not in line
        )
        check(without_owner != original, "original owner declaration fixture was not found")
        owner_file.write_text(without_owner)
        missing_head = commit_paths(clone, "remove original owner", owner_path)
        expect_failure(
            lambda: validate_proof(clone, head, missing_head, exercise_future=False),
            "original invariant owners changed or disappeared",
        )

        git(clone, "switch", "--quiet", "--detach", head)
        current_workflows = workflows(clone, head)
        docs_path, _ = current_workflows["Docs Artifact Regression"]
        docs_file = clone / docs_path
        route_line = '      - "**/*.spec.*"\n'
        routed = docs_file.read_text()
        check(routed.count(route_line) == 2, "owner-route fixture changed")
        docs_file.write_text(routed.replace(route_line, "", 1))
        route_head = commit_paths(clone, "remove one owner route", docs_path)
        expect_failure(
            lambda: validate_proof(clone, head, route_head, exercise_future=False),
            "docs workflow pull_request paths miss invariant owner surfaces: **/*.spec.*",
        )


def validate_proof(
    root: Path, base_arg: str, head_arg: str, *, exercise_future: bool
) -> str:
    guard = load_guard(root)
    tree = guard.GitTree(root)
    base = tree.commit(base_arg, "base SHA")
    head = tree.commit(head_arg, "head SHA")
    merge_base = tree.merge_base(base, head)

    mode, base_registry, head_registry = guard.classify_freeze(tree, base, head, merge_base)
    check(mode in {"bootstrap", "frozen"}, f"unsupported event mode: {mode}")
    if mode == "bootstrap":
        check(
            head_registry == (guard.BANNER + "\n\n").encode() + base_registry,
            "bootstrap changed historical registry body bytes",
        )
    else:
        check(
            head_registry == base_registry
            and head_registry.startswith((guard.BANNER + "\n\n").encode()),
            "frozen event changed historical registry bytes",
        )

    validated_mode, declarations = guard.validate(root, base, head)
    check(validated_mode == mode, "full guard and event classifier disagree")
    actual_owners = {key: value.path for key, value in declarations.items()}
    owner_mismatches = {
        key: (expected, actual_owners.get(key))
        for key, expected in EXPECTED_OWNERS.items()
        if actual_owners.get(key) != expected
    }
    check(
        not owner_mismatches,
        "original invariant owners changed or disappeared: "
        + ", ".join(
            f"{key} expected {expected}, found {actual or 'missing'}"
            for key, (expected, actual) in sorted(owner_mismatches.items())
        ),
    )
    if mode == "bootstrap":
        check(
            len(actual_owners) == 35,
            f"bootstrap expected 35 migrated declarations, found {len(actual_owners)}",
        )
        check(actual_owners == EXPECTED_OWNERS, "bootstrap owner map changed")
    check(
        sum(owner == ".github/scripts/strict-grep/issue-1772-brand-person-maintenance.happy.mjs" for owner in actual_owners.values()) == 3,
        "multiple declarations in one gate are not preserved",
    )
    exercise_contract_helpers(guard)

    transition_base, transition_head = find_freeze_transition(root, guard, head)
    transition_merge_base = tree.merge_base(transition_base, transition_head)
    transition_mode, historical_registry, frozen_registry = guard.classify_freeze(
        tree, transition_base, transition_head, transition_merge_base
    )
    check(transition_mode == "bootstrap", "discovered freeze transition is not bootstrap")
    check(
        frozen_registry == (guard.BANNER + "\n\n").encode() + historical_registry,
        "discovered freeze transition changed historical registry body bytes",
    )

    base_workflows = workflows(root, transition_base)
    transition_workflows = workflows(root, transition_head)
    check(
        set(base_workflows) == set(transition_workflows),
        "freeze transition changed workflow inventory",
    )
    head_workflows = workflows(root, head)
    _, docs_text = head_workflows["Docs Artifact Regression"]
    for event in ("pull_request", "push"):
        missing_routes = OWNER_SURFACE_ROUTES - workflow_trigger_paths(docs_text, event)
        check(
            not missing_routes,
            f"docs workflow {event} paths miss invariant owner surfaces: "
            + ", ".join(sorted(missing_routes)),
        )
    current_functional_names = {
        name
        for name, (_, text) in head_workflows.items()
        if noncomment_registry_lines(text, guard.REGISTRY_PATH)
        and name not in {"Strict Grep Gates (Mingla Host)", "Docs Artifact Regression"}
    }
    check(
        not current_functional_names,
        "current functional workflows still route on the registry: "
        + ", ".join(sorted(current_functional_names)),
    )
    functional_names = {
        name
        for name, (_, text) in base_workflows.items()
        if noncomment_registry_lines(text, guard.REGISTRY_PATH)
        and name not in {"Strict Grep Gates (Mingla Host)", "Docs Artifact Regression"}
    }
    check(len(functional_names) == 19, f"expected 19 functional workflow readers, found {len(functional_names)}")
    for name in sorted(functional_names):
        base_text = base_workflows[name][1]
        head_text = transition_workflows[name][1]
        check(
            not noncomment_registry_lines(head_text, guard.REGISTRY_PATH),
            f"functional workflow still routes on the registry: {name}",
        )
        check(
            without_registry_lines(base_text, guard.REGISTRY_PATH)
            == without_registry_lines(head_text, guard.REGISTRY_PATH),
            f"non-registry routing changed in functional workflow: {name}",
        )

    base_batch = json.loads(blob(root, transition_base, ".github/ci-batch/MANIFEST.json"))
    transition_batch = json.loads(blob(root, transition_head, ".github/ci-batch/MANIFEST.json"))
    head_batch = json.loads(blob(root, head, ".github/ci-batch/MANIFEST.json"))
    check(
        manifest_counts(base_batch, guard.REGISTRY_PATH) == (9, 3, 26),
        "base CI-batch registry-routing census changed",
    )
    check(
        manifest_counts(transition_batch, guard.REGISTRY_PATH) == (0, 0, 0),
        "freeze transition left CI-batch registry routing behind",
    )
    check(
        manifest_counts(head_batch, guard.REGISTRY_PATH) == (0, 0, 0),
        "head CI-batch routing still selects suites for a registry-only path",
    )
    base_origins = {
        f"{origin['stem']}.{origin['extension']}": origin
        for origin in base_batch.get("legacyOrigins", [])
    }
    head_origins = {
        f"{origin['stem']}.{origin['extension']}": origin
        for origin in transition_batch.get("legacyOrigins", [])
    }
    changed_source_digests = {
        name
        for name in base_origins
        if base_origins[name].get("workflowMetadata", {}).get("sourceSha256")
        != head_origins[name].get("workflowMetadata", {}).get("sourceSha256")
    }
    expected_source_digests = {
        name
        for name, origin in base_origins.items()
        if origin.get("disposition") == "database-special"
        and guard.REGISTRY_PATH
        in origin.get("workflowMetadata", {}).get("pathScope", [])
    }
    check(
        len(expected_source_digests) == 18,
        "expected 18 live workflow source digests to require reconciliation",
    )
    check(
        changed_source_digests == expected_source_digests,
        "live workflow source-digest reconciliation changed the wrong origins",
    )
    for name in sorted(expected_source_digests):
        expected = hashlib.sha256(blob(root, transition_head, f".github/workflows/{name}")).hexdigest()
        actual = head_origins[name]["workflowMetadata"]["sourceSha256"]
        check(actual == expected, f"live workflow source digest is stale: {name}")

    base_suites = {suite["id"]: suite for suite in base_batch.get("suites", [])}
    head_suites = {suite["id"]: suite for suite in transition_batch.get("suites", [])}
    changed_trigger_digests = {
        suite_id
        for suite_id in base_suites
        if base_suites[suite_id].get("shadowContract", {}).get("triggerSha256")
        != head_suites[suite_id].get("shadowContract", {}).get("triggerSha256")
    }
    check(
        changed_trigger_digests == DERIVED_TRIGGER_SUITES,
        "trigger-digest reconciliation changed the wrong suites",
    )
    for suite_id in sorted(DERIVED_TRIGGER_SUITES):
        suite = head_suites[suite_id]
        check(
            suite["shadowContract"]["triggerSha256"]
            == json_sha256(suite["triggerContract"]),
            f"derived trigger digest is stale: {suite_id}",
        )
    normalized_base = strip_manifest_registry(
        base_batch, guard.REGISTRY_PATH, expected_source_digests
    )
    normalized_head = strip_manifest_registry(
        transition_batch, guard.REGISTRY_PATH, expected_source_digests
    )
    check(
        transition_batch.get("phase3bContractSha256")
        == normalized_head.get("phase3bContractSha256"),
        "Phase 3B contract digest is stale after trigger reconciliation",
    )
    check(
        transition_batch.get("phase3cContractSha256")
        == normalized_head.get("phase3cContractSha256"),
        "Phase 3C contract digest is stale after trigger reconciliation",
    )
    check(
        normalized_base == normalized_head,
        "CI-batch non-registry routing or suite metadata changed",
    )

    base_strict = json.loads(blob(root, transition_base, ".github/scripts/strict-grep/MANIFEST.json"))
    transition_strict = json.loads(
        blob(root, transition_head, ".github/scripts/strict-grep/MANIFEST.json")
    )
    head_strict = json.loads(blob(root, head, ".github/scripts/strict-grep/MANIFEST.json"))
    check(
        strict_entries(base_strict) == strict_entries(transition_strict),
        "freeze transition changed strict-reader registrations or modes",
    )
    check(
        strict_entries(transition_strict) == strict_entries(head_strict),
        "strict-reader enforcement, invocation, modes, self-test, or job keys changed",
    )

    for path in RETAINED_FIXTURES:
        check(
            blob(root, transition_base, path) == blob(root, transition_head, path),
            f"freeze transition changed retained historical fixture: {path}",
        )

    if exercise_future:
        exercise_future_states(root, head)

    return mode


def main() -> int:
    args = parse_args()
    mode = validate_proof(
        args.repo_root.resolve(), args.base_sha, args.head_sha, exercise_future=True
    )

    print(
        "PASS: banner-only freeze; 21 readers removed; 35 owners localized; "
        "19 workflow and 9 batch routes removed; declarations and registrations preserved; "
        f"{mode} event and future-frozen matrix passed"
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
