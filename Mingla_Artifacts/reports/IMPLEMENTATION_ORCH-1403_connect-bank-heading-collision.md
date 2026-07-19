# IMPLEMENTATION — ORCH-1403 [connect-bank-heading-collision]

**Worktree:** `~/Desktop/mingla-orchs/ORCH-1403-[connect-bank-heading-collision]/` on branch `ORCH-1403-connect-bank-heading-collision`
**Evidence base:** `Mingla_Artifacts/investigations/ORCH-1400-1403-invite-flow-issues-INVESTIGATION.md` (ORCH-1403 section — proven root cause F-5, device geometry + screenshots)
**Status:** implemented, partially verified (structural regression test green + fails-on-revert proven; runtime 640px overlap-gone verification deferred to device — see §9)

---

## 1. Summary (plain English)

The "connect your bank" onboarding page (business app → a brand's Payments → **Set up payments**) painted two headings on top of each other on a real phone: the big "Connect bank to start selling tickets" heading overlapped the top-bar "Set up payments" title and the "Cancel" button, illegible. The page's content area was a fixed, non-scrolling box that vertically centered its content; on a short screen (~640px, a real phone with the browser URL bar) the content was taller than the box and spilled **upward**, painting the heading over the top bar. The fix wraps that content in a **ScrollView** that still centers the content when it fits (so tall screens look exactly as before) but **scrolls** when it is too tall (so short screens no longer overlap — everything is reachable). One component changed; no copy changed; no Stripe/ToS logic touched.

---

## 2. SPEC success-criteria coverage

The dispatch is a proven-fix (no formal SPEC file). Acceptance criterion from the dispatch: *at a 640px (and smaller) viewport, no heading overlaps another and all content is reachable.*

| SC | Criterion | How satisfied | Verified |
|----|-----------|---------------|----------|
| SC-1 | Body scrolls instead of overflowing (centers-when-fits / scrolls-when-tall) | body wrapper is a `ScrollView` with `contentContainerStyle={[styles.body,…]}`, `styles.body.flexGrow:1` + `justifyContent:"center"`, viewport `styles.bodyScroll.flex:1` | ✓ structural test green; ✓ fails-on-revert |
| SC-2 | Header / "Cancel" stays legible above the scroll area | `renderTopBar()` remains a fixed sibling ABOVE the `ScrollView` inside `styles.host` (unchanged); it is outside the scroll content | ✓ code review (structure preserved) |
| SC-3 | No copy change (ORCH-1402 owns the wording) | zero string edits — only the wrapper element + two style keys changed | ✓ git diff |
| SC-4 | No regression to native / tall-screen (still centered when content fits) | `flexGrow:1`+`justifyContent:"center"` on the content container centers short content on all platforms; `ScrollView` is RN-native on iOS/Android | ✓ structural; ⧗ runtime device-verify deferred (§9) |
| SC-5 | Runtime: no overlap at ≤640px, all content reachable | direction proven on device by forensics; the fix removes the overflow mechanism | ⧗ device-verify at 640px (tester/Seth) |

Satisfying commit: **`e58948c21`** (fix + regression test in one commit).

---

## 3. Files changed

| File | Change | ~Lines |
|------|--------|--------|
| `mingla-business/src/components/brand/BrandOnboardView.tsx` | body `<View>` → `<ScrollView>` (+ import, + styles) | +30 / −6 |
| `mingla-business/src/components/brand/__tests__/onboardBodyScrolls.orch1403.source.test.ts` | NEW append-only regression test | +130 (new) |

No other files touched (`git diff --name-only origin/main` = the two files above).

---

## 4. Data-model changes applied

None. Pure client-side layout change. No migration, no RLS, no schema.

---

## 5. Edge functions touched

None. (BrandOnboardView calls `brand-stripe-onboard` at runtime via `useStartBrandStripeOnboarding`, unchanged.)

---

## 6. Regression tests added

- **Path:** `mingla-business/src/components/brand/__tests__/onboardBodyScrolls.orch1403.source.test.ts`
- **Type:** source-structural (readFileSync + structural assertions on the render tree + style objects — NOT token-presence). Runs under the default `mingla-business/jest.config.cjs` (ts-jest/node), no new config, no react-native import.
- **Count:** 5 assertions (1 support: ScrollView imported; 2 decisive: body wrapper is a ScrollView with `styles.body` content container; 3: bug shape absent; 4: `styles.body` is `flexGrow:1`+`justifyContent:center`, NOT `flex:1`; 5: `styles.bodyScroll` is `flex:1`).
- **Green run:** `5 passed, 5 total`.
- **fails-on-revert verified at `e58948c21`** by TRUE mutation of the source back to the bug shape (not a comment-out): reverted the body wrapper `<ScrollView style={styles.bodyScroll} contentContainerStyle={[styles.body,…]}>` → `<View style={[styles.body,…]}>` (+ `</ScrollView>`→`</View>`) AND `styles.body.flexGrow:1` → `flex:1`. Result: **3 failed, 2 passed** (assertions 2, 3, 4 fail; only the ScrollView-import and bodyScroll checks survive — exactly the assertions not tied to the reverted structure). Restored the fix → **5 passed** again.

**CI-registry path to wire (mingla-business jest gates only when explicitly registered — ORCH-1383 lesson; the class-D `jest-suites` job does NOT run jest):**
`mingla-business/src/components/brand/__tests__/onboardBodyScrolls.orch1403.source.test.ts`
Run command: `cd mingla-business && npx jest --config jest.config.cjs --testPathPattern onboardBodyScrolls.orch1403 --runInBand`.
Because this test runs under the **default** `jest.config.cjs` (no dedicated render config needed), it can be added to any mingla-business jest CI job that invokes the default config with a `--testPathPattern`, or given its own tiny job step. Suggested: append the path to the nearest existing mingla-business jest workflow registry.

---

## 7. Old → New receipts

### `mingla-business/src/components/brand/BrandOnboardView.tsx`
**What it did before:** the main render was `<View style={styles.host}>` → `{renderTopBar()}` → `<View style={[styles.body,…]}>` (the state content), where `styles.body = { flex:1, justifyContent:"center", … }`. A **non-scrolling** box: on a short viewport the idle content (heading + subtext + country picker + prereq card + CTA + "Powered by Stripe" + the ToS gate) was taller than the box, and with `justifyContent:"center"` + RN default `overflow:visible` the overflow spilled upward — the heading painted over the fixed top bar ("Set up payments" / "Cancel").
**What it does now:** the state content is wrapped in `<ScrollView style={styles.bodyScroll} contentContainerStyle={[styles.body,…]} showsVerticalScrollIndicator={false}>`. `styles.bodyScroll = { flex:1 }` bounds the scroll VIEWPORT to the space under the fixed top bar; `styles.body` changed `flex:1` → `flexGrow:1` so the content **centers when it fits** (unchanged look on tall screens) and **grows past the viewport and scrolls** when it is too tall (no upward overflow → no overlap). `ScrollView` added to the `react-native` import. The fixed top bar (`renderTopBar()`) is unchanged and remains a sibling ABOVE the ScrollView.
**Why:** ORCH-1403 acceptance — at ≤640px no heading overlaps another and all content is reachable; mirrors the sibling Stripe embedded pages' `overflowY:auto` scroll pattern (`connectEmbeddedPageHelpers.ts`).
**Lines changed:** ~30 added / ~6 removed (1 import line, wrapper element + comment, 2 style keys).

---

## 8. Cross-surface impact

Single shared RN component (`BrandOnboardView.tsx`), no `.web` variant; sole render site `app/brand/[id]/payments/onboard.tsx`. Parity is **automatic** (one codepath renders on all three business surfaces).

| Surface | Affected? | What changes for a user | Parity |
|---------|-----------|--------------------------|--------|
| Consumer iOS | No | consumer app never renders this brand-payments route | — |
| Consumer Android | No | same | — |
| Buyer / anon Web | No | `/brand/[id]/payments/onboard` is an authed brand route, not a buyer route | — |
| **Business iOS** | Yes | latent short-screen / keyboard-raised overflow now scrolls; tall screens unchanged (centered) | automatic |
| **Business Android** | Yes | same | automatic |
| Admin Web (adjacent) | No | separate Vite app; does not import this component | — |
| **Business Web preview (adjacent)** | Yes (the reported bug) | heading no longer overlaps the top bar on short viewports; content scrolls; tall viewports unchanged | automatic |

Native (iOS/Android) rides the next business build; the JS change is shared. `[deploy]` required for business web (web-visible).

---

## 9. Smoke result

- **Structural regression test:** `5 passed` under `jest.config.cjs`; fails-on-revert proven (3 failed on the bug shape), restored to green.
- **Typecheck:** `npx tsc --noEmit` — **zero** errors in `src/components/brand/` (my two files are type-clean). The 800 pre-existing errors in the log are all in `../packages/*` (shared-package type baseline in the worktree), none from this change.
- **strict-grep:** no gate targets `BrandOnboardView.tsx` (the only body-scroll gate, `orch-1193-sheet-body-scroll-bounded.mjs`, targets venue/event sheets). This change trips no gate.
- **Runtime overlap-gone at 640px — NOT verified this session.** A web render-proof is feasible here (react-native-web + react-dom are present in the worktree), but rendering the full BrandOnboardView requires mocking its auth/react-query/ToS hook stack + heavy children, and — more importantly — the dispatch scoped this to ONE new test file with no config churn, so the runtime overlap check is left to device verification. Per forensics the fix removes the exact overflow mechanism; the tester/Seth should confirm on the Samsung (or a 412×640 web viewport) that the heading no longer overlaps "Set up payments"/"Cancel" and all content scrolls into reach.

---

## 10. Known issues / deferred

- No `[TRANSITIONAL]` code introduced.
- The Nigeria/Paystack branch (`brand !== null && paystackSelected`, ~line 549) renders a different child (`BrandPaystackOnboardView`, a self-managing form) via its own inner `<View flex:1>` and is a separate state/codepath from the reported idle Stripe page — left untouched (out of scope; not the reported collision). Flagged in §12 as a possible follow-up if the same short-viewport overflow is observed there.
- Runtime 640px overlap verification deferred to device (§9).

---

## 11. Operator action required

- **No migration.** No edge deploy.
- **Merge/deploy:** orchestrator to REVIEW → tester (adversarial test on a different angle) → merge with `[deploy]` (business web). Native rides the next business build.
- **CI wiring:** register the regression test path (§6) into a mingla-business jest job so it gates (it will not gate otherwise — ORCH-1383 lesson).

---

## 12. Discoveries for Orchestrator

- **Paystack onboarding branch parity:** `BrandOnboardView`'s Nigeria branch renders `BrandPaystackOnboardView` inside a non-scrolling `<View flex:1>`. It was out of scope for ORCH-1403 (different child, different state, not the reported bug), but if the same short-viewport overflow is reported for the Nigeria bank-details form, it needs the same ScrollView treatment (or `BrandPaystackOnboardView` needs its own scroll bound). Register as a candidate if it surfaces.
- **Copy is still ticket-centric** ("Connect bank to start selling tickets" / "selling tickets") — owned by ORCH-1402, deliberately untouched here. `BrandPaymentsView` shares that copy (per the investigation's discovery list) — an ORCH-1402 copy pass scoped only to the 3 named surfaces would leave `BrandPaymentsView` inconsistent.
