#!/usr/bin/env python3
"""Keep the retired COMMS.md coordination table retired (#3476).

Fails when COMMS.md carries any `| COMMS-NNNN |` table row again, or when
COMMS_LEDGER.md exists again. Chats coordinate by messaging each other under
AGENTS.md § Coordinate with other chats; rules that bind every chat live in
AGENTS.md § Standing holds.

The path and name of this file are kept ONLY because the #2148 workflow
provider seal (.github/scripts/ci-batch/validate-manifest-v2.mjs,
LOCKED_PROVIDER_DISCOVERY_SHA256) records this file as the sole external
reference to docs-artifact-regression.yml, and that seal cannot drop a
reference file. Until that limitation is fixed (#3477), do not rename or
delete this file. Its previous job (#2028: guarding the OTA authority rows
of the COMMS table) ended with the table; those OTA rules now live in
docs/MINGLA_ENGINEERING_HANDBOOK.md §7.6.
"""

from __future__ import annotations

import argparse
import re
import sys
import tempfile
from pathlib import Path


COMMS_PATH = Path("COMMS.md")
LEDGER_PATH = Path("COMMS_LEDGER.md")
WORKFLOW_PATH = Path(".github/workflows/docs-artifact-regression.yml")
SCRIPT_PATH = "scripts/docs/check_ota_comms_authority.py"

# A table row whose first cell is a COMMS id, e.g. `| COMMS-0185 | 2026-09-15 | ...`.
TABLE_ROW = re.compile(r"^\s*\|\s*COMMS-\d{4,}\s*\|")


def table_rows(text: str) -> list[str]:
    return [line for line in text.splitlines() if TABLE_ROW.match(line)]


def check_comms(text: str) -> list[str]:
    rows = table_rows(text)
    if not rows:
        return []
    ids = ", ".join(line.split("|")[1].strip() for line in rows[:5])
    more = f" and {len(rows) - 5} more" if len(rows) > 5 else ""
    return [
        f"{COMMS_PATH} is retired (#3476) but carries {len(rows)} table row(s): {ids}{more}. "
        "Message the affected chats instead (AGENTS.md § Coordinate with other chats); "
        "a rule that binds every chat goes in AGENTS.md § Standing holds."
    ]


def check_ledger(root: Path) -> list[str]:
    if (root / LEDGER_PATH).exists():
        return [
            f"{LEDGER_PATH} is retired (#974, deleted by #3476) and must not exist again. "
            "Its history is at git tag pre-avengers-archive."
        ]
    return []


def check_workflow(text: str) -> list[str]:
    failures: list[str] = []
    for watched in (COMMS_PATH, LEDGER_PATH):
        if text.count(f'      - "{watched}"') < 2:
            failures.append(
                f"docs workflow must trigger on {watched} for push and pull_request, "
                "or a regrown table is never checked"
            )
    if f"python3 {SCRIPT_PATH} --self-test" not in text:
        failures.append("docs workflow does not run the retired-COMMS self-test")
    if f"python3 {SCRIPT_PATH}\n" not in text:
        failures.append("docs workflow does not run the retired-COMMS check")
    return failures


def self_test() -> int:
    cases = 0

    stub = (
        "# COMMS.md — retired\n\n"
        "This coordination table was retired by #3476. The full table is in git history "
        "(COMMS-0118 to COMMS-0185).\n"
    )
    assert check_comms(stub) == [], "a stub that only names ids in prose must pass"
    cases += 1

    regrown = stub + (
        "\n| id | date | from | to | severity | status | expires | acked_by | subject / body |\n"
        "|---|---|---|---|---|---|---|---|---|\n"
        "| COMMS-0186 | 2026-09-18 | someone | ALL | WARN | OPEN | none | none | body |\n"
    )
    failures = check_comms(regrown)
    assert failures and "COMMS-0186" in failures[0], "a regrown table row must fail"
    cases += 1

    indented = stub + "  |COMMS-0200| 2026-09-18 | x |\n"
    assert check_comms(indented), "a row with odd spacing must still fail"
    cases += 1

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        assert check_ledger(root) == [], "no ledger file must pass"
        cases += 1
        (root / LEDGER_PATH).write_text("# Mingla Comms Ledger\n", encoding="utf-8")
        failures = check_ledger(root)
        assert failures and "COMMS_LEDGER.md" in failures[0], "a recreated ledger must fail"
        cases += 1

    good_workflow = (
        'pull_request:\n  paths:\n      - "COMMS.md"\n      - "COMMS_LEDGER.md"\n'
        'push:\n  paths:\n      - "COMMS.md"\n      - "COMMS_LEDGER.md"\n'
        f"run: |\n  python3 {SCRIPT_PATH} --self-test\n  python3 {SCRIPT_PATH}\n"
    )
    assert check_workflow(good_workflow) == [], "the wired workflow must pass"
    cases += 1
    assert check_workflow(good_workflow.replace('      - "COMMS.md"\n', "", 1))
    cases += 1
    assert check_workflow(good_workflow.replace('      - "COMMS_LEDGER.md"\n', "", 1))
    cases += 1
    assert check_workflow(good_workflow.replace(f"  python3 {SCRIPT_PATH} --self-test\n", ""))
    cases += 1
    assert check_workflow(good_workflow.replace(f"  python3 {SCRIPT_PATH}\n", ""))
    cases += 1

    return cases


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--file", type=Path, default=COMMS_PATH)
    parser.add_argument("--workflow", type=Path, default=WORKFLOW_PATH)
    parser.add_argument("--root", type=Path, default=Path("."))
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        cases = self_test()
        print(f"Retired COMMS table self-test: PASS ({cases}/{cases} cases)")
        return 0

    failures: list[str] = []
    try:
        if args.file.exists():
            failures.extend(check_comms(args.file.read_text(encoding="utf-8")))
        failures.extend(check_ledger(args.root))
        failures.extend(check_workflow(args.workflow.read_text(encoding="utf-8")))
    except OSError as error:
        failures.append(str(error))

    if failures:
        print("Retired COMMS table: FAIL", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1

    print("Retired COMMS table: PASS (no table rows in COMMS.md, no COMMS_LEDGER.md)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
