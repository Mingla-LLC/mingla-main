# IMPLEMENTATION — ORCH-0834-rescoped: Stripe RN 0.65.1 upgrade + baseline config + free-ticket bottom-sheet migration

**Mode:** IMPLEMENT
**Implementor:** Claude `mingla-implementor`
**Date:** 2026-05-14
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0834-RESCOPED_STRIPE_CONFIG_AND_FREE_TICKET_BOTTOM_SHEET.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0833-0834-RESCOPED_STRIPE_CONFIG_AND_ALL_FILTER_NO_TM.md`

---

## 1. Layman Summary

Six scoped changes shipped on `Seth`:
- Stripe RN SDK upgraded from 0.50.3 to 0.65.1 (15 versions of fixes + iOS 26 support + Stripe-iOS SDK bumped ~24.19 → ~24.30).
- `StripeNativeProvider` now accepts `merchantIdentifier` and `urlScheme` props (env-var fallbacks too); `app/_layout.tsx` passes both with values matching the iOS bundle id; `app.json` now lists the Stripe Expo plugin with the same merchantIdentifier so Apple Pay entitlement is generated on the next native build.
- `TicketClaimConfirmModal` migrated from React Native `Modal` to inline `@gorhom/bottom-sheet` matching the event-detail sheet's UX. Free and paid both feel native and visually consistent. All props (`visible` / `onCancel` / `onConfirm` / `isSubmitting`) preserved — `ExpandedBusinessEventSheet` consumer is unchanged.
- New regression check `npm run test:orch-0834-rescoped` returns 10/10 PASS. Sibling regressions (0828 / 0829a / 0829b / 0829b-d1) all still pass.

**Status:** completed · **Verification:** passed (10/10 new regression + 41/41 sibling regressions + tsc clean on touched files; only pre-existing META-ORCH-0827 structural errors remain on `StripeNativeProvider.tsx` — same as before, no new errors introduced). EAS build outcome is the operator's gate next.

---

## 2. Files Changed (Old → New Receipts)

### 2.1 `app-mobile/package.json` (S0)
**What it did before:** Declared `"@stripe/stripe-react-native": "^0.50.3"`.
**What it does now:** Declares `"@stripe/stripe-react-native": "^0.65.1"`. Added `"test:orch-0834-rescoped"` npm script entry.
**Why:** Spec §3.0 / S0 — diagnostic SDK upgrade to test whether the iOS 26 PaymentSheet hang is a 0.50.3-era bug fixed in later versions. Stripe RN 0.65.1 is the latest published version per `npm view @stripe/stripe-react-native version`.
**Lines changed:** 2 (1 version bump + 1 script entry).

### 2.2 `app-mobile/package-lock.json` (S0)
**What it did before:** Lockfile resolved `@stripe/stripe-react-native` to 0.50.3.
**What it does now:** Lockfile resolved to 0.65.1 after `npm install`. `npm` reported `changed 1 package` — clean swap with no transitive conflicts.
**Why:** Required for EAS Build to install the new version per spec §3.0.
**Lines changed:** ~10 (single resolved entry + integrity hash + tarball URL — all auto-generated).

### 2.3 `packages/payments-native/StripeNativeProvider.tsx` (S1)
**What it did before:** 37-line wrapper that read `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` from `Constants.expoConfig.extra` or `process.env` and passed only `publishableKey` to `<StripeProvider>`. The `<StripeNativeProvider>` props interface accepted only `publishableKey` (optional).
**What it does now:** Extended interface adds optional `merchantIdentifier` and `urlScheme` props. New env-var fallbacks via `EXPO_PUBLIC_STRIPE_MERCHANT_ID` and `EXPO_PUBLIC_STRIPE_URL_SCHEME` (matching the existing publishable-key resolution pattern). `<StripeProvider>` now receives all three values — `publishableKey`, `merchantIdentifier`, `urlScheme`. Refactored to a shared `resolveEnvString(expoExtraKey, processEnvKey)` helper to deduplicate the resolution logic across the three keys.
**Why:** Spec §3.1 / S1. Per Stripe RN documentation: `merchantIdentifier` is required for Apple Pay; `urlScheme` is required for 3DS return flows + Apple/Google Pay redirects. Without these, plain card flows work but Apple Pay + 3DS don't.
**Lines changed:** ~50 (full rewrite — file grew from 37 to ~90 lines with JSDoc + helper + three resolvers).

### 2.4 `app-mobile/app/_layout.tsx` (S2)
**What it did before:** `<StripeNativeProvider>` mounted with no props — relied entirely on env-var fallback for `publishableKey` and had no `merchantIdentifier` or `urlScheme`.
**What it does now:** `<StripeNativeProvider merchantIdentifier="merchant.com.mingla.app.v2" urlScheme="com.mingla.app.v2">`. Both values match the iOS bundle identifier (`com.mingla.app.v2` per app.json) and the existing Info.plist `CFBundleURLSchemes` registration. Inline comment cites the ORCH ID + rationale.
**Why:** Spec §3.2 / S2. Explicit props at the mount site guarantee static-grep-able config (env vars are runtime-only and CI can't verify them).
**Lines changed:** ~10 (added comment + extended JSX with two props).

### 2.5 `app-mobile/app.json` (S3)
**What it did before:** `expo.plugins` array contained 13 plugin entries starting with `["@sentry/react-native/expo", ...]`. Did NOT include `@stripe/stripe-react-native`.
**What it does now:** Added `["@stripe/stripe-react-native", {"merchantIdentifier": "merchant.com.mingla.app.v2", "enableGooglePay": true}]` as the FIRST entry in the plugins array. Plugin entry matches mingla-business's at `app.config.ts:61` (just with the app-mobile-specific merchantIdentifier).
**Why:** Spec §3.3 / S3. Stripe RN's Expo plugin (verified via reading the source at `app-mobile/node_modules/@stripe/stripe-react-native/lib/commonjs/plugin/withStripe.js`) adds the iOS Apple Pay entitlement (`com.apple.developer.in-app-payments`) and Android Google Pay metadata. **Required for Apple Pay**; harmless for plain card flows. JSON validated via `python3 -m json.tool` after the edit — plugins count went from 13 to 14, file parses cleanly.
**Lines changed:** ~7 added.

### 2.6 `app-mobile/src/components/expandedCard/TicketClaimConfirmModal.tsx` (S4)
**What it did before:** 320-line component using React Native `Modal` with `transparent`, `animationType="fade"`. Manual backdrop View + absolute-positioned card container. Dark `#15181f` card with rounded corners + shadow. Free + paid flows rendered through the same modal with conditional labels.
**What it does now:** Migrated to inline `@gorhom/bottom-sheet`. Uses `<BottomSheet>` with `index={visible ? 0 : -1}`, `snapPoints={["60%"]}`, `enablePanDownToClose`, `BottomSheetBackdrop` with `pressBehavior="close"`. Content wrapped in `<BottomSheetView>`. All visual styles preserved (same `#15181f` background now on `backgroundStyle`, same rounded corners, same buyer rows, same orange CTA `#eb7825`, same disclosure text logic, same haptic on Confirm). Added `useEffect` defensive `snapToIndex(0)` / `close()` calls in addition to the declarative `index` prop — matches the proven pattern in `ExpandedBusinessEventSheet.tsx`. All props preserved verbatim (`visible`, `ticketName`, `ticketPriceCents`, `ticketCurrency`, `buyerName`, `buyerEmail`, `buyerPhone`, `isFreeTicket`, `isSubmitting?`, `onCancel`, `onConfirm`) so the consumer is unchanged.
**Why:** Spec §3.4 / S4. Visual consistency with the event-detail sheet (ORCH-0828 pattern). Free + paid both feel native and bottom-sheet-y.
**Lines changed:** ~80 modified (Modal wrapper replaced with BottomSheet wrapper; styles refactored from `card/backdrop` to `sheetBackground/handleIndicator/content`; rendering logic + state machine preserved).

### 2.7 `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` (S5)
**What it did before:** Rendered `<TicketClaimConfirmModal>` as a sibling fragment alongside the inline `<BottomSheet>` event-detail sheet (per ORCH-0828 pattern).
**What it does now:** **UNCHANGED.** Spec §3.4 verified that `TicketClaimConfirmModal`'s public prop interface is preserved verbatim, so the consumer does not need any edits. Two stacked inline `<BottomSheet>` instances coexist per `@gorhom/bottom-sheet` v5 (proven by the TicketMaster sheet pattern at `ExpandedCardModal.tsx:1602-2066`).
**Why:** S5 was a sanity-check task, not a change task. Verified via grep — props match exactly.
**Lines changed:** 0.

### 2.8 `app-mobile/scripts/ci/orch-0834-rescoped-regression-check.mjs` (NEW, S6)
**What it did before:** N/A — new file.
**What it does now:** Node-based regression check with 10 contracts (T-A0 through T-A9) covering all of S0-S5: package.json Stripe version bump, app.json Expo plugin entry shape, StripeNativeProvider props declaration + StripeProvider usage, app/_layout.tsx prop passing, TicketClaimConfirmModal BottomSheet import + RN Modal removal + BottomSheetBackdrop pressBehavior + controlled-props preservation, ExpandedBusinessEventSheet consumer intact. Exit 1 on any FAIL.
**Why:** Spec §3.5 / S6. CI gate prevents future regressions of any of these contracts.
**Lines changed:** ~180 new.

---

## 3. Spec Traceability

| Spec ID / Criterion | Implementation | Result |
|---|---|---|
| S0 (Stripe RN 0.50.3 → 0.65.1) | §2.1 + §2.2 — package.json + lockfile both updated | DONE |
| S1 (StripeNativeProvider props) | §2.3 — merchantIdentifier + urlScheme added, env fallbacks, both passed to StripeProvider | DONE |
| S2 (app/_layout.tsx) | §2.4 — both props with operator-confirmed values | DONE |
| S3 (app.json Expo plugin) | §2.5 — plugin entry added with merchantIdentifier + enableGooglePay:true | DONE |
| S4 (TicketClaimConfirmModal migration) | §2.6 — full Modal → BottomSheet migration with all behavior preserved | DONE |
| S5 (ExpandedBusinessEventSheet sanity check) | §2.7 — verified no consumer edit needed | DONE |
| S6 (Regression script) | §2.8 — 10/10 PASS local | DONE + PASS |
| C1 (EAS build cleanly) | Awaits operator's `eas build --platform ios --profile development` | UNVERIFIED — operator gate |
| C2 (StripeProvider receives merchantIdentifier + urlScheme at runtime) | Source contract verified via T-A3 + T-A4; runtime awaits build | PARTIAL (source) |
| C3 (Apple Pay button appears) | Requires Stripe Dashboard Apple Pay setup + real-device test | UNVERIFIED — operator gate |
| C4 (PaymentSheet hang resolved with test card 4242 on real device) | **PRIMARY DIAGNOSTIC — outcome unknown until real-device retest after EAS build** | UNVERIFIED — operator gate |
| C5 (Free ticket renders as bottom-sheet with handle + rounded corners) | Source verified; runtime awaits build | UNVERIFIED — operator gate |
| C6 (Free Cancel + backdrop tap + swipe-down all dismiss) | BottomSheetBackdrop pressBehavior + enablePanDownToClose configured | PARTIAL (source) |
| C7 (Free Confirm creates ticket — no regression on existing free flow) | Props preserved; existing free-flow logic in ExpandedBusinessEventSheet unchanged | UNVERIFIED — operator gate |
| C8 (Regression check 10/10 PASS) | `npm run test:orch-0834-rescoped` → **10/10 PASS** | PASS |
| C9 (tsc --noEmit clean on touched files) | Only pre-existing META-ORCH-0827 errors on StripeNativeProvider remain (react/expo-constants/@stripe types unresolved — exact same errors as before my edit, lines have shifted). TicketClaimConfirmModal + app/_layout clean. No NEW errors. | PASS (no new errors) |
| C10 (Pre-existing regression checks still pass) | 0828 11/11 + 0829a 15/15 + 0829b 6/6 + 0829b-d1 9/9 | PASS |
| C11 (Apple Pay row visible — optional) | Requires Apple Merchant ID active in Stripe Dashboard + EAS build | UNVERIFIED — operator gate |

**Summary:** 7 DONE + 3 PASS (C8, C9, C10) + 2 PARTIAL (C2, C6 verified at source level) + 6 UNVERIFIED (C1, C3-C5, C7, C11 all require operator's EAS build + real-device retest).

---

## 4. Invariant Verification

| Invariant | Preserved? | Evidence |
|---|---|---|
| `I-PROPOSED-BOTTOMSHEET-INLINE-FOR-EXPANDED-SHEETS` (ORCH-0828) | Y — STRENGTHENED | TicketClaimConfirmModal now joins ExpandedBusinessEventSheet in using the inline pattern. Confirmation surface is now consistent with event-detail surface. |
| `I-PROPOSED-STRIPE-PRESENT-ONCE-ONLY` (ORCH-0829-B) | Y | useStripePaymentSheet wrapper unchanged |
| `I-PROPOSED-TICKET-CLAIM-CONFIRMATION-REQUIRED` (ORCH-0829-A) | Y | Confirmation step still fires before claim/purchase; only rendering changed |
| `I-PROPOSED-O-stripe-no-webview-wrap` | Y | No WebView introduced; Stripe SDK used natively as designed |
| Constitutional Rule 3 (No silent failures) | Y | All error paths preserved from prior implementation |
| Constitutional Rule 8 (Subtract before adding) | Y | Modal wrapper REPLACED (not layered) with BottomSheet wrapper |
| Constitutional Rule 11 (One auth instance) | Y | Auth unchanged |

**New invariants proposed (orchestrator to codify at CLOSE):**
- `I-PROPOSED-STRIPE-PROVIDER-FULL-CONFIG` — StripeProvider must receive merchantIdentifier + urlScheme (or env-var fallbacks). Backed by T-A2/T-A3/T-A4.
- `I-PROPOSED-CONFIRMATION-SHEET-VIA-GORHOM` — confirmation surfaces (paid + free) must use @gorhom/bottom-sheet, NOT React Native Modal. Backed by T-A5/T-A6/T-A7/T-A8.

---

## 5. Parity Check

| Surface | Impact | Action taken |
|---|---|---|
| `app-mobile/` consumer | Direct (all six S-IDs) | DONE |
| `mingla-business/` | Indirect — shares `@mingla/payments-native/StripeNativeProvider.tsx`. New props are optional, so mingla-business's existing `<StripeNativeProvider>` (which passes no props) continues to compile and run identically. **mingla-business stays on Stripe RN 0.50.3 — version drift intentional per spec A6.** | UNCHANGED (per spec scope) |
| `mingla-admin/` | None — admin doesn't use Stripe RN | N/A |
| iOS device | Primary target | UNVERIFIED until EAS build |
| Android emulator | Indirect — same code path; `enableGooglePay: true` in plugin enables Android Google Pay metadata | UNVERIFIED — operator should also Android-test after EAS build if Android matters this sprint |
| Solo / collab | N/A (paid checkout is solo only) | N/A |

---

## 6. Cache Safety

| Cache / state | Affected? | Notes |
|---|---|---|
| React Query keys | NO | None changed |
| Zustand persist | NO | None changed |
| AsyncStorage | NO | None changed |

---

## 7. Regression Surface (5 adjacent features tester should check)

1. **Free ticket claim flow end-to-end** — confirmation sheet should slide up with rounded corners + handle indicator, Cancel + backdrop tap + swipe-down all dismiss, Confirm fires haptic + creates ticket
2. **Paid ticket attempt — primary test** — with test card 4242, the Stripe sheet either renders the card form (PASS — SDK upgrade fixed it) or still hangs (FAIL — dispatches X1/X2/Plan B)
3. **Cross-flow: event-detail sheet + confirmation sheet stacking** — two inline `<BottomSheet>` instances should layer cleanly; no z-index conflicts or gesture-handler stealing
4. **Apple Pay** (if Stripe Dashboard has Apple Pay enabled for the merchantId) — Apple Pay row should appear in PaymentSheet after EAS build
5. **Sibling event flows** — ORCH-0828's Big Party event-detail sheet should still open from Discover tap (no regression in the event-detail sheet code path)

---

## 8. Constitutional Compliance

| # | Rule | Status |
|---|---|---|
| 1 | No dead taps | PASS — every interactive element preserved |
| 2 | One owner per truth | PASS — no duplicate state |
| 3 | No silent failures | PASS — error paths preserved |
| 4 | One key per entity | N/A — no query key changes |
| 5 | Server state server-side | PASS — no Zustand changes |
| 6 | Logout clears everything | PASS — unchanged |
| 7 | Label temporary | N/A — no transitional code |
| 8 | Subtract before adding | PASS — Modal REPLACED by BottomSheet, not layered |
| 9 | No fabricated data | PASS — unchanged |
| 10 | Currency-aware | PASS — formatPrice helper preserved |
| 11 | One auth instance | PASS — unchanged |
| 12 | Validate at right time | PASS — unchanged |
| 13 | Exclusion consistency | N/A |
| 14 | Persisted-state startup | PASS — unchanged |

---

## 9. Local Verification Results

| Gate | Command | Result |
|---|---|---|
| New regression check | `npm run test:orch-0834-rescoped` | **10/10 PASS** |
| ORCH-0828 regression | `npm run test:orch-0828` | **11/11 PASS** (no regression) |
| ORCH-0829-A regression | `npm run test:orch-0829a` | **15/15 PASS** (no regression) |
| ORCH-0829-B regression | `npm run test:orch-0829b` | **6/6 PASS** (no regression) |
| ORCH-0829-B D-1 regression | `npm run test:orch-0829b-d1` | **9/9 PASS** (no regression) |
| `tsc --noEmit` on touched files | `npx tsc --noEmit \| grep StripeNativeProvider\|TicketClaimConfirmModal\|_layout` | Only pre-existing META-ORCH-0827 structural errors on StripeNativeProvider (react/expo-constants/@stripe declarations) — **same as before my edit**, no new errors. TicketClaimConfirmModal + app/_layout clean. |
| Lockfile resolution | `grep -A 2 'node_modules/@stripe/stripe-react-native' app-mobile/package-lock.json` | `"version": "0.65.1"` ✓ |
| node_modules version | `cat .../@stripe/stripe-react-native/package.json` | `"version": "0.65.1"` ✓ |

---

## 10. EAS Build Outcome (operator-fillable placeholder)

After operator runs `cd app-mobile && eas build --platform ios --profile development` (~20 min cloud) + installs the build on real iPhone:

- **Compile outcome:** [PASS / FAIL — fill in. If FAIL, paste the exact error from the EAS build log here. Per spec §A4, a Xcode 26 compile error on Stripe RN 0.65.1 would falsify my Assumption A4 and trigger orchestrator to choose between bench-cycling intermediate versions (0.55, 0.60, 0.62) vs reverting S0 and shipping S1-S6 only.]
- **App launch:** [PASS / FAIL — does the app boot cleanly with no red errors related to Stripe initialization?]
- **Free-ticket flow:** [PASS / FAIL — does the confirmation sheet render as a bottom-sheet with rounded corners + handle indicator? Does Confirm create a ticket?]
- **Paid-ticket flow (test card 4242):** [PASS / FAIL — does the Stripe sheet render the card-entry form within ~3s? Does payment complete with success toast?]
- **Apple Pay row visible:** [YES / NO / NOT_TESTED — depends on Stripe Dashboard Apple Pay setup]
- **Metro log fragment for `[useStripePaymentSheet]`:** [paste relevant log lines from the real-device test session]

---

## 11. Plan B Sequence Trigger

If the real-device paid-checkout retest after EAS build STILL hangs (`presentPaymentSheet → native call` followed by no `← resolved` log), the next dispatches per spec §9.1 are, in order:

1. **X1** (~30 min): Add `bridgelessEnabled: false` to `app-mobile/app.json` `expo-build-properties` config (keeps newArchEnabled: true but disables bridgeless mode — Stripe RN's own changelog says it's "compatible with new architecture when bridgeless mode is disabled"). Another EAS build, another real-device retest.
2. **X2** (~1-2 days): Rewrite paid-flow with `<CardField>` + `confirmPayment` instead of `presentPaymentSheet`, rendered inside the existing `@gorhom/bottom-sheet`. Keeps native UX, bypasses PaymentSheet entirely.
3. **Plan B** (~1 day, last resort): Stripe Hosted Checkout via `expo-web-browser` per `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0833-0834_FILTERS_REGRESSION_AND_RENDERING_ARCHITECTURE.md` § Architecture Options Decision Matrix Option A.

ORCH-0829-B D-1 defensive patches (RPC tombstone-expiry, H-2 try/finally, H-3 timeout race) ship unchanged regardless of which path wins.

---

## 12. Test First (priorities for operator / tester)

1. **Operator runs `cd app-mobile && eas build --platform ios --profile development`** — single most important next step. ~20 min cloud build. Required because S0 (SDK version) and S3 (Stripe Expo plugin) are both native config changes; OTA via `eas update` will not pick them up.
2. **Operator installs new build on real iPhone** (via Expo / TestFlight).
3. **Operator confirms Stripe Dashboard has the `merchant.com.mingla.app.v2` Apple Merchant ID registered** (Dashboard → Settings → Payment methods → Apple Pay → "Add new merchant ID" if not already present). Without this, the Apple Pay entitlement will be set in the entitlements plist but Stripe Dashboard will reject Apple Pay attempts. Skip if you don't care about Apple Pay yet.
4. **Operator tests paid Big Party flow with test card 4242 4242 4242 4242.** **PRIMARY DIAGNOSTIC.** If the card form renders and payment completes — Stripe SDK upgrade fixed the hang; orchestrator closes the six-ORCH bundle. If it still hangs — orchestrator dispatches X1 (bridgeless toggle) next.
5. **Operator tests free Big Party ticket flow** — confirms the new bottom-sheet UX renders correctly + Confirm creates ticket.

---

## 13. Discoveries for Orchestrator

### D-1: mingla-business unchanged on Stripe RN 0.50.3 — version drift intentional per spec A6
mingla-business continues to use `@stripe/stripe-react-native@^0.50.3`. If mingla-business ever needs to upgrade (e.g., for a future feature or to use the same SDK as app-mobile), it should be a separate ORCH because mingla-business's StripeNativeProvider is currently a NO-OP shim (per the prior investigation finding) and would need its own audit before upgrading.

### D-2: Apple Merchant ID setup is operator-gated
The `merchant.com.mingla.app.v2` Apple Merchant ID assumes either operator already has it registered OR will register it in Stripe Dashboard. If neither is true, Apple Pay won't work even after EAS build — but plain card payments will. Calling out so this doesn't surprise the tester or operator.

### D-3: pre-existing TS errors on StripeNativeProvider are documented residue from META-ORCH-0827
Lines reporting `Could not find a declaration file for module 'react'` + `Cannot find module 'expo-constants'` + `Cannot find module '@stripe/stripe-react-native'` on `packages/payments-native/StripeNativeProvider.tsx` are the SAME structural errors documented in prior implementation reports (IMPLEMENTATION_ORCH-0829-B_*.md, IMPLEMENTATION_ORCH-0829-B_D1_*.md). They predate my changes — packages/ tsconfig doesn't resolve declarations from app-mobile's node_modules. **No new errors introduced.** Long-term fix is a separate META-ORCH on packages/ tsconfig consolidation.

### D-4: EAS build cycle time is the primary cost gate now
S0 + S3 both require a fresh native build. Operator's ~20-min EAS cloud build is the bottleneck for retest. Suggest scheduling the build + smoke-test as a single uninterrupted block.

### D-5: Lockfile churn appears minimal (1 package changed)
`npm install` reported `changed 1 package, audited 1068 packages` — no transitive dependency cascade from Stripe RN 0.50→0.65 jump. Lockfile diff should be tight (single resolved entry + integrity hash + tarball URL).

---

## 14. Working-Branch Discipline

All six scoped changes live on `Seth` in `/Users/sethogieva/Desktop/mingla-main`. Files modified or created:

- `app-mobile/package.json` (MODIFIED — Stripe RN bump + npm script)
- `app-mobile/package-lock.json` (MODIFIED — auto by npm install)
- `packages/payments-native/StripeNativeProvider.tsx` (MODIFIED — major refactor)
- `app-mobile/app/_layout.tsx` (MODIFIED — props added)
- `app-mobile/app.json` (MODIFIED — Stripe plugin added)
- `app-mobile/src/components/expandedCard/TicketClaimConfirmModal.tsx` (MODIFIED — major migration)
- `app-mobile/scripts/ci/orch-0834-rescoped-regression-check.mjs` (NEW)

7 files total: 5 MODIFIED + 1 NEW + 1 auto-regenerated lockfile.

No code touched outside these 7 files. No global indexes (DECISION_LOG, INVARIANT_REGISTRY, WORLD_MAP, AGENT_HANDOFFS) written from this skill — those are orchestrator-owned at CLOSE. No migrations applied (no DB changes in this spec). No edge functions deployed (no edge fn changes in this spec). No destructive actions.

---

## 15. Failure Honesty

**Label:** implemented, partially verified.

- Source-level contracts: PASS (10/10 new regression + 41/41 sibling regressions + tsc clean on touched files).
- Build outcome: UNVERIFIED — operator's EAS build is the gate. Risk per spec A4: Stripe RN 0.65.1 may fail Xcode 26 compile (prior research showed 0.51.0 did with `fmt consteval errors`; 0.65.1 is 14 versions newer and presumably fixed, but unverified until build runs).
- Runtime behavior on real device: UNVERIFIED — Confirms the SDK upgrade resolves the iOS 26 PaymentSheet hang OR triggers the Plan B sequence (X1 → X2 → Plan B). Either way, this implementation is correct per spec.

**No false claims.** I did not run the EAS build (operator's gate). I did not test on real device (operator's gate). I did not verify Apple Pay (requires Stripe Dashboard setup + real device).
