# IMPLEMENTATION — ORCH-1137 · Business-web lucide icon systemic fix

**Skill:** mingla-implementor (Claude)
**Date:** 2026-06-14
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1137-[ari-emptystate-plus-glyph]/` on branch `ORCH-1137-ari-emptystate-plus-glyph` (rebased onto origin/main — already up to date)
**SPEC (contract):** `Mingla_Artifacts/specs/SPEC_ORCH-1137_BIZ_WEB_LUCIDE_ICON_SYSTEMIC.md` (commit `c4d34763e`)
**Investigation:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1137_ARI_EMPTYSTATE_PLUS_GLYPH.md` (commit `f15acfaef`)
**Status:** implemented and verified (web-build proof + render-proof + fails-on-revert all run locally).

---

## Comms ledger

Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` on entry.
- **COMMS-0034** (WARN, `ORCH-1136,ALL`, OPEN) — ORCH-1137 OWNS this systemic biz-web lucide fix; ORCH-1136 must not duplicate it. Factored: scope held to the lucide-on-web icon system only; zero web-shell-bug work.
- **COMMS-0003** (WARN, `ALL`, OPEN) — external-API/dep integrations must cite provider doc URLs inline. The one new dependency (`lucide-react`) cites `https://lucide.dev/guide/packages/lucide-react` + `https://www.npmjs.com/package/lucide-react` (in package commit message, the shim header, and §"dependency line" below). Acked.
- **COMMS-0030** (RESOLVED) — iOS build break already fixed (PR #456); no native build performed here, so N/A.

---

## 1. Summary

On the business **web** preview, every icon imported from `lucide-react-native` rendered blank, because `mingla-business/metro.config.js` aliases `lucide-react-native` → `src/shims/lucideReactNativeWebStub.js` on `platform === "web"`, and that shim exported 12 icons each `= () => null`. Worse, any icon name NOT in those 12 (6 are actually used in Ari conversation cards) resolved to `undefined` → React "type is invalid" crash.

This change replaces the null-stub with a **total Proxy resolver backed by the real `lucide-react@0.577.0`** (pinned exact). On web, every lucide icon name renders a real inline `<svg>` glyph, and no icon-shaped name ever resolves to `undefined` (unknown names → a real `HelpCircle` fallback). Native iOS/Android are byte-identical — they still import the real `lucide-react-native` through the untouched `platform === "web"` guard, and no `.tsx` was edited. No DB/edge/service/hook/RLS layer is involved; this is a bundler-shim + dependency fix.

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Verified how | Result | Commit |
|----|-----------|--------------|--------|--------|
| SC-1-Web | Ari empty-state "+" chip renders a visible lucide Plus glyph | Shim test renders `Plus` → real `<svg>` with paths `M5 12h14` + `M12 5v14`; render-proof grep finds the same signature in the exported web bundle | ✓ PASS | `0a9d1ba85` + `3072fd081` |
| SC-2-Web | Send-arrow (`ArrowUp`), header `Menu`/`Settings`, `X` render real icons | T-2 renders each of the 11 live names → all produce a real `<svg>` | ✓ PASS | `3072fd081` |
| SC-3-Web | Ari tool-proposal/multi-select/clarifying cards don't crash: `AlertTriangle, Check, CheckSquare, Pencil, Play, Square` resolve to real components, never undefined | T-2 + T-3 assert all resolve render-capable; Proxy never returns undefined | ✓ PASS | `0a9d1ba85` + `3072fd081` |
| SC-4-Web | Unknown/future icon name → real fallback, never undefined, never throws | T-3 (`ThisIconDoesNotExist1137` + `SomeFutureOnlyIconName`) | ✓ PASS | `0a9d1ba85` + `3072fd081` |
| SC-5-Web | `npx expo export -p web` exit 0 with the new shim+dep (ORCH-1085 not regressed) | Real export ran → exit 0, full bundle produced (`/tmp/orch1137-web-build`) | ✓ PASS | `42cffc3b1` + `0a9d1ba85` |
| SC-6-Native (verify-unchanged) | iOS/Android still load real `lucide-react-native`, byte-identical | Structural: `platform === "web"` guard untouched (1 occurrence intact); zero `.tsx` in the closing diff | ✓ PASS (structural) | `20d45057a` |
| SC-7 | `orch_1057_*` + `orch_1101_*` stay green, unmodified | Ran 7 suites → 85/85 pass; none in the closing diff | ✓ PASS | n/a (untouched) |

---

## 3. Files changed (closing diff vs origin/main — implementation only)

| File | Change | ~lines |
|------|--------|--------|
| `mingla-business/package.json` | + `"lucide-react": "0.577.0"` (exact) | +1 |
| `mingla-business/package-lock.json` | lockfile entry for lucide-react@0.577.0 (+ deps tree) | ~+30 |
| `mingla-business/src/shims/lucideReactNativeWebStub.js` | full rewrite: 12-entry null-stub → total `lucide-react` Proxy resolver | ~18 → ~95 |
| `mingla-business/metro.config.js` | comment-only note above the lucide web alias (no logic change) | +9 |
| `mingla-business/src/shims/__tests__/orch_1137_lucide_web_shim.test.ts` | NEW — happy-path shim test (T-1..T-5), 19 cases | +160 |
| `.github/scripts/strict-grep/i-proposed-1137-biz-web-lucide-real.mjs` | NEW — gate with `--self-test` | +230 |
| `.github/workflows/strict-grep-mingla-business.yml` | + 1 gate job + 1 registry comment line | +14 |
| `.github/workflows/web-build-check.yml` | + render-proof step (T-7) | +18 |

(The closing diff also carries the forensics baseline — SPEC `c4d34763e`, investigation/evidence `f15acfaef` — which predate this implementation and are not mine.)

All 8 changed files are exactly the SPEC §11 allowlist. No DO-NOT-TOUCH file modified.

---

## 4. Data-model / edge-function / RLS changes

**None.** No migration, no edge function, no RLS, no service, no hook. Pure bundler-shim + dependency. No `db push`, no edge deploy.

---

## 5. Regression tests added — fails-on-revert proof

**Happy-path test:** `mingla-business/src/shims/__tests__/orch_1137_lucide_web_shim.test.ts` — 19 cases, all PASS.
Run output: `Test Suites: 1 passed, 1 total · Tests: 19 passed, 19 total`.

**Second catcher (build/structure):** strict-grep gate `i-proposed-1137-biz-web-lucide-real.mjs` (self-test PASS + gate PASS) and the `web-build-check.yml` render-proof step (the lucide Plus path `M5 12h14`/`M12 5v14` was found in the real exported bundle `/tmp/orch1137-web-build/_expo/static/js/web/__common-*.js`).

**fails-on-revert verified at `0a9d1ba85`** (the shim rewrite commit). Procedure (true line-deletion, NOT comment-out): the shim body was overwritten with the original `const IconStub = () => null` 12-entry null-stub, then:
- shim test → **12 of 19 FAILED** (Plus rendered nothing → no SVG path; unknown names → undefined). RED as required.
- strict-grep gate → **exit 1** (`INV-1` violation: `found lucide-react=false, Proxy=false, nullStub=true`). RED as required.
- The real shim was restored from backup → shim test **19/19 PASS**, gate **PASS**, working tree clean against committed HEAD.

`orch_1057_*` / `orch_1101_*` were NOT modified (append-only respected) and stay green: 85/85 across 7 suites.

---

## 6. Old → New receipts

### `mingla-business/src/shims/lucideReactNativeWebStub.js`
**Before:** exported a fixed map of 12 names each `= () => null`; every web glyph blank; names outside the 12 → `undefined` (React crash).
**Now:** `require("lucide-react")` (unwrapping `.default` if a future interop nests icons there), exports a `Proxy` whose `get` returns the real icon for any render-capable name, a real `HelpCircle` (or a local `forwardRef`) fallback for any other icon-shaped name, `undefined` only for `then` (thenable guard), `true` for `__esModule`, and the proxy itself for `default`. Never returns `undefined` for an icon name.
**Why:** SC-1..SC-4 + structurally kills the blank-glyph and F-3 undefined-crash classes for all current and future icon names.
**Lines:** ~18 → ~95.

### `mingla-business/metro.config.js`
**Before:** lucide-react-native → web-shim alias with no note about the stub's behavior.
**Now:** same alias + resolution logic (byte-identical control flow) with a comment recording that the target now renders real icons and must not be reverted to a null-stub.
**Why:** SC-6 (prove native untouched) + prevent a future reader from restoring the stub. **Lines:** +9 comment.

### `mingla-business/package.json` + `package-lock.json`
**Before:** only `lucide-react-native@^0.577.0`.
**Now:** + `lucide-react@0.577.0` (exact). **Why:** the real web SVG icon source, roster-matched to the native lib. **Lines:** +1 / ~+30.

---

## 7. Cross-surface impact

| # | Surface | Affected | Note |
|---|---------|----------|------|
| 1 | Consumer iOS | No | different app; out of scope |
| 2 | Consumer Android | No | different app |
| 3 | Buyer/anon Web (biz public routes) | Yes (incidental) | any lucide glyph on a public web route now renders real — automatic via the shared web alias |
| 4 | Business iOS | No | native loads real `lucide-react-native`; byte-identical |
| 5 | Business Android | No | byte-identical |
| 6 | Admin Web | No | separate app; already uses `lucide-react` |
| 7 | **Business Web preview** (target) | **Yes** | every lucide glyph renders a real `<svg>`; Ari web conversations no longer crash on the 6 previously-missing icons |

Parity is **automatic** (single shared web alias) — no manual per-surface duplication.

---

## 8. Smoke / build result

- `npx expo export -p web` (with `EXPO_PUBLIC_SUPABASE_*` stubs) → **exit 0**, full bundle exported to `/tmp/orch1137-web-build`. ORCH-1085 web-build NOT regressed (`lucide-react` has zero RN deps / no `import.meta`/Flow).
- Render-proof grep: lucide Plus path signature **present** in the exported web JS (`__common-*.js`), proving real glyphs ship (absent under the null-stub).
- Node probe: `shim.Plus` renders `<svg ...><path d="M5 12h14"/><path d="M12 5v14"/></svg>` with `size`/`color`/`strokeWidth` props passing straight through.
- Live device/browser render of the actual Ari empty-state "+" on the running web preview was NOT performed in this session (tester owns the live web render per SPEC downstream routing); the render path is proven at the unit + export + bundle-grep level.

---

## 9. Known issues / deferred

- **Q-A decision (CommonJS):** kept the shim CJS (`require`/`module.exports`) per SPEC. The resolved `require("lucide-react")` exposes icons at the top level (not under `.default`) at 0.577.0 — verified by probe; the `.default` unwrap is a future-proofing no-op today.
- **Q-B decision (fallback):** chose `HelpCircle` as the unknown-name fallback (visible "unknown" affordance), with a local `forwardRef` hard-fallback only if a future roster ever lacks `HelpCircle`. Documented per SPEC.
- No `[TRANSITIONAL]` code introduced.

---

## 10. Operator action required

- **No migration, no edge deploy.** Nothing to `db push`; no edge functions touched.
- **node_modules note:** the worktree's `node_modules` was a stale out-of-tree symlink to the anchor (would have hung the dep add). It was replaced with a real `npm ci` + `npm install lucide-react@0.577.0 --save-exact` in `mingla-business/` (per dispatch instruction). The committed `package.json`/`package-lock.json` reflect the exact pin.
- **Web ships via Vercel export, not an EAS OTA** — no OTA hygiene (COMMS-0027) needed for this fix.
- Route back to orchestrator for REVIEW → tester (live web render of the Ari "+" + real `expo export -p web` + render-proof grep; native unchanged is a structural verify).

---

## 11. Dependency line added (COMMS-0003)

```json
"lucide-react": "0.577.0"
```
- npm: https://www.npmjs.com/package/lucide-react
- docs: https://lucide.dev/guide/packages/lucide-react
- icon roster: https://lucide.dev/icons/
- Pinned EXACT (no caret) to byte-match `lucide-react-native@0.577.0`'s icon roster (shared Lucide monorepo version train). Zero runtime deps (`dependencies: {}`), `react` peer only — bundles clean under Metro web.

---

## 12. Discoveries for orchestrator

- None. Scope held to the SPEC §11 allowlist. The 3 pre-existing closing-diff files (spec/investigation/evidence) are the forensics baseline, not implementation changes.
- At CLOSE: flip `I-PROPOSED-1137-BIZ-WEB-LUCIDE-REAL` DRAFT → ACTIVE; resolve COMMS-0034.

---

## Commit log (7 per-file implementation commits)

```
42cffc3b1  ORCH-1137: add lucide-react@0.577.0 (exact) — real DOM-SVG icons for the biz-web shim
0a9d1ba85  ORCH-1137: rewrite biz-web lucide shim as a total real-icon Proxy resolver
20d45057a  ORCH-1137: metro.config.js — comment-only note on the lucide web alias
3072fd081  ORCH-1137: happy-path shim regression test (T-1..T-5)
0ca00cc0f  ORCH-1137: strict-grep gate I-PROPOSED-1137-BIZ-WEB-LUCIDE-REAL (--self-test)
247517c33  ORCH-1137: register the biz-web lucide gate job + registry comment line
7aabb873e  ORCH-1137: web-build render-proof — assert lucide Plus path signature in export (T-7)
```

---

## REWORK — 2026-06-14 (CI RED on the ORCH-1083 bundle-budget gate)

### What was RED and why

The required check `mingla-business: web build (expo export)` (run 27502138093) succeeded
at the `expo export` step but FAILED at the downstream ORCH-1083 initial-bundle-budget gate:

```
ORCH-1083 bundle-budget FAIL: eager __common chunk is 4030203 bytes, over the 2250000-byte cap
```

**Root cause of the regression:** the first-pass shim backed its total Proxy with a FULL
`lucide-react` barrel import (`const Lucide = require("lucide-react")`). The `"lucide-react"`
package ENTRY is a barrel that statically references every one of the ~1700 icons; Metro's
production minifier cannot tree-shake the unreferenced ones out of a barrel (even with the
package's `sideEffects:false`), so the entire icon library (~1.8MB) landed in the eager web
boot `__common` chunk → 4.03MB total, ~1.78MB over the 2.25MB cap. The local `expo export`
the first pass ran only checked exit-0, NOT the budget gate — that was the gap.

### The fix — tree-shakeable DEEP per-icon imports

`mingla-business/src/shims/lucideReactNativeWebStub.js` now requires EACH used icon from its
OWN deep module path — `lucide-react/dist/esm/icons/<kebab>.js` — instead of destructuring
off the barrel. Each deep require pulls ONLY that one icon module, so the bundler ships ~12
tiny icon modules instead of the whole roster. The total Proxy + `HelpCircle` fallback +
`has`-returns-true contract is UNCHANGED — no icon name ever resolves to `undefined`, nothing
crashes — only the import FORM changed.

### Authoritative used-set (size = 11; +1 fallback = 12 deep requires)

Enumerated from EVERY `lucide-react-native` import across `mingla-business/{src,app}` (no
aliases, no namespace/default imports):

```
AlertTriangle  ArrowUp  Check  CheckSquare  Menu  Pencil  Play  Plus  Settings  Square  X
+ HelpCircle (fallback only)
```

| icon | imported by |
|------|-------------|
| Menu, Settings | `src/screens/ari/AriChatScreen.tsx` |
| Check | `src/components/ari/{QuickReplyChips,MessageList,ClarifyingCard}.tsx` |
| AlertTriangle, Pencil, Play, Plus, X | `src/components/ari/ToolProposalCard.tsx` |
| ArrowUp | `src/components/ari/InputBar.tsx` |
| Check, CheckSquare, Square | `src/components/ari/MultiSelectPrompt.tsx` |
| Plus | `src/components/ari/EmptyState.tsx` |

### PROOF BAR — budget gate run LOCALLY (the gap the first pass missed)

```
$ npx expo export -p web --output-dir /tmp/web-build-check        # exit 0
$ ORCH_1083_WEB_BUILD=/tmp/web-build-check node scripts/ci/orch-1083-initial-bundle-budget.mjs
ORCH-1083 bundle-budget PASS — initial payload 2923294 bytes (ceiling 9405478),
134 chunk files, 0 deferred specifiers in the main entry chunk, __common within cap.
EXIT=0
```

**Eager `__common` chunk: 4,030,203 bytes (BEFORE, RED) → 1,919,903 bytes (AFTER, GREEN).**
Under the 2,250,000-byte cap with ~330KB headroom. `lucide` substring refs in `__common`:
1714 (whole roster) → 23 (the 12 used icons + factory). Initial JS payload 2,923,294 bytes,
well under the 9,405,478 ceiling.

**Render-proof still holds** — the real lucide Plus SVG path signature ships in the export:

```
$ grep -rqF "M5 12h14" /tmp/web-build-check && grep -rqF "M12 5v14" /tmp/web-build-check
PASS: M5 12h14 + M12 5v14 present
```

### Drift guard (extended the existing gate, no parallel gate)

`.github/scripts/strict-grep/i-proposed-1137-biz-web-lucide-real.mjs` gained two invariants
(plus self-test fixtures, all passing):

- **INV-3 (tree-shakeable):** FORBIDS the `"lucide-react"` barrel entry in ANY form
  (`import * as`, `import {…} from "lucide-react"`, `require("lucide-react")`). The deep
  per-icon paths do NOT trip it. This structurally blocks the bloat regression from
  returning.
- **INV-4 (used-set drift):** scans every `lucide-react-native` import across
  `mingla-business/{src,app}` and asserts each name is present in the shim's `USED_ICONS`
  map; FAILS CI with the exact missing name(s) and how to add them if a component imports a
  new icon (otherwise that icon would silently fall back to the HelpCircle placeholder on
  web). Current run: `all 11 lucide-react-native icon name(s) ... present in the shim
  used-set (12 names)`.

### Tests + fails-on-revert

- Happy-path `orch_1137_lucide_web_shim.test.ts` (T-1..T-5) + tester adversarial
  `orch_1137_lucide_web_shim_adversarial.test.ts` (A-1..A-5): **43 passed** with the
  deep-import shim. The never-undefined assertions (T-3, A-1/A-2/A-4/A-5, the `has`-trap
  A-3) are UNCHANGED and still pass — the `HelpCircle` fallback renders a real `<svg>`, so
  the adversarial "renders real `<svg>`" checks for non-used names are satisfied.
- `orch_1057_*` / `orch_1101_*` (7 suites, 85 tests): pass UNMODIFIED.
- **fails-on-revert verified at `e4d8132cf`** (post-rebase hash of the lucide-react add; the
  rework commits sit on top): restoring the `const IconStub = () => null`
  null-stub flips 34 of the 43 shim tests RED **and** flips the strict-grep gate RED (INV-1
  null-stub + INV-4 unparseable map, 2 violations). Restoring the deep-import fix flips both
  GREEN again.

### jest.config.cjs (SPEC amendment — see SPEC §11 append)

The deep ESM icon modules use `export` syntax jest-runtime can't load as bare CJS. A
narrowly-scoped transform of ONLY `lucide-react` was added to `mingla-business/jest.config.cjs`
(`lucide-react/.+\.js$` → babel-jest with babel-preset-expo, already a dep; plus
`transformIgnorePatterns: ["/node_modules/(?!lucide-react/)"]`). Verified beneficial-only:
full business jest suite 82→80 failing suites (the two ORCH-1137 shim suites flip GREEN),
**ZERO newly-failing suites** (the 153 pre-existing unrelated failures — PublicBrandPage /
brandsService / eventCoverMedia source-string drift — are unchanged and out of scope).

### Rebase note

The branch was rebased onto origin/main; a conflict in
`.github/workflows/strict-grep-mingla-business.yml` (ORCH-1136 merged its own job at the same
file tail) was resolved by keeping BOTH the ORCH-1136 and ORCH-1137 jobs.

### Files changed in the rework

| file | change |
|------|--------|
| `mingla-business/src/shims/lucideReactNativeWebStub.js` | barrel require → 12 deep per-icon `require("lucide-react/dist/esm/icons/<kebab>.js")` + `iconOf` interop helper |
| `.github/scripts/strict-grep/i-proposed-1137-biz-web-lucide-real.mjs` | + INV-3 (no-barrel) + INV-4 (used-set drift) + self-test fixtures; INV-1 detector widened to accept deep paths |
| `mingla-business/jest.config.cjs` | narrow lucide-react `.js` babel-jest transform + transformIgnorePatterns un-ignore (SPEC amendment) |
| `Mingla_Artifacts/specs/SPEC_ORCH-1137_BIZ_WEB_LUCIDE_ICON_SYSTEMIC.md` | in-file SPEC amendment for jest.config.cjs |

### Discoveries for Orchestrator

- The `mingla-business` jest suite has **153 pre-existing failing tests across ~80 suites**
  in this worktree, entirely unrelated to ORCH-1137 (PublicBrandPage VE4/ORCH-0962/dataDriven
  source-string assertions, brandsService, eventCoverMedia, trip dashboard parity, etc.).
  They fail identically with the ORIGINAL jest config (verified by stash). Not in ORCH-1137
  scope — flagging for triage.
