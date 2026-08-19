#!/usr/bin/env bash
#
# issue #2264 — strict-grep registry: NO caller of `ticket-checkout-status` may
# discard the server's terminal verdict, and the string that stood in for it
# must stay dead.
#
# WHY THIS GATE EXISTS
# --------------------
# Since #2198 (2026-08-18) `ticket-checkout-status` asks Paystack directly on
# every poll and answers a buyer who left without paying with
#
#     HTTP 200  { checkoutSessionId, status: "failed", order: null,
#                 error: "paystack_charge_abandoned" }
#
# The native poll declared its response as `{ order: { orderId } | null }` and
# read `data?.order?.orderId` and nothing else. A terminal verdict was therefore
# structurally indistinguishable from "no order yet": the loop burned its whole
# 17 x 1500 ms budget and then told a buyer who had never paid
# "We couldn't confirm your payment yet." Twenty-five and a half seconds of a
# dead buy button, ending in the wrong sentence — with the right answer sitting
# in a field the client had typed itself out of seeing.
#
# The lesson from #2227 is that four-of-five call sites is exactly how this
# class survives. So this is a REGISTRY, not a per-file assertion: it finds
# every caller in both apps and fails any one that cannot see the answer.
#
# Invariants:
#   I-PROPOSED-CHECKOUT-STATUS-ANSWER-NOT-DISCARDED
#   I-PROPOSED-PAYSTACK-ABANDONED-ONLY-AFTER-BROWSER-CLOSES (the dead string)
#
# CHECK 1 — every `ticket-checkout-status` call site declares `status` AND
#           `error` in its response type.
#   PASSES: supabase.functions.invoke<{ status?: string;
#                                       order: {...} | null;
#                                       error?: string }>("ticket-checkout-status", …)
#   PASSES: a call whose body carries `preflight: true` — the #1930 preflight
#           legitimately asks one question ("may I present?") and reads only
#           `status`.
#   FAILS:  a generic naming only `order` (the #2264 shape).
#   FAILS:  no generic at all — deny by default; an untyped response is exactly
#           how the answer got dropped.
#
# CHECK 2 — the literal "We couldn't confirm your payment yet" appears nowhere
#           in app-mobile/src or mingla-business/src. It used to be duplicated
#           verbatim across three files and owned by none; it is now
#           CHECKOUT_AWAITING_CONFIRMATION_MESSAGE and describes exactly one
#           case. ONE named exclusion, below, carries its reason.
#
# Usage:
#   scripts/ci/check-checkout-status-consumers.sh
#   scripts/ci/check-checkout-status-consumers.sh --self-test
#   scripts/ci/check-checkout-status-consumers.sh <root> [<root> ...]

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

DEFAULT_ROOTS=(
  "$REPO_ROOT/app-mobile/src"
  "$REPO_ROOT/app-mobile/app"
  "$REPO_ROOT/mingla-business/src"
  "$REPO_ROOT/mingla-business/app"
)

run_check() {
  python3 - "$@" <<'PY'
import os
import re
import sys

FN = "ticket-checkout-status"
DEAD_STRING = "We couldn't confirm your payment yet"

# The ONE sanctioned home of the dead string, with its reason. `useReserveTable`
# is the table-reservation rail: it carries the identical discarding poll
# against `venue-reservation-status`, whose terminal arm has never been checked.
# Named as DISC-B in issue #2264's investigation and deliberately left OUT of
# that SPEC's allowlist (it is on the DO-NOT-TOUCH list) pending its own issue.
# Delete this exclusion the day that rail is fixed — do NOT add a second one.
DEAD_STRING_EXCLUSIONS = {
    os.path.join("app-mobile", "src", "hooks", "useReserveTable.ts"):
        "#2264 DISC-B — table reservation polls venue-reservation-status, "
        "whose terminal arm is unverified; scoped to its own issue.",
}

def strip_comments(text: str) -> str:
    """Blank out comments WITHOUT touching string literals."""
    out = []
    i, n = 0, len(text)
    quote = None
    while i < n:
        ch = text[i]
        if quote is not None:
            out.append(ch)
            if ch == "\\" and i + 1 < n:
                out.append(text[i + 1])
                i += 2
                continue
            if ch == quote:
                quote = None
            i += 1
            continue
        if ch in "\"'`":
            quote = ch
            out.append(ch)
            i += 1
            continue
        if ch == "/" and i + 1 < n and text[i + 1] == "/":
            while i < n and text[i] != "\n":
                out.append(" " if text[i] != "\n" else "\n")
                i += 1
            continue
        if ch == "/" and i + 1 < n and text[i + 1] == "*":
            end = text.find("*/", i + 2)
            chunk = text[i:n] if end == -1 else text[i:end + 2]
            out.append("".join("\n" if c == "\n" else " " for c in chunk))
            i = n if end == -1 else end + 2
            continue
        out.append(ch)
        i += 1
    return "".join(out)

def call_args(source: str, open_paren: int):
    depth = 0
    for i in range(open_paren, len(source)):
        if source[i] == "(":
            depth += 1
        elif source[i] == ")":
            depth -= 1
            if depth == 0:
                return source[open_paren + 1:i]
    return None

def generic_before(source: str, open_paren: int):
    """The `<...>` type argument immediately preceding a call's '(', or None.

    Walks back over whitespace; if the previous character is '>', matches it
    back to its balanced '<'. Deliberately literal — an expression the script
    cannot read is a FAIL, not a pass.
    """
    i = open_paren - 1
    while i >= 0 and source[i].isspace():
        i -= 1
    if i < 0 or source[i] != ">":
        return None
    depth = 0
    j = i
    while j >= 0:
        if source[j] == ">":
            depth += 1
        elif source[j] == "<":
            depth -= 1
            if depth == 0:
                return source[j + 1:i]
        j -= 1
    return None

DECLARES = lambda generic, field: re.search(
    r"(^|[{;,\s])(readonly\s+)?" + field + r"\s*\??\s*:", generic
) is not None

TYPE_DECL = re.compile(
    r"\b(?:interface\s+([A-Za-z_$][\w$]*)\s*(?:extends[^{]*)?\{"
    r"|type\s+([A-Za-z_$][\w$]*)\s*=\s*\{)"
)

def balanced_body(source: str, open_brace: int):
    depth = 0
    for i in range(open_brace, len(source)):
        if source[i] == "{":
            depth += 1
        elif source[i] == "}":
            depth -= 1
            if depth == 0:
                return source[open_brace + 1:i]
    return None

def collect_type_bodies(paths):
    """name -> object-type body, for every interface / object type alias.

    A caller may (and the web rail does) name its response type instead of
    inlining it. `invokeOrThrow<TicketCheckoutStatusResult>(...)` is a correct
    caller; a gate that could only read inline generics would fail it and teach
    everyone to distrust the gate.
    """
    bodies = {}
    for path in paths:
        source = strip_comments(
            open(path, encoding="utf-8", errors="replace").read()
        )
        for match in TYPE_DECL.finditer(source):
            name = match.group(1) or match.group(2)
            body = balanced_body(source, source.index("{", match.end() - 1))
            if body is not None and name not in bodies:
                bodies[name] = body
    return bodies

def collect_paths(roots):
    out = []
    for root in roots:
        if not os.path.isdir(root):
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d != "node_modules"]
            for filename in filenames:
                if filename.endswith((".ts", ".tsx", ".js", ".jsx", ".mjs")):
                    out.append(os.path.join(dirpath, filename))
    return out

# Test files name the function in mock assertions and jest doubles; they are not
# callers of the edge function and have no response type to declare. Excluding
# them keeps the registry about production call sites.
IS_TEST = lambda path: (
    "__tests__" in path.replace(os.sep, "/").split("/")
    or path.endswith((".test.ts", ".test.tsx", ".test.mjs"))
)

def resolve_generic(generic: str, bodies: dict):
    """The object-type body a generic argument denotes, or None."""
    generic = generic.strip()
    if generic.startswith("{"):
        return generic
    if re.fullmatch(r"[A-Za-z_$][\w$]*", generic):
        return bodies.get(generic)
    return None

def scan(roots):
    findings, call_sites, files = [], 0, 0
    all_paths = collect_paths(roots)
    bodies = collect_type_bodies(all_paths)
    for path in all_paths:
                raw = open(path, encoding="utf-8", errors="replace").read()
                files += 1
                if IS_TEST(path):
                    continue

                # ---- CHECK 2: the dead string --------------------------------
                if DEAD_STRING in raw:
                    rel = os.path.relpath(path, os.environ.get("GATE_REPO_ROOT", "/"))
                    excused = None
                    for suffix, reason in DEAD_STRING_EXCLUSIONS.items():
                        if path.replace(os.sep, "/").endswith(suffix.replace(os.sep, "/")):
                            excused = reason
                            break
                    if excused is None:
                        findings.append((
                            path,
                            'the retired string "%s" is back. It stood in for '
                            "abandoned / failed / genuinely-pending all at once, "
                            "which is what made #2264 lie to an unpaid buyer. Use "
                            "CHECKOUT_AWAITING_CONFIRMATION_MESSAGE, which means "
                            "only the third." % DEAD_STRING,
                        ))
                    del rel

                # ---- CHECK 1: the response type ------------------------------
                if FN not in raw:
                    continue
                source = strip_comments(raw)
                for match in re.finditer(re.escape(FN), source):
                    # Walk back to the enclosing call's '('.
                    k = match.start()
                    while k >= 0 and source[k] != "(":
                        k -= 1
                    if k < 0:
                        continue
                    args = call_args(source, k)
                    if args is None or FN not in args:
                        continue
                    call_sites += 1
                    if re.search(r"preflight\s*:\s*true", args):
                        continue  # #1930 preflight — one question, one field.
                    generic = generic_before(source, k)
                    body = None if generic is None else resolve_generic(generic, bodies)
                    if body is None:
                        findings.append((
                            path,
                            "a ticket-checkout-status call with no readable "
                            "response type (%s). Deny by default: an untyped "
                            "response is how #2264's terminal verdict got dropped. "
                            "Declare { status?: string; order: ... ; error?: string }, "
                            "inline or as a named interface."
                            % ("none" if generic is None
                               else "cannot resolve `%s`" % generic.strip()),
                        ))
                        continue
                    missing = [f for f in ("status", "error") if not DECLARES(body, f)]
                    if missing:
                        findings.append((
                            path,
                            "ticket-checkout-status response type does not declare "
                            + " and ".join("`%s`" % m for m in missing)
                            + ". The server spends a TERMINAL verdict on this "
                              "caller's behalf; a type that cannot see it is how "
                              "#2264 burned 25s and then said the wrong thing.",
                        ))
    return findings, call_sites, files

roots = sys.argv[1:]
findings, call_sites, files = scan(roots)
for path, reason in findings:
    print("FAIL %s: %s" % (path, reason), file=sys.stderr)
if findings:
    print(
        "\n%d discarded-answer violation(s) across %d ticket-checkout-status "
        "call site(s) in %d file(s).\n"
        "Invariant: I-PROPOSED-CHECKOUT-STATUS-ANSWER-NOT-DISCARDED (issue #2264)."
        % (len(findings), call_sites, files),
        file=sys.stderr,
    )
    sys.exit(1)
print(
    "OK — %d ticket-checkout-status call site(s) across %d file(s); every one "
    "reads the server's answer, and the retired string is still dead."
    % (call_sites, files)
)
PY
}

self_test() {
  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN

  # A compliant fixture — must PASS.
  mkdir -p "$tmp/clean"
  cat > "$tmp/clean/ok.ts" <<'FIXTURE'
const { data } = await supabase.functions.invoke<{
  status?: string;
  order: { orderId: string } | null;
  error?: string;
}>("ticket-checkout-status", { body: { checkoutSessionId, buyerStatusToken } });
const pre = await supabase.functions.invoke<{ status?: string }>(
  "ticket-checkout-status",
  { body: { checkoutSessionId, buyerStatusToken, preflight: true } },
);
FIXTURE
  if ! run_check "$tmp/clean" >/dev/null 2>&1; then
    echo "SELF-TEST FAIL: the compliant fixture was rejected" >&2
    return 1
  fi

  # The #2264 shape as it actually shipped — a generic naming only `order`.
  mkdir -p "$tmp/narrow"
  cat > "$tmp/narrow/bad.ts" <<'FIXTURE'
const { data } = await supabase.functions.invoke<{
  order: { orderId: string } | null;
}>("ticket-checkout-status", { body: { checkoutSessionId, buyerStatusToken } });
FIXTURE
  if run_check "$tmp/narrow" >/dev/null 2>&1; then
    echo "SELF-TEST FAIL: the #2264 order-only response type was NOT caught" >&2
    return 1
  fi

  # `status` but no `error` — half the answer is still a discarded answer.
  mkdir -p "$tmp/half"
  cat > "$tmp/half/bad.ts" <<'FIXTURE'
const { data } = await supabase.functions.invoke<{
  status?: string;
  order: { orderId: string } | null;
}>("ticket-checkout-status", { body: { checkoutSessionId, buyerStatusToken } });
FIXTURE
  if run_check "$tmp/half" >/dev/null 2>&1; then
    echo "SELF-TEST FAIL: a response type missing \`error\` was NOT caught" >&2
    return 1
  fi

  # No generic at all — deny by default.
  mkdir -p "$tmp/untyped"
  cat > "$tmp/untyped/bad.ts" <<'FIXTURE'
const { data } = await supabase.functions.invoke("ticket-checkout-status", {
  body: { checkoutSessionId, buyerStatusToken },
});
FIXTURE
  if run_check "$tmp/untyped" >/dev/null 2>&1; then
    echo "SELF-TEST FAIL: an untyped ticket-checkout-status call was NOT caught" >&2
    return 1
  fi

  # The retired string, in a file with no status call at all.
  mkdir -p "$tmp/deadstring"
  cat > "$tmp/deadstring/bad.ts" <<'FIXTURE'
export const copy =
  "We couldn't confirm your payment yet. If you completed it, your tickets will appear shortly.";
FIXTURE
  if run_check "$tmp/deadstring" >/dev/null 2>&1; then
    echo "SELF-TEST FAIL: the retired timeout string was NOT caught" >&2
    return 1
  fi

  # A COMMENT quoting the compliant shape must not be read as a call site.
  mkdir -p "$tmp/comment"
  cat > "$tmp/comment/ok.ts" <<'FIXTURE'
// We used to call invoke<{ order: { orderId } | null }>("ticket-checkout-status").
/* And the block-comment form: invoke("ticket-checkout-status") */
const { data } = await supabase.functions.invoke<{
  status?: string;
  order: { orderId: string } | null;
  error?: string;
}>("ticket-checkout-status", { body: { checkoutSessionId, buyerStatusToken } });
FIXTURE
  if ! run_check "$tmp/comment" >/dev/null 2>&1; then
    echo "SELF-TEST FAIL: a commented-out call site was read as real" >&2
    return 1
  fi

  # A NAMED response interface — the web rail's shape. Must PASS.
  mkdir -p "$tmp/named"
  cat > "$tmp/named/ok.ts" <<'FIXTURE'
export interface TicketCheckoutStatusResult {
  checkoutSessionId: string;
  status: string;
  order: { orderId: string } | null;
  error?: string | null;
}
export const getStatus = async () =>
  invokeOrThrow<TicketCheckoutStatusResult>("ticket-checkout-status", {
    checkoutSessionId,
    buyerStatusToken,
  });
FIXTURE
  if ! run_check "$tmp/named" >/dev/null 2>&1; then
    echo "SELF-TEST FAIL: a correct NAMED response interface was rejected" >&2
    return 1
  fi

  # A named interface that drops `error` — the resolution path must still FAIL.
  mkdir -p "$tmp/namedbad"
  cat > "$tmp/namedbad/bad.ts" <<'FIXTURE'
export interface StatusResult {
  checkoutSessionId: string;
  status: string;
  order: { orderId: string } | null;
}
export const getStatus = async () =>
  invokeOrThrow<StatusResult>("ticket-checkout-status", {
    checkoutSessionId,
    buyerStatusToken,
  });
FIXTURE
  if run_check "$tmp/namedbad" >/dev/null 2>&1; then
    echo "SELF-TEST FAIL: a named interface missing \`error\` was NOT caught" >&2
    return 1
  fi

  # A generic the script cannot resolve — deny by default, never assume.
  mkdir -p "$tmp/unresolvable"
  cat > "$tmp/unresolvable/bad.ts" <<'FIXTURE'
export const getStatus = async () =>
  invokeOrThrow<SomeTypeFromAnotherPackage>("ticket-checkout-status", {
    checkoutSessionId,
    buyerStatusToken,
  });
FIXTURE
  if run_check "$tmp/unresolvable" >/dev/null 2>&1; then
    echo "SELF-TEST FAIL: an unresolvable response type was NOT caught" >&2
    return 1
  fi

  echo "SELF-TEST OK — the gate accepts inline and named response types and the #1930 preflight, and rejects order-only, error-less, untyped, unresolvable and the retired string."
}

if [ "${1:-}" = "--self-test" ]; then
  self_test
  exit 0
fi

if [ "$#" -gt 0 ]; then
  run_check "$@"
else
  run_check "${DEFAULT_ROOTS[@]}"
fi
