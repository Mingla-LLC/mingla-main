# IMPLEMENTATION — ORCH-1105 [Business-web parity strict-grep gates]

**Date:** 2026-06-08
**Branch:** `ORCH-1105-business-web-parity-strictgrep-gates`
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1105-[business-web-parity-strictgrep-gates]/`
**Scope:** CI/code only. NO device, NO product-behavior change. Gates only observe.
**Status:** implemented and verified.

---

## Summary

Added 4 self-testing strict-grep CI gates that lock in the business-web parity +
auth-routing invariants shipped by ORCH-1100/1102/1103, wired them into the
mingla-business strict-grep workflow + a `test:orch-1105` package script, and
fixed one stale test (`navTabGate.test.ts`) that referenced the dead
`account_owner` role (renamed to `brand_owner` by ORCH-1047).

All 4 gates pass their `--self-test` AND live mode on the current tree. The full
`test:orch-1105` chain is green. `web:export` produced a full, real bundle (no
degenerate empty export). No new file trips the ORCH-0863 C7
`no-new-backend-files` allowlist (C7 scans only `supabase/migrations/` +
`supabase/functions/`; the new files live under `.github/scripts/strict-grep/`).

---

## The 4 gates

All 4 are pure `node:fs`/`node:path` scripts (zero external deps, like
`orch-1047`), so they run identically in CI, the anchor checkout, and a bare
worktree without `node_modules`.

### 1. `orch-1105-no-route-stub-gates.mjs` — I-NO-ROUTE-STUB-GATES

**Asserts:** zero matches in shipped business source
(`mingla-business/src` + `mingla-business/app`, `.ts/.tsx/.js/.jsx`) for any of
the firewall-era identifiers/strings ORCH-1100/1102 deleted:
`Orch1092SignedOutRecovery`, `Orch1093MobileRouteRecovery`,
`ORCH_1092_SIGNED_OUT_ROUTES`, `ORCH_1100_BLOCKED_MOBILE_WEB_ROUTES`, and the
dead-end stub copy `"staying protected"` / `"Sign in to open "`.

**Robustness:** `__tests__/` dirs and `*.test.*` files are EXCLUDED — the
existing ORCH-1100/1102 regression tests legitimately contain these strings as
`not.toContain(...)` assertions. Docs under `Mingla_Artifacts/` are out of scope
(not in the scan roots).

**Self-test (7 cases):** clean shipped file passes; an excluded test file that
mentions the needles passes; 6 synthetic violations (one per forbidden token)
each FAIL the gate.

### 2. `orch-1105-layout-no-self-redirect.mjs` — I-LAYOUT-NO-SELF-REDIRECT

**Asserts (against `mingla-business/app/_layout.tsx`):**
1. imports/references `isSignInRoute` AND `shouldRedirectToSignInFromRoute`;
2. both are actually CALLED (`shouldRedirectToSignInFromRoute(` + `isSignInRoute(`),
   not merely imported;
3. every `<Redirect href="/" />` is GUARDED. For each root redirect, the gate
   finds the nearest preceding controlling `if (...)` condition and requires a
   sign-in-route-aware guard inside that condition (or the redirect line):
   `!atSignInRoute`, `!isSignInRoute(`, or the `redirectToSignIn` variable
   (which derives from `shouldRedirectToSignInFromRoute` → already false at `/`).
   An unguarded `<Redirect href="/" />` FAILS — this is the React #185 `/`→`/`
   self-redirect loop ORCH-1103 fixed.

**Robustness:** distinguishes a controlling `if (redirectToSignIn)` from a mere
`const redirectToSignIn = ...` declaration by attributing the guard to the
nearest controlling `if` condition, not a naive line-window.

**Self-test (4 cases):** clean guarded layout passes; an unguarded
`<Redirect href="/">` inside `if (loading)` FAILS; a layout missing both imports
flags both predicates; imports-present-but-never-called flags "never called".

### 3. `orch-1105-web-glass-opaque-fallback.mjs` — I-WEB-GLASS-OPAQUE-FALLBACK

**Asserts:**
1. `shouldUseRealBlur` is EXPORTED from
   `mingla-business/src/utils/glassBlur.ts` (the single source of truth for the
   web blur/opaque decision);
2. each glass surface fixed by ORCH-1100 imports `shouldUseRealBlur` from the
   shared `glassBlur` module AND calls it. Gated surfaces: `TopSheet`,
   `GlassChrome`, `Toast`, `BlastCustomersCta`, `AiDisclosureModal`,
   `SheetMobile`.

A surface that renders `BlurView` glass without routing through
`shouldUseRealBlur` would paint a see-through panel on phone web — the exact
ORCH-1100 RC-2 regression. Curated surface list (small, stable, UX-load-bearing),
mirroring the ORCH-1004 curated-list philosophy rather than a fragile BlurView
sweep.

**Self-test (4 cases):** routed-through-helper passes; bare BlurView w/o import
FAILS; import-without-call (dead import) FAILS; helper-export pattern detected.

### 4. `orch-1105-web-gesture-safe.mjs` — I-WEB-GESTURE-SAFE

**Asserts:**
1. each swipe-dismiss sheet — `TopSheet`, `SheetMobile`, `Toast` — uses
   `WebSafeGestureDetector`;
2. those sheets do NOT import `GestureDetector` directly from
   `react-native-gesture-handler`;
3. the ONLY sanctioned direct importer of `GestureDetector` from rngh across
   `mingla-business/src/components/ui` is the wrapper itself
   (`WebSafeGestureDetector.tsx`, the native passthrough).

A bare `<GestureDetector>` on web calls `Reanimated.useEvent` (no web impl) and
crashes the route into the error boundary — the ORCH-1098/1100 crash class. The
import regex tolerates multi-line import blocks and ignores comment/JSDoc
mentions of "GestureDetector" (only the import statement is gated).

**Self-test (5 cases):** direct import detected; comment mention NOT flagged;
multi-line import detected; compliant sheet (wrapper + Gesture-only import) not
flagged; bad sheet (direct import) flagged.

---

## navTabGate test fix

**File:** `mingla-business/src/utils/__tests__/navTabGate.test.ts`
**Before:** referenced `BRAND_ROLE_RANK.account_owner` (5 occurrences). That key
was renamed to `brand_owner` by ORCH-1047 (`brandRole.ts` defines only
`brand_owner: 60`), so `BRAND_ROLE_RANK.account_owner` resolves to `undefined` —
broken test on main.
**After:** all `account_owner` → `brand_owner` (incl. test titles + the JSDoc
header comment).
**Verified:** `npx jest src/utils/__tests__/navTabGate.test.ts` → 13/13 pass.

This edit has deletions (replaced lines), so the closing commit body cites
`[TEST-MOD-APPROVED ORCH-1105]` for the append-only CI gate.

---

## Workflow + package wiring

- **`.github/workflows/strict-grep-mingla-business.yml`** — 4 new jobs added
  after the `orch-1079-mapbox-suggest-no-types-filter` job (before the retired-gate
  comment block): `orch-1105-no-route-stub-gates`,
  `orch-1105-layout-no-self-redirect`, `orch-1105-web-glass-opaque-fallback`,
  `orch-1105-web-gesture-safe`. Each runs the gate's `--self-test` then live mode,
  matching the existing job template exactly. YAML parses cleanly (180 jobs total;
  4 with `1105` in the name). The workflow already triggers on
  `.github/scripts/strict-grep/**` so the new gates run on every relevant PR/push.
- **`mingla-business/package.json`** — added `test:orch-1105` chaining all 4
  gates (each `--self-test` + live) then `npx jest navTabGate.test.ts`.

---

## C7 allowlist

No change needed. The ORCH-0863 C7 `no-new-backend-files` gate scans ONLY
`supabase/migrations/` and `supabase/functions/`. All 4 new files live under
`.github/scripts/strict-grep/` and do not trip C7.

---

## Verification matrix

| Criterion | How verified | Result |
|---|---|---|
| Gate 1 self-test + live | `node orch-1105-no-route-stub-gates.mjs --self-test` (7/7) + live | PASS |
| Gate 2 self-test + live | `node orch-1105-layout-no-self-redirect.mjs --self-test` (4/4) + live | PASS |
| Gate 3 self-test + live | `node orch-1105-web-glass-opaque-fallback.mjs --self-test` (4/4) + live | PASS |
| Gate 4 self-test + live | `node orch-1105-web-gesture-safe.mjs --self-test` (5/5) + live | PASS |
| Each gate FAILS on synthetic violation | self-test injects violations and asserts non-zero exit | PASS |
| navTabGate test green | `npx jest navTabGate.test.ts` → 13/13 | PASS |
| `test:orch-1105` full chain | `npm run test:orch-1105` → all gates + jest green | PASS |
| ORCH-1047 gate still green (test edit safety) | `node orch-1047-brand-owner-renamed.mjs` (self-test + live) | PASS |
| Workflow YAML valid + 4 jobs registered | js-yaml parse → 180 jobs, 4×`1105` | PASS |
| package.json valid JSON + script present | `JSON.parse` + key check | PASS |
| `web:export` clean | `expo export -p web --clear` → full real bundle, clean exit | PASS |

### Note on the full-tree gate sweep
Running EVERY `.github/scripts/strict-grep/*.mjs` from the bare worktree shows 12
pre-existing failures. These are NOT caused by ORCH-1105: (a) several
(`i-proposed-a`, `i37/i38/i39`, etc.) require `@babel/parser` and fail only
because the worktree REPO ROOT has no `node_modules` (they pass on the anchor
checkout); (b) others (`i-proposed-tr2-route-by-event-type`,
`orch-0756a-active-brand-recovery`, `orch-0910-chat-payload-curated-aware`) fail
identically on clean `origin/main` (anchor) and are unrelated app-mobile/business
pre-existing violations; (c) `i-proposed-x-web-deprecation` needs a captured
`expo export` stderr log. None touch any file ORCH-1105 changed. The 4 new gates
use only node builtins, so they are immune to this environment issue.

---

## Old → New receipts

### `.github/scripts/strict-grep/orch-1105-no-route-stub-gates.mjs` (NEW)
**Before:** did not exist. **Now:** I-NO-ROUTE-STUB-GATES gate (~210 lines).
**Why:** lock the ORCH-1100/1102 firewall deletion so route stubs can't return.

### `.github/scripts/strict-grep/orch-1105-layout-no-self-redirect.mjs` (NEW)
**Before:** did not exist. **Now:** I-LAYOUT-NO-SELF-REDIRECT gate (~250 lines).
**Why:** lock the ORCH-1103 `/`→`/` loop guard against regression.

### `.github/scripts/strict-grep/orch-1105-web-glass-opaque-fallback.mjs` (NEW)
**Before:** did not exist. **Now:** I-WEB-GLASS-OPAQUE-FALLBACK gate (~170 lines).
**Why:** lock the ORCH-1100 width-aware blur/opaque fallback on 6 glass surfaces.

### `.github/scripts/strict-grep/orch-1105-web-gesture-safe.mjs` (NEW)
**Before:** did not exist. **Now:** I-WEB-GESTURE-SAFE gate (~180 lines).
**Why:** lock the WebSafeGestureDetector wrapper so the reanimated useEvent-on-web
crash can't regress.

### `.github/workflows/strict-grep-mingla-business.yml`
**Before:** 176 gate jobs, no ORCH-1105. **Now:** +4 jobs (each self-test + live).
**Why:** run the new gates in CI. **Lines:** +52.

### `mingla-business/package.json`
**Before:** no `test:orch-1105`. **Now:** `test:orch-1105` chains the 4 gates +
navTabGate jest. **Lines:** +1 (script).

### `mingla-business/src/utils/__tests__/navTabGate.test.ts`
**Before:** `BRAND_ROLE_RANK.account_owner` (undefined → broken). **Now:**
`BRAND_ROLE_RANK.brand_owner` (valid, rank 60). **Why:** ORCH-1047 rename; test
was red on main. **Lines:** 5 occurrences (titles + comment), ~10 changed.

---

## Cross-surface impact

- **Business iOS / Android / Web preview:** the gates OBSERVE source for these
  surfaces; zero product behavior changes. The navTabGate test fix is test-only
  (no shipped code touched).
- **Consumer iOS/Android, Buyer/anon web, Admin web:** UNAFFECTED — gates scope
  to `mingla-business`; no consumer/admin/buyer code touched.

## Regression test
This is a CI-gates ORCH. The gates ARE the regression mechanism: each gate's
`--self-test` proves it FAILS on a synthetic violation and PASSES on the current
tree (the fails-on-violation proof is built into every gate). The navTabGate fix
is itself a test going from red→green. BACKFILL-EXEMPT for a separate product-code
regression test — there is no product code change.

## Discoveries for orchestrator
- None. The 12 pre-existing full-sweep gate failures (see note above) are
  unrelated environment/pre-existing issues and are out of ORCH-1105 scope.
