#!/usr/bin/env bash
# scripts/orch-worktree/assert-safe-worktree-path.sh
#
# ISSUE #2210 — refuse to hand a build toolchain a path it will silently
# mis-glob.
#
# WHY THIS EXISTS. From 2026-05-24 to 2026-08-18 `spawn.sh` built worktree
# directories as `<ORCH_ID>-[<label>]` — with literal square brackets. Inside
# such a directory CMake's `file(GLOB ...)` treats the brackets as a POSIX
# character class, matches ZERO files, prints NO warning, and EXITS 0. Every
# React Native / Expo native module builds its source list with exactly that
# call, so every local Android build in a bracketed worktree got an empty
# source list. It only failed loudly because `add_library` happens to reject an
# empty source list — luck, not design. A glob feeding anything OPTIONAL would
# have produced an incomplete binary and reported success. RN 0.81 codegen has
# the same shape (COMMS-0150): 210 glob matches at a plain path, 0 in a
# bracketed worktree, stub artifacts written, exit 0.
#
# So the rule is NOT "avoid brackets". It is: the absolute path we are about to
# hand to build tools must contain only characters that no globber, no shell,
# and no URL parser can reinterpret. That is an ALLOWLIST, deliberately — a
# denylist of "known bad" characters is how `[` survived 86 days.
#
# Allowed: A-Z a-z 0-9 . _ / -
# Everything else is rejected, which covers (non-exhaustively):
#   [ ]        CMake/glob character class -> silent zero-match (#2210)
#   space      percent-encoded by URL.pathname; word-splits unquoted (#958)
#   #          TRUNCATES URL.pathname at the '#'; starts a shell comment
#   $ & ( ) ; | < > * ? ! ` ' " \ { } ~   shell-hostile when unquoted
#   non-ASCII  percent-encoded by URL.pathname (#958 adversarial angle)
#
# Usage:
#   scripts/orch-worktree/assert-safe-worktree-path.sh <absolute-path>
#
# Exit codes:
#   0  path is safe
#   2  path contains hostile characters (loud message on stderr)
#   1  usage error
#
# This script is deliberately standalone so it can be exercised in BOTH
# directions by a test without invoking spawn.sh's side effects. The regression
# gate is .github/scripts/strict-grep/__tests__/issue-2210-worktree-path-guard.test.mjs.

set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <path>" >&2
  exit 1
fi

CANDIDATE="$1"

if [ -z "$CANDIDATE" ]; then
  echo "ERROR: refusing to validate an empty path." >&2
  exit 1
fi

# Strip every ALLOWED byte. Whatever survives is hostile. LC_ALL=C so multi-byte
# characters are compared as raw bytes and cannot be folded into a range.
#
# The SOH sentinel is load-bearing: Bash command substitution strips every
# trailing newline from its output. Without a non-newline byte after CANDIDATE,
# a path whose only hostile byte is `\n` collapses to an empty OFFENDING value
# and bypasses the guard (#2210 tester P1). `tr` preserves SOH because it is not
# allowlisted; remove exactly that final sentinel after substitution.
OFFENDING_WITH_SENTINEL="$(printf '%s\001' "$CANDIDATE" | LC_ALL=C tr -d -- '-A-Za-z0-9._/')"
OFFENDING="${OFFENDING_WITH_SENTINEL%$'\001'}"

if [ -z "$OFFENDING" ]; then
  exit 0
fi

# Render the offending bytes readably: printable ones as themselves, everything
# else (space, tab, non-ASCII) as \xNN so the message is never ambiguous.
RENDERED="$(
  printf '%s' "$OFFENDING" \
    | LC_ALL=C od -An -tx1 \
    | tr ' ' '\n' \
    | grep -v '^$' \
    | sort -u \
    | while read -r byte; do
        dec=$((16#$byte))
        if [ "$dec" -gt 32 ] && [ "$dec" -lt 127 ]; then
          printf "'%b' " "\\x$byte"
        else
          printf "\\\\x%s " "$byte"
        fi
      done
)"

cat >&2 <<MSG

============================================================
  REFUSING TO SPAWN — HOSTILE CHARACTERS IN THE WORKTREE PATH
============================================================
  Path:      $CANDIDATE
  Offending: $RENDERED

  A worktree path may contain ONLY: A-Z a-z 0-9 . _ / -

  This is not cosmetic. Inside a path carrying any of these
  characters, CMake's file(GLOB ...) silently matches ZERO
  files and EXITS 0, so every local Android/native build gets
  an empty source list and either dies with a misleading
  error hundreds of lines later or -- worse -- succeeds while
  building nothing. See issue #2210 and COMMS-0150.

  Fix: re-run with a kebab-case label using only [a-z0-9-],
  e.g.  scripts/orch-worktree/spawn.sh 2210 worktree-brackets
  and make sure no parent directory carries these characters
  either.
============================================================
MSG
exit 2
