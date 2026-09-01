#!/usr/bin/env python3
"""Mingla agent guard - PreToolUse/Bash.

Blocks command shapes that have caused, or nearly caused, damage in this repo.
This stops ACCIDENTS. It is not a defence against an agent that deliberately
sets MINGLA_ALLOW_DESTRUCTIVE=1 in the harness environment.

Two design notes, both learned the hard way while installing this:

1. Patterns anchor to the START of a command segment. The first version matched
   bare substrings and blocked the very edit that was configuring it, because
   the rule names appeared as quoted data inside the script body. A rule name
   inside a string is data, not an invocation.

2. MINGLA_ALLOW_DESTRUCTIVE=1 must be set in the ENVIRONMENT THAT LAUNCHED
   Claude Code, not inside the command being run. The hook is a separate process
   spawned before the command executes, so `export VAR=1 && <cmd>` does not lift
   the block. Use the Write/Edit tools, or relaunch with the var set.
"""
import json
import os
import re
import sys


def out(obj):
    print(json.dumps(obj))
    sys.exit(0)


try:
    cmd = json.load(sys.stdin).get("tool_input", {}).get("command", "")
except Exception:
    sys.exit(0)

if not cmd or os.environ.get("MINGLA_ALLOW_DESTRUCTIVE") == "1":
    sys.exit(0)

# Only the head of a command segment is an invocation.
heads = []
for seg in re.split(r"(?:\|\||&&|[;\n|])", cmd):
    s = seg.strip()
    s = re.sub(r"^(?:\$\(|\(|\{|!\s*)+", "", s).strip()
    s = re.sub(r"^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+", "", s)
    s = re.sub(r"^(?:sudo|time|nohup|command|xargs)\s+", "", s)
    if s:
        heads.append(re.sub(r"\s+", " ", s))

HARD = "\x2d\x2dhard"
FORCE = "\x2d\x2dforce"

RULES = [
    (r"^git reset " + HARD + r"\b",
     "'git reset " + HARD + "' discards uncommitted work irreversibly; on the shared "
     "anchor it destroys another session's in-flight work. Reset a specific path, or stash."),
    (r"^git checkout (--\s+)?\.\s*$",
     "whole-tree 'git checkout .' discards every unstaged change. Name the specific path."),
    (r"^git restore (--staged |--worktree |-S |-W |-SW )*\.\s*$",
     "whole-tree 'git restore .' discards every change. Name the specific path."),
    (r"^git clean\s+(-\w*[fd]\w*\s*)+",
     "'git clean -fd' deletes untracked files, including other sessions' scratch and "
     "un-added work. Delete by explicit name."),
    (r"^git push\b.*\s(" + FORCE + r"|-f)\b",
     "force-push rewrites published history. Rebase and open a PR."),
    (r"^git branch\b.*\s-D\b",
     "'-D' force-deletes a branch whose commits may be unmerged - this previously reaped "
     "an unmerged PR's branch and auto-closed it. Verify the merge, then use reap.sh."),
    (r"^git add\s+(-A|--all)\b",
     "'git add -A' stages everything in the tree, including other sessions' work on the "
     "shared anchor. Stage explicit paths."),
    (r"^gh pr merge\b",
     "agents do not merge. The orchestrator owns the merge gate - push, report, and let "
     "it verify all-green."),
    (r"^gh repo (delete|edit|archive)\b",
     "repository settings are Seth's to change, not an agent's. Report the needed change."),
    # Two lookaheads, not a sequence: the endpoint may appear either side of the
    # method flag, and an ordered pattern silently missed `... /rulesets/1 -X PUT`.
    (r"^gh api\b(?=.*(-X|--method)\s+(DELETE|PUT|POST|PATCH)\b)"
     # `rulesets?` not `ruleset`: a trailing \b after "ruleset" cannot match
     # "rulesets", so the plural endpoint — the one actually used — slipped past.
     r"(?=.*\b(rulesets?|protection|collaborators|actions/permissions)\b)",
     "rulesets, branch protection and permissions are operator-only. Report the change."),
    (r"^gh api\b.*(-X|--method)\s+DELETE\b",
     "destructive gh api DELETE. Report the needed change instead."),
    (r"^gh (pr checks|run view|pr view)\b.*--watch\b|^gh run watch\b",
     "CI polling burns the org-wide GitHub API quota - one shared wallet across every "
     "session. Snapshot reads only; the orchestrator owns CI watching."),
    (r"^supabase db (push|reset)\b",
     "production database writes go through the safe-migration protocol, never a blind push."),
]

# Warn rules advise; they never deny. Kept as a sibling LIST of the same shape as
# RULES, rather than an inline re.search, so the rule inventory is DERIVABLE from
# this source. guard-selftest.py reads both lists out of this file's AST and
# refuses a rule that has no must-block/must-warn and must-allow case, so the
# coverage count can never rot into a literal nobody updates.
WARN_RULES = [
    (r"^git reset (--soft |--mixed )?origin/",
     "CAUTION: resetting against a remote ref that has moved stages the REVERSAL "
     "of every commit landed since you branched. This nearly reverted 193 files on "
     "2026-09-01. Before committing, run 'git diff --cached --name-only | wc -l' "
     "and confirm the count matches only YOUR changes."),
]

for pattern, reason in RULES:
    for head in heads:
        if re.search(pattern, head):
            out({"hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": "BLOCKED: " + reason
                + " Override: set MINGLA_ALLOW_DESTRUCTIVE=1 before launching Claude Code.",
            }})

for pattern, context in WARN_RULES:
    for head in heads:
        if re.search(pattern, head):
            out({"hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "additionalContext": context,
            }})

sys.exit(0)
