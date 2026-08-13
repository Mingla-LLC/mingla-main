#!/usr/bin/env python3
"""Adversarial CI proof for #2028 OTA authority semantics."""

from __future__ import annotations

import argparse
import runpy
import sys
from pathlib import Path
from typing import Callable


sys.dont_write_bytecode = True

IMPLEMENTOR_GUARD = Path("scripts/docs/check_ota_comms_authority.py")
DEFAULT_COMMS = Path("COMMS.md")


def load_guard() -> dict[str, object]:
    return runpy.run_path(str(IMPLEMENTOR_GUARD))


def replace_once(text: str, old: str, new: str) -> str:
    if text.count(old) != 1:
        raise AssertionError(f"fixture anchor must occur exactly once: {old!r}")
    return text.replace(old, new, 1)


def tester_failures(text: str, guard: dict[str, object]) -> list[str]:
    check_comms = guard["check_comms"]
    active_rows = guard["active_rows"]
    normalized = guard["normalized"]
    assert callable(check_comms)
    assert callable(active_rows)
    assert callable(normalized)

    failures = list(check_comms(text))
    authorities = [
        row
        for row in active_rows(text)
        if row.status == "OPEN" and "CURRENT OTA AUTHORITY" in row.body
    ]
    if len(authorities) != 1:
        return failures

    authority = normalized(authorities[0].body)
    independent_requirements = {
        "post-publish served-manifest verification": (
            "verification is mandatory:",
            "verify the served manifest for that exact platform/runtime",
        ),
        "rollback readiness": ("eas update:roll-back-to-embedded", "ready"),
    }
    for label, anchors in independent_requirements.items():
        if not all(anchor in authority for anchor in anchors):
            failures.append(f"tester authority missing {label}")
    return failures


def assert_rejected(
    label: str,
    text: str,
    guard: dict[str, object],
    predicate: Callable[[str], bool] | None = None,
) -> None:
    failures = tester_failures(text, guard)
    if not failures:
        raise AssertionError(f"{label}: mutation passed unexpectedly")
    if predicate is not None and not any(predicate(failure) for failure in failures):
        raise AssertionError(f"{label}: wrong failure(s): {failures}")


def run_adversarial_suite(text: str) -> None:
    guard = load_guard()
    baseline = tester_failures(text, guard)
    if baseline:
        raise AssertionError(f"baseline authority is invalid: {baseline}")

    exact_reach = (
        "**CURRENT OTA AUTHORITY — recorded reach truth as of 2026-08-11:** "
        "Consumer and Business runtime 1.1.4 builds exist on iOS and Android, but "
        "existence is not public reach. **Both Android apps were public at 1.1.4 at "
        "100%. Both iOS apps were release type MANUAL and not public; public iOS users "
        "remained on runtime 1.1.2.**"
    )
    vague_reach = (
        "**CURRENT OTA AUTHORITY:** Consumer and Business runtime 1.1.4 exists on iOS "
        "and Android."
    )
    assert_rejected("vague runtime-exists authority", replace_once(text, exact_reach, vague_reach), guard)

    freshness = (
        "Immediately before every publish, re-read the Play production track, App Store "
        "release state, and EAS served manifest for the exact target platform/runtime. "
    )
    assert_rejected("stale reach snapshot", replace_once(text, freshness, ""), guard)
    assert_rejected("missing Play re-read", replace_once(text, "Play production track", "Android storefront"), guard)
    assert_rejected("missing App Store re-read", replace_once(text, "App Store release state", "iOS storefront"), guard)
    assert_rejected("missing EAS re-read", replace_once(text, "EAS served manifest", "EAS state"), guard)

    authority_row = next(
        line for line in text.splitlines() if line.startswith("| COMMS-0143 ")
    )
    duplicate = replace_once(
        text,
        "\n## Archive",
        "\n" + authority_row.replace("COMMS-0143", "COMMS-9999", 1) + "\n\n## Archive",
    )
    assert_rejected("duplicate current authority", duplicate, guard)

    global_block = (
        "| COMMS-9998 | date | owner | ALL | BLOCK | OPEN | none | | Production OTAs "
        "are globally frozen for both apps until the next build. |\n"
    )
    assert_rejected(
        "stale global freeze",
        replace_once(text, "\n## Archive", "\n" + global_block + "\n## Archive"),
        guard,
    )

    assert_rejected(
        "missing native boundary",
        replace_once(
            text,
            "Native/config changes require a fresh native build.",
            "Native/config changes need separate review.",
        ),
        guard,
    )
    assert_rejected(
        "missing per-platform publication",
        replace_once(text, "publish per-platform", "publish separately"),
        guard,
    )
    assert_rejected(
        "missing post-publish served-manifest verification",
        replace_once(
            text,
            "verify the served manifest for that exact platform/runtime",
            "verify the update for that exact platform/runtime",
        ),
        guard,
        lambda failure: "post-publish served-manifest" in failure,
    )
    assert_rejected(
        "missing rollback readiness",
        replace_once(text, "eas update:roll-back-to-embedded", "the rollback command"),
        guard,
        lambda failure: "rollback readiness" in failure,
    )
    accidental_warning_row = next(
        line for line in text.splitlines() if line.startswith("| COMMS-0137 ")
    )
    assert_rejected(
        "missing accidental-publish seam",
        replace_once(
            text,
            accidental_warning_row,
            accidental_warning_row.replace("MINGLA_EAS_BIN", "EAS_TEST_BINARY"),
        ),
        guard,
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", type=Path, default=DEFAULT_COMMS)
    args = parser.parse_args()
    try:
        run_adversarial_suite(args.file.read_text(encoding="utf-8"))
    except (AssertionError, OSError) as error:
        print(f"#2028 OTA authority tester adversarial: FAIL — {error}", file=sys.stderr)
        return 1
    print("#2028 OTA authority tester adversarial: PASS (12/12 mutations)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
