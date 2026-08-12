#!/usr/bin/env python3
"""Fail when COMMS.md contains duplicate coordination IDs."""

from __future__ import annotations

import argparse
import re
import sys
from collections import Counter
from pathlib import Path


COMMS_ROW = re.compile(r"^\|\s*(COMMS-\d{4})\s*\|")


def comms_ids(text: str) -> list[str]:
    return [
        match.group(1)
        for line in text.splitlines()
        if (match := COMMS_ROW.match(line))
    ]


def duplicate_ids(text: str) -> list[str]:
    counts = Counter(comms_ids(text))
    return sorted(comm_id for comm_id, count in counts.items() if count > 1)


def self_test() -> None:
    healthy = """| COMMS-0001 | one |\n| COMMS-0002 | two |\n"""
    duplicated = healthy + "| COMMS-0001 | duplicate |\n"

    assert comms_ids(healthy) == ["COMMS-0001", "COMMS-0002"]
    assert duplicate_ids(healthy) == []
    assert duplicate_ids(duplicated) == ["COMMS-0001"]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", type=Path, default=Path("COMMS.md"))
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        self_test()
        print("COMMS integrity self-test: PASS")
        return 0

    try:
        duplicates = duplicate_ids(args.file.read_text(encoding="utf-8"))
    except OSError as error:
        print(f"COMMS integrity: FAIL: {error}", file=sys.stderr)
        return 1

    if duplicates:
        print(
            "COMMS integrity: FAIL: duplicate IDs: " + ", ".join(duplicates),
            file=sys.stderr,
        )
        return 1

    print("COMMS integrity: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
