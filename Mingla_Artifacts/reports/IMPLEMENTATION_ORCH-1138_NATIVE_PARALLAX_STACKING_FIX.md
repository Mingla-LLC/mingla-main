# IMPLEMENTATION — ORCH-1138 [trip-page-redesign] — NATIVE parallax stacking fix

**Scope:** scoped bug fix in the shared Direction-A foundation primitive. No SPEC re-implementation.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1138-[trip-page-redesign]/` on branch `ORCH-1138-trip-page-redesign`.
**HEAD after fix:** `9ad924856`.
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1138_LEG1_FOUNDATION_AND_TRIP.md` §4.1.1 (z-order contract).
**Status:** implemented + happy-path verified (source-structure); native visual parallax UNVERIFIED — needs on-device confirmation via a dev OTA (cannot verify native rendering headlessly).

---

## 1. Summary (plain English)

On the public trip page in the native app, the scrolling details slid *behind* the cover image
instead of *over* it (the opposite of the approved parallax). The web version was already correct.
Root cause: React Native native has no CSS `position:fixed`, so it decides what paints on top using
sibling z-index — and the scrolling content layer had no z-index at all, so the cover (which DID have
one) painted over it. Fixed by giving the native scroll layer an explicit z-index that sits between
the cover (lowest) and the floating X/Share/Mute chrome (highest). The web parallax is untouched.

## 2. Root cause (confirmed)

A web-vs-native parallax divergence, exactly as suspected.

- The web phone branch pins the cover with `position:fixed` (out of document flow) and the document
  stacking model resolves cover (z1) < body (z2) < chrome (z70) correctly. Tester confirmed web works.
- The **native branch** (`ParallaxCoverShell.tsx`, native return block) has three direct children of
  `nativeHost`: the absolute cover (`nativeCover`, `zIndex: 1`), the `ScrollView` (content host, **no
  zIndex → auto = 0**), and the absolute chrome (`nativeChrome`, `zIndex: 70`).
- RN native resolves z-order by **sibling zIndex within a shared parent + tree order**. Because the
  ScrollView had no zIndex (0) and the cover had zIndex 1, the absolute cover painted **over** the
  ScrollView → the scrolling body disappeared behind the cover. The `zIndex: 2` set only on the inner
  `nativeBody` View was **inert**: `nativeBody` is nested *inside* the ScrollView, so its zIndex
  ordered it against the spacer, not against the cover (a sibling one level up).

## 3. Files changed

| File | Change | Δ lines |
|------|--------|---------|
| `packages/offering-rendering/ParallaxCoverShell.tsx` | native stacking fix + exported z-contract constants + native/web branches repointed to them + native-stacking trap doc comment | +44 / −7 |
| `mingla-business/src/components/trip/__tests__/ParallaxCoverShell_native_stacking.test.ts` | NEW happy-path regression (7 tests) | +135 (new) |

Both are inside the SPEC §12 ALLOWLIST (`packages/offering-rendering/**`; test in an `__tests__/` dir).
No file outside the allowlist was touched.

## 4. The fix — how native now guarantees cover < content < chrome

1. Added exported contract constants (single source of truth, shared web + native):
   `export const COVER_Z = 1; export const CONTENT_Z = 2; export const CHROME_Z = 70;`
2. **Native content layer now z-indexed** — the load-bearing fix. The native `<Scroll>` element now
   carries `style={styles.nativeScroll}`, where `nativeScroll: { zIndex: CONTENT_Z }`. This raises the
   ScrollView (the whole content layer) above the cover and below the chrome at the `nativeHost`
   sibling level — which is the level that actually decides paint order on native.
   - `nativeCover.zIndex` → `COVER_Z` (lowest; absolute, out of scroll flow). Unchanged value.
   - `nativeChrome.zIndex` → `CHROME_Z` (highest; absolute box-none sibling). Unchanged value.
   - `nativeBody.zIndex` → `CONTENT_Z` (kept as belt-and-suspenders inside the scroll; the
     load-bearing ordering is now `nativeScroll`).
3. Content occludes the cover as it slides: the native body keeps its **opaque** `palette.page`
   background and the `nativeSpacer` holds the full cover height (`aspectRatio: 4/5`, equal to the
   cover) so the body starts below the cover then slides up and over it with the `−SEAM` overlap.

Resulting native sibling order at `nativeHost`: cover (1) < ScrollView/content (2) < chrome (70). ✓

## 5. Web parallax preserved (no regression)

The web phone branch was NOT restructured — only its inline z-index **literals** were repointed to
the same constants with **identical values**: pinned cover `zIndex: COVER_Z` (1), sliding body
`zIndex: CONTENT_Z` (2), fixed chrome `zIndex: CHROME_Z` (70). `position:fixed`/`relative` and all
other web styles are byte-equivalent. Desktop branch untouched. The regression test asserts the web
branch still references all three constants (test: "web parallax is preserved").

## 6. Regression test + fails-on-revert

- **Path:** `mingla-business/src/components/trip/__tests__/ParallaxCoverShell_native_stacking.test.ts`
- **Shape:** source-structure (`readFileSync` + regex), matching the existing `TripVisualParity.test.ts`
  pattern so it runs under the default `mingla-business` node/ts-jest config (no RTL needed).
- **Passing run:** `7 passed, 7 total` (full trip-dir run also shows `PASS` for this file).
- **fails-on-revert: VERIFIED at `9ad924856`** by TRUE LINE DELETION (not comment-out) of the native
  `style={styles.nativeScroll}` wiring → `1 failed, 6 passed` (the "native ScrollView carries an
  explicit zIndex above the cover (THE FIX)" assertion fails). Restored → `7 passed`.

The visual parallax itself is NOT machine-verifiable headlessly; the test pins the z-order *contract*
(the proven root cause), not the rendered pixels.

## 7. Old → New receipt

### packages/offering-rendering/ParallaxCoverShell.tsx
**Before:** native `<Scroll>` had no `style`/zIndex; content layer was auto-z (0) below the cover's
zIndex 1 → cover painted over the scrolling body (device bug). zIndex values were inline literals.
**Now:** native `<Scroll>` carries `styles.nativeScroll` (`zIndex: CONTENT_Z`), placing content
between cover and chrome at the sibling level that governs native paint order. All cover/content/chrome
zIndex values (native + web phone) read exported `COVER_Z/CONTENT_Z/CHROME_Z` constants. Added a
"NATIVE STACKING (THE TRAP)" doc block.
**Why:** SPEC §4.1.1 contract "cover z1 < content z2 < chrome z70" was satisfied on web but inverted
on native; this is the native enforcement of that contract.
**Lines:** ~+44 / −7.

## 8. Cross-surface impact

| Surface | Affected? | What changes | Parity |
|---------|-----------|--------------|--------|
| Consumer iOS | No | foundation not yet mounted in app-mobile | — |
| Consumer Android | No | same | — |
| Buyer/anon Web (`/t/`) | No behavior change | web zIndex literals → constants, values identical | automatic (shared primitive) |
| Business iOS | **Yes** | native trip page details now slide OVER the cover (the fix) | automatic (shared primitive) |
| Business Android | **Yes** | same fix; android glass policy untouched | automatic |
| Admin Web (adjacent) | No | does not import this package | — |
| Business Web preview (adjacent) | No behavior change | same as buyer web | automatic |

Parity is **automatic** — the fix lives in the shared foundation primitive, so event/experience/brand
pages inherit it when they mount `ParallaxCoverShell` in later legs.

## 9. Gates run

- `ParallaxCoverShell_native_stacking.test.ts` → 7/7 PASS; fails-on-revert proven.
- Full `src/components/trip/__tests__/` run: my file PASS; the 27 failures are the SPEC §14-documented
  pre-existing trip-corpus baseline (TripVisualParity SC-17/A-11 repoints, Share.share legacy,
  refundGate, PaymentPlanEditor, etc.) — none introduced by this change.
- `orch-1105-web-glass-opaque-fallback.mjs` strict-grep → PASS (not touched, ran as a safety check).
- No DB / edge / migration change — nothing to deploy.

## 10. Known issues / deferred

- Native visual parallax is **UNVERIFIED** (headless limit). Seth re-tests on-device via a dev OTA.
- Pre-existing: `Platform` is imported but unused in `ParallaxCoverShell.tsx` (present before this fix,
  out of scope — left as-is). Flag for the leg's lint pass if desired.

## 11. Operator action required

- None for DB/edge (zero backend change).
- For on-device confirmation: publish a business dev-channel OTA (per `reference_eas_cli_ota_publish_gotchas`)
  and re-test `/t/{brandSlug}/{tripSlug}` — the details body should slide UP and OVER the cover; X /
  Share / Mute stay floating above; cover stays pinned behind.
- Do NOT deploy/merge/close — route to orchestrator REVIEW → tester.

## 12. Discoveries for Orchestrator

- No ORCH-1138-specific strict-grep gate exists yet for the z-order contract. The exported
  `COVER_Z/CONTENT_Z/CHROME_Z` constants + this test pin it; if the leg wants a CI grep gate
  (analogous to the SPEC's RT-* gates), it could assert the native `<Scroll>` carries the content-layer
  zIndex. Out of this scoped fix.
- The wider trip test corpus is red on baseline (SPEC §14 documents 66/68). Unrelated to this fix.
