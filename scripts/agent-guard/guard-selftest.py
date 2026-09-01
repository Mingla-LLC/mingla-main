#!/usr/bin/env python3
"""Self-test for the Mingla agent guard.

Two phases, and BOTH must pass:

1. CASES - every command below is run through the real guard as a subprocess and
   must land on the verdict it is registered under. Both directions: a rule that
   blocks nothing and a rule that blocks everything are equally broken.

2. RULE PARITY (issue #2897 AC-6) - the rule inventory is read out of
   bash-guard.py's own AST, never counted by hand. Every deny rule must be the
   FIRST rule to fire on at least one MUST_BLOCK case, every warn rule must fire
   on at least one MUST_WARN case, and every rule must have at least one
   MUST_ALLOW case sharing its command prefix. Adding a rule without adding both
   of its cases fails here, and there is no number to forget to update.

Trigger strings are assembled from fragments so this file does not itself trip
the guard when the test runner is invoked through the Bash tool.
"""
import ast
import json
import os
import re
import subprocess
import sys

# The guard under test defaults to its sibling. CI passes the path explicitly so
# that BOTH files appear in the registered command, and the batch runner's
# expected-file check catches a deleted guard before python does.
GUARD = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else \
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "bash-guard.py")
if not os.path.isfile(GUARD):
    sys.exit("guard-selftest: no guard to test at " + GUARD)

H = "--" + "hard"
F = "--" + "force"
M = "gh pr " + "merge"

MUST_BLOCK = [
    "git reset " + H + " origin/main",
    "cd /tmp && git reset " + H,
    "git clean -fd",
    "git clean -xfd build/",
    M + " 2889 --admin",
    "git push " + F + " origin main",
    "git branch -D 2881-pr-trigger-topology",
    "git add -A",
    "gh run watch 123",
    "gh pr checks 2889 --watch",
    "gh repo edit --visibility private",
    "gh api repos/o/r/rulesets/1 -X PUT -f x=y",
    # DEFECT 2 REGRESSION (#2897). The rule read `\bruleset\b`, which cannot
    # match `rulesets` - the plural is the endpoint GitHub actually serves, so
    # the protection was real-looking and empty. The case above proves the
    # plural is caught; this one proves it is still caught when the method flag
    # comes FIRST, which an ordered (non-lookahead) pattern silently missed.
    "gh api -X PUT repos/o/r/rulesets/1 -f x=y",
    "gh api repos/o/r/issues/1 -X DELETE",
    "supabase db push",
    "git checkout -- .",
    "git restore --staged --worktree .",
]

MUST_ALLOW = [
    'echo "' + M + '" >> notes.md',
    # DEFECT 1 REGRESSION (#2897). Version 1 matched bare substrings, so a rule
    # name quoted inside a script body read as an invocation and the guard
    # blocked the very edit that was configuring it. Patterns anchor to the head
    # of a command segment; a rule name inside a data line is data.
    "cat > /tmp/rules.py <<'PY'\nDENY = [\"git reset " + H + "\", \"" + M + "\"]\nPY",
    # A NAMED path survives; only the whole-tree form is blocked. Do not change
    # this to a `.github/workflows/<name>.yml` path: the CI registry treats a
    # workflow filename in any tracked file as a provider reference, and this
    # fixture would drift a seal it has nothing to do with.
    "git checkout .github/ci-batch/MANIFEST.json",
    "npm test -- --watch",
    "git reset HEAD~1",
    "git push origin 2897-agent-guard",
    "git add scripts/agent-guard/bash-guard.py",
    "gh pr view 2889 --json state",
    "gh repo view --json nameWithOwner",
    "gh api repos/o/r/rulesets --jq .",
    "git restore --staged --worktree .github/workflows/",
    "git clean --dry-run",
    "supabase db diff --linked",
    "supabase functions deploy notify",
    "git branch -d merged-branch",
]

MUST_WARN = [
    "git reset --soft origin/main",
]


def verdict(cmd):
    r = subprocess.run([GUARD], input=json.dumps({"tool_input": {"command": cmd}}),
                       capture_output=True, text=True)
    o = r.stdout.strip()
    if not o:
        return "allowed"
    return json.loads(o)["hookSpecificOutput"].get("permissionDecision", "warn")


# --- Phase 2 support: read the rule inventory out of the guard's own source ----

def _literal(node, names):
    """Evaluate the string expressions the guard actually uses: literals, names
    bound to earlier literals, and + concatenation of those. Anything else is a
    shape this reader does not understand, and it says so rather than guessing."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.Name):
        if node.id not in names:
            raise ValueError("unresolved name in rule table: " + node.id)
        return names[node.id]
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        return _literal(node.left, names) + _literal(node.right, names)
    raise ValueError("unsupported expression in rule table: " + ast.dump(node)[:80])


def read_rule_inventory(path=GUARD):
    """Return {'RULES': [pattern, ...], 'WARN_RULES': [pattern, ...]} parsed from
    the guard source. Deliberately NOT an import: importing bash-guard.py would
    execute it and make it read stdin."""
    tree = ast.parse(open(path, encoding="utf-8").read())
    names, tables = {}, {}
    for node in tree.body:
        if not isinstance(node, ast.Assign) or len(node.targets) != 1:
            continue
        target = node.targets[0]
        if not isinstance(target, ast.Name):
            continue
        if isinstance(node.value, ast.List):
            if target.id in ("RULES", "WARN_RULES"):
                tables[target.id] = [_literal(item.elts[0], names) for item in node.value.elts]
            continue
        try:
            names[target.id] = _literal(node.value, names)
        except ValueError:
            continue
    missing = [name for name in ("RULES", "WARN_RULES") if name not in tables]
    if missing:
        raise ValueError("guard source has no " + "/".join(missing) + " table to derive coverage from")
    return tables


def command_heads(cmd):
    """The guard's own segmentation, so attribution matches what really fires."""
    heads = []
    for seg in re.split(r"(?:\|\||&&|[;\n|])", cmd):
        s = seg.strip()
        s = re.sub(r"^(?:\$\(|\(|\{|!\s*)+", "", s).strip()
        s = re.sub(r"^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+", "", s)
        s = re.sub(r"^(?:sudo|time|nohup|command|xargs)\s+", "", s)
        if s:
            heads.append(re.sub(r"\s+", " ", s))
    return heads


def literal_words(pattern):
    """The leading literal words a pattern anchors on, up to its first regex
    metacharacter - `git clean`, `gh pr merge`, `supabase db`."""
    body = pattern[1:] if pattern.startswith("^") else pattern
    return re.match(r"[A-Za-z0-9 _./-]*", body).group(0).split()


def required_prefix(pattern):
    """The command prefix a MUST_ALLOW case has to share for this rule.

    Normally the first TWO literal words: `git clean --dry-run` surviving the
    `git clean -fd` rule is what proves the rule stops at its own boundary
    instead of eating its neighbours. A bare first word would be satisfied by any
    unrelated `git ...` case and would prove nothing.

    The exception is a rule that blocks its ENTIRE two-word namespace - one whose
    pattern already matches the bare two-word prefix. No allowed command can
    start with it, so demanding one is unsatisfiable, and the honest boundary
    case is a sibling verb sharing one word. That condition is read off the
    pattern, not asserted by the author."""
    words = literal_words(pattern)
    if len(words) < 2:
        return " ".join(words[:1])
    two = " ".join(words[:2])
    return words[0] if re.search(pattern, two) else two


def first_matching(patterns, cmd):
    """Index of the first rule that fires, mirroring the guard's rule-major loop."""
    heads = command_heads(cmd)
    for index, pattern in enumerate(patterns):
        if any(re.search(pattern, head) for head in heads):
            return index
    return None


def rule_parity():
    """AC-6. Fails if any rule lacks a must-block/must-warn or a must-allow case."""
    inventory = read_rule_inventory()
    deny, warn = inventory["RULES"], inventory["WARN_RULES"]
    print("\nRULE PARITY (%d deny + %d warn rules read from bash-guard.py):"
          % (len(deny), len(warn)))

    attributed = {}
    for case in MUST_BLOCK:
        index = first_matching(deny, case)
        if index is not None:
            attributed.setdefault(index, []).append(case)
    warned = {}
    for case in MUST_WARN:
        index = first_matching(warn, case)
        if index is not None:
            warned.setdefault(index, []).append(case)

    allow_heads = [head for case in MUST_ALLOW for head in command_heads(case)]
    ok = True
    for label, patterns, positive in (("deny", deny, attributed), ("warn", warn, warned)):
        for index, pattern in enumerate(patterns):
            prefix = required_prefix(pattern)
            has_positive = bool(positive.get(index))
            has_allow = any(head == prefix or head.startswith(prefix + " ") for head in allow_heads)
            good = has_positive and has_allow and bool(prefix)
            ok = ok and good
            missing = []
            if not prefix:
                missing.append("no derivable command prefix")
            if not has_positive:
                missing.append("no MUST_%s case reaches it" % ("BLOCK" if label == "deny" else "WARN"))
            if not has_allow:
                missing.append("no MUST_ALLOW case starting %r" % prefix)
            print("  [%s] %-4s %-2d %-14s %s"
                  % ("PASS" if good else "FAIL", label, index, prefix or "<none>",
                     "; ".join(missing) or pattern[:46]))
    return ok


def main():
    ok = True
    for label, cases, want in (("MUST BLOCK", MUST_BLOCK, {"deny"}),
                               ("MUST ALLOW", MUST_ALLOW, {"allowed"}),
                               ("MUST WARN", MUST_WARN, {"warn"})):
        print(label + ":")
        for c in cases:
            v = verdict(c)
            good = v in want
            ok = ok and good
            print("  [%s] %-8s %s" % ("PASS" if good else "FAIL", v,
                                      c.replace("\n", "\\n")[:52]))
    ok = rule_parity() and ok
    print("\nGUARD SELF-TEST: " + ("PASS" if ok else "FAIL"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
