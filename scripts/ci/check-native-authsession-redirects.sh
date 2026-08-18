#!/usr/bin/env bash
#
# issue #2227 — strict-grep registry: NO https redirect may ever be handed to
# WebBrowser.openAuthSessionAsync on a native surface.
#
# WHY THIS GATE EXISTS
# --------------------
# expo-web-browser >= 15 branches on the redirect argument's scheme. When it is
# `https`, iOS >= 17.4 gets
#   ASWebAuthenticationSession(url:, callback: .https(host:path:))
# which REQUIRES the app to carry an Associated Domains entitlement with the
# `webcredentials` service for that host. Neither Mingla app has one — both
# carry `applinks:` only, and the served apple-app-site-association files have
# no `webcredentials` key. iOS therefore destroys the session at start(), in
# under 100ms, before it draws a pixel, and reports it through SVCPrivacy as
#   "SFAuthenticationSession was cancelled by user."
# Nobody cancelled anything. Every Nigerian buyer on the Explorer app was
# blocked by this for the whole life of the SDK 54 build (#2227, P0).
#
# Invariant: I-PROPOSED-NATIVE-BROWSER-NO-HTTPS-AUTHSESSION.
#
# WHAT PASSES
#   - no redirect argument at all            openAuthSessionAsync(url)
#   - an explicit `undefined`                openAuthSessionAsync(url, undefined)
#   - a custom-scheme string literal         "mingla-business://onboarding-complete"
#   - an identifier declared in the same file as a custom-scheme literal
#
# WHAT FAILS
#   - any http:// or https:// literal
#   - any redirect this script cannot statically prove is a custom scheme
#     (deny by default — an unprovable redirect is exactly how #2227 shipped)
#
# Usage:
#   scripts/ci/check-native-authsession-redirects.sh
#   scripts/ci/check-native-authsession-redirects.sh --self-test
#   scripts/ci/check-native-authsession-redirects.sh <root> [<root> ...]

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# SPEC #2227 §9 names app-mobile/src + mingla-business/src. The two `app/`
# routers are scanned too: `mingla-business/app/partner/earnings.tsx` holds two
# real call sites, and a gate that cannot see a call site does not guard it.
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

CALL = "openAuthSessionAsync"
LITERAL = re.compile(r'^(["\'])(.*)\1$', re.S)
SCHEME = re.compile(r'^([A-Za-z][A-Za-z0-9+.\-]*)://')

def strip_comments(text: str) -> str:
    """Blank out comments WITHOUT touching string literals.

    A naive `//` regex eats the `//` inside "mingla-business://…" and silently
    turns a provably-safe custom scheme into an unresolvable one. String-aware
    scanning is the only correct way to do this on a file full of URLs.
    """
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
                i += 1
            continue
        if ch == "/" and i + 1 < n and text[i + 1] == "*":
            end = text.find("*/", i + 2)
            i = n if end == -1 else end + 2
            out.append(" ")
            continue
        out.append(ch)
        i += 1
    return "".join(out)

def split_top_level(args: str):
    parts, depth, current = [], 0, []
    for ch in args:
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append("".join(current))
            current = []
            continue
        current.append(ch)
    parts.append("".join(current))
    return [p.strip() for p in parts if p.strip() != ""]

def call_args(source: str, open_paren: int):
    """Return the raw argument text of the call whose '(' is at open_paren."""
    depth = 0
    for i in range(open_paren, len(source)):
        if source[i] == "(":
            depth += 1
        elif source[i] == ")":
            depth -= 1
            if depth == 0:
                return source[open_paren + 1 : i]
    return None

def resolve_identifier(source: str, name: str):
    """A const declared in the same file as a plain string literal, or None."""
    match = re.search(
        r"\bconst\s+" + re.escape(name) + r"\s*(?::[^=]+)?=\s*(['\"])(.*?)\1",
        source,
    )
    return match.group(2) if match else None

def verdict(source: str, redirect: str):
    """(ok, reason) for one redirect argument."""
    if redirect == "" or redirect == "undefined":
        return True, "no redirect argument"
    literal = LITERAL.match(redirect)
    value = literal.group(2) if literal else resolve_identifier(source, redirect)
    if value is None:
        return False, (
            f"cannot statically prove `{redirect}` is a custom scheme — deny by "
            "default (this is exactly how #2227 shipped)"
        )
    scheme = SCHEME.match(value)
    if scheme is None:
        return False, f"`{value}` names no URL scheme"
    if scheme.group(1).lower() in ("http", "https"):
        return False, (
            f"`{value}` is an {scheme.group(1)} redirect — iOS >= 17.4 needs a "
            "`webcredentials:` Associated Domain the app does not have and will "
            "destroy the session before it presents"
        )
    return True, f"custom scheme `{scheme.group(1)}://`"

def scan(roots):
    findings, scanned = [], 0
    for root in roots:
        if not os.path.isdir(root):
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d != "node_modules"]
            for filename in filenames:
                if not filename.endswith((".ts", ".tsx", ".js", ".jsx", ".mjs")):
                    continue
                path = os.path.join(dirpath, filename)
                raw = open(path, encoding="utf-8", errors="replace").read()
                if CALL not in raw:
                    continue
                source = strip_comments(raw)
                for match in re.finditer(re.escape(CALL) + r"\s*\(", source):
                    scanned += 1
                    args = call_args(source, source.index("(", match.end() - 1))
                    if args is None:
                        findings.append((path, "unbalanced call parentheses"))
                        continue
                    parts = split_top_level(args)
                    redirect = parts[1] if len(parts) > 1 else ""
                    ok, reason = verdict(source, redirect)
                    if not ok:
                        findings.append((path, reason))
    return findings, scanned

roots = sys.argv[1:]
findings, scanned = scan(roots)
for path, reason in findings:
    print(f"FAIL {path}: {reason}", file=sys.stderr)
if findings:
    print(
        f"\n{len(findings)} forbidden openAuthSessionAsync redirect(s) across "
        f"{scanned} call site(s).\n"
        "Invariant: I-PROPOSED-NATIVE-BROWSER-NO-HTTPS-AUTHSESSION (issue #2227).\n"
        "Use WebBrowser.openBrowserAsync(url), or a custom scheme the app owns.",
        file=sys.stderr,
    )
    sys.exit(1)
print(f"OK — {scanned} openAuthSessionAsync call site(s), zero https redirects.")
PY
}

self_test() {
  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN

  # A compliant fixture — must PASS on its own.
  mkdir -p "$tmp/clean"
  cat > "$tmp/clean/ok.ts" <<'FIXTURE'
const RETURN_DEEP_LINK = "mingla-business://onboarding-complete" as const;
await WebBrowser.openAuthSessionAsync(url, RETURN_DEEP_LINK);
await WebBrowser.openAuthSessionAsync(other);
await WebBrowser.openAuthSessionAsync(third, "com.mingla.app.v2://paystack-return");
FIXTURE
  if ! run_check "$tmp/clean" >/dev/null 2>&1; then
    echo "SELF-TEST FAIL: the compliant fixture was rejected" >&2
    return 1
  fi

  # The #2227 shape — an https literal. Must FAIL.
  mkdir -p "$tmp/https"
  cat > "$tmp/https/bad.ts" <<'FIXTURE'
await WebBrowser.openAuthSessionAsync(authUrl, "https://host.usemingla.com/checkout/x/confirm");
FIXTURE
  if run_check "$tmp/https" >/dev/null 2>&1; then
    echo "SELF-TEST FAIL: an https literal redirect was NOT caught" >&2
    return 1
  fi

  # The #2227 shape as it actually shipped — an unresolvable member expression.
  mkdir -p "$tmp/opaque"
  cat > "$tmp/opaque/bad.ts" <<'FIXTURE'
await WebBrowser.openAuthSessionAsync(data.authorizationUrl, data.returnUrl);
FIXTURE
  if run_check "$tmp/opaque" >/dev/null 2>&1; then
    echo "SELF-TEST FAIL: an unprovable redirect was NOT caught" >&2
    return 1
  fi

  # A same-file constant that resolves to https. Must FAIL.
  mkdir -p "$tmp/const"
  cat > "$tmp/const/bad.ts" <<'FIXTURE'
const NG_RETURN_PREFIX = "https://host.usemingla.com/o/venue/";
await WebBrowser.openAuthSessionAsync(created.authorizationUrl, NG_RETURN_PREFIX);
FIXTURE
  if run_check "$tmp/const" >/dev/null 2>&1; then
    echo "SELF-TEST FAIL: an https constant redirect was NOT caught" >&2
    return 1
  fi

  echo "SELF-TEST OK — the gate accepts custom schemes and rejects https, opaque and https-constant redirects."
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
