#!/usr/bin/env python3
"""Protect COMMS.md from restoring the retired global OTA freeze."""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path


ACTIVE_HEADING = "## Active entries"
ARCHIVE_HEADING = "## Archive"
AUTHORITY_MARKER = "CURRENT OTA AUTHORITY"
WORKFLOW_PATH = Path(".github/workflows/docs-artifact-regression.yml")
SCRIPT_PATH = "scripts/docs/check_ota_comms_authority.py"


@dataclass(frozen=True)
class CommsRow:
    comms_id: str
    severity: str
    status: str
    body: str


def active_section(text: str) -> str:
    active_start = text.find(ACTIVE_HEADING)
    archive_start = text.find(ARCHIVE_HEADING)
    if active_start < 0 or archive_start < 0 or archive_start <= active_start:
        raise ValueError("COMMS.md must contain Active entries before Archive")
    return text[active_start + len(ACTIVE_HEADING) : archive_start]


def active_rows(text: str) -> list[CommsRow]:
    rows: list[CommsRow] = []
    for line in active_section(text).splitlines():
        if not re.match(r"^\|\s*COMMS-\d{4}\s*\|", line):
            continue
        columns = [column.strip() for column in line.split("|", 9)]
        if len(columns) < 10:
            raise ValueError(f"malformed COMMS row: {line[:80]}")
        rows.append(
            CommsRow(
                comms_id=columns[1],
                severity=columns[5],
                status=columns[6],
                body=columns[9],
            )
        )
    return rows


def normalized(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("`", "")).strip().lower()


def is_global_ota_freeze(row: CommsRow) -> bool:
    if row.severity != "BLOCK" or row.status != "OPEN":
        return False
    body = normalized(row.body)
    mentions_ota = re.search(r"\bota(?:s)?\b", body) is not None
    blocks_publish = re.search(
        r"do not publish|must not publish|cannot publish|can't publish|"
        r"\b(?:impossible|blocked|frozen|freeze)\b|until .{0,80}\bbuild\b",
        body,
    ) is not None
    is_global = re.search(
        r"\b(?:either|both|all|any|neither) apps?\b|"
        r"\ball (?:production )?otas?\b|"
        r"\bota (?:is|are|rail is) (?:globally )?(?:impossible|blocked|frozen)\b",
        body,
    ) is not None
    return mentions_ota and blocks_publish and is_global


def check_comms(text: str) -> list[str]:
    failures: list[str] = []
    try:
        rows = active_rows(text)
    except ValueError as error:
        return [str(error)]

    stale_blocks = [row.comms_id for row in rows if is_global_ota_freeze(row)]
    if stale_blocks:
        failures.append(
            "active OPEN/BLOCK globally forbids OTA after #1871: "
            + ", ".join(stale_blocks)
        )

    authorities = [
        row for row in rows
        if row.status == "OPEN" and AUTHORITY_MARKER in row.body
    ]
    if len(authorities) != 1:
        failures.append(
            f"expected exactly one OPEN {AUTHORITY_MARKER} row; found {len(authorities)}"
        )
    else:
        authority = normalized(authorities[0].body)
        required = {
            "dated reach snapshot": "recorded reach truth as of 2026-08-11",
            "Consumer and Business runtime 1.1.4 builds": "consumer and business runtime 1.1.4 builds exist",
            "runtime-existence/public-reach distinction": "existence is not public reach",
            "Android 1.1.4 public reach at 100%": "both android apps were public at 1.1.4 at 100%",
            "iOS manual/not-public state": "both ios apps were release type manual and not public",
            "iOS installed public runtime 1.1.2": "public ios users remained on runtime 1.1.2",
            "#1758 lifting evidence": "#1758",
            "#1871 lifting evidence": "#1871",
            "freshness boundary": "immediately before every publish",
            "Play production re-read": "play production track",
            "App Store re-read": "app store release state",
            "EAS served-manifest re-read": "eas served manifest",
            "pure-JS eligibility": "pure-js",
            "reviewed merged main": "reviewed merged main",
            "per-platform publication": "per-platform",
            "served-manifest verification": "served manifest",
            "native/config build boundary": "native/config changes require a fresh native build",
        }
        for label, anchor in required.items():
            if anchor not in authority:
                failures.append(f"current OTA authority missing {label}")

    accidental_publish_warnings = [
        row for row in rows
        if row.status == "OPEN"
        and row.severity == "WARN"
        and "MINGLA_EAS_BIN" in row.body
        and "PUBLISHES A REAL PRODUCTION OTA" in row.body
        and "symlinked invocation fails CLOSED" in row.body
    ]
    if len(accidental_publish_warnings) != 1:
        failures.append(
            "expected exactly one OPEN accidental-publish WARN preserving the "
            "MINGLA_EAS_BIN and symlink fail-closed rules"
        )

    return failures


def check_workflow(text: str) -> list[str]:
    failures: list[str] = []
    if text.count('      - "COMMS.md"') < 2:
        failures.append("docs workflow must trigger on COMMS.md for push and pull_request")
    if f"python3 {SCRIPT_PATH} --self-test" not in text:
        failures.append("docs workflow does not run the OTA authority self-test")
    if f"python3 {SCRIPT_PATH}\n" not in text:
        failures.append("docs workflow does not run the OTA authority check")
    return failures


def fixture(active_rows_text: str, archive_text: str = "") -> str:
    return (
        f"{ACTIVE_HEADING}\n\n"
        "| id | date | from | to | severity | status | expires | acked_by | subject / body |\n"
        "|---|---|---|---|---|---|---|---|---|\n"
        f"{active_rows_text}\n\n{ARCHIVE_HEADING}\n\n{archive_text}\n"
    )


def self_test() -> None:
    authority = (
        "| COMMS-9001 | date | owner | ALL | WARN | OPEN | none | | "
        "**CURRENT OTA AUTHORITY — recorded reach truth as of 2026-08-11:** "
        "Consumer and Business runtime 1.1.4 builds exist, but existence is not public reach. "
        "Both Android apps were public at 1.1.4 at 100%. Both iOS apps were release type "
        "MANUAL and not public; public iOS users remained on runtime 1.1.2. #1758 and "
        "#1871 lifted the old freeze. Immediately before every publish, re-read the Play "
        "production track, App Store release state, and EAS served manifest. "
        "OTA is eligible only for pure-JS "
        "changes from reviewed merged `main`, published per-platform with served "
        "manifest verification. Native/config changes require a fresh native build. |"
    )
    flattened_authority = (
        "| COMMS-9006 | date | owner | ALL | WARN | OPEN | none | | "
        "**CURRENT OTA AUTHORITY:** Consumer and Business runtime 1.1.4 exists on iOS "
        "and Android. #1758 and #1871 lifted the old freeze. OTA is eligible only for "
        "pure-JS changes from reviewed merged `main`, published per-platform with served "
        "manifest verification. Native/config changes require a fresh native build. |"
    )
    stale_snapshot_authority = authority.replace(
        "Immediately before every publish, re-read the Play production track, App Store "
        "release state, and EAS served manifest. ",
        "",
    )
    warning = (
        "| COMMS-9002 | date | owner | ALL | WARN | OPEN | none | | "
        "MINGLA_EAS_BIN: this PUBLISHES A REAL PRODUCTION OTA; a symlinked invocation "
        "fails CLOSED. |"
    )
    old_freeze = (
        "| COMMS-9003 | date | owner | ALL | BLOCK | OPEN | none | | "
        "DO NOT PUBLISH A PRODUCTION OTA for either app until a native build ships. |"
    )
    paraphrased_freeze = (
        "| COMMS-9004 | date | owner | ALL | BLOCK | OPEN | none | | "
        "OTAs are globally frozen for all apps until the next build. |"
    )
    platform_block = (
        "| COMMS-9005 | date | owner | ALL | BLOCK | OPEN | none | | "
        "Do not publish a Business iOS OTA until runtime 1.1.5 is installed. |"
    )

    assert check_comms(fixture(authority + "\n" + warning)) == []
    assert any(
        "public reach" in failure or "reach snapshot" in failure
        for failure in check_comms(fixture(flattened_authority + "\n" + warning))
    )
    assert any(
        "freshness" in failure or "re-read" in failure
        for failure in check_comms(fixture(stale_snapshot_authority + "\n" + warning))
    )
    assert any(
        "globally forbids OTA" in failure
        for failure in check_comms(fixture(authority + "\n" + warning + "\n" + old_freeze))
    )
    assert any(
        "globally forbids OTA" in failure
        for failure in check_comms(
            fixture(authority + "\n" + warning + "\n" + paraphrased_freeze)
        )
    )
    assert check_comms(fixture(authority + "\n" + warning + "\n" + platform_block)) == []
    assert check_comms(fixture(authority + "\n" + warning, old_freeze)) == []
    assert any(
        "exactly one OPEN" in failure
        for failure in check_comms(fixture(warning))
    )
    assert any(
        "accidental-publish" in failure
        for failure in check_comms(fixture(authority))
    )

    good_workflow = (
        'pull_request:\n  paths:\n      - "COMMS.md"\n'
        'push:\n  paths:\n      - "COMMS.md"\n'
        f"run: |\n  python3 {SCRIPT_PATH} --self-test\n  python3 {SCRIPT_PATH}\n"
    )
    assert check_workflow(good_workflow) == []
    assert check_workflow(good_workflow.replace('      - "COMMS.md"\n', "", 1))
    assert check_workflow(good_workflow.replace(f"  python3 {SCRIPT_PATH}\n", ""))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", type=Path, default=Path("COMMS.md"))
    parser.add_argument("--workflow", type=Path, default=WORKFLOW_PATH)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        self_test()
        print("OTA COMMS authority self-test: PASS (12/12 cases)")
        return 0

    failures: list[str] = []
    try:
        failures.extend(check_comms(args.file.read_text(encoding="utf-8")))
        failures.extend(check_workflow(args.workflow.read_text(encoding="utf-8")))
    except OSError as error:
        failures.append(str(error))

    if failures:
        print("OTA COMMS authority: FAIL", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1

    print("OTA COMMS authority: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
