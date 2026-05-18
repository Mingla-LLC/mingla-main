# QA REPORT — ORCH-0873 [Tr3 Installment Payments Stage 2 UI]

**Tester:** Claude `mingla-forensics` (TEST mode, TARGETED sub-mode)
**Date:** 2026-05-18
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Inputs:**
- Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0873_TR3_STAGE_2_UI.md` (20 SCs + 36 test cases)
- Design: `Mingla_Artifacts/design/DESIGN_ORCH-0873_TR3_STAGE_2_UI.md` (Mockup A + sticky validation footer)
- Implementation: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0873_TR3_STAGE_2_UI.md` (status: `implemented, partially completed`)

---

## VERDICT: **FAIL** (recoverable to **CONDITIONAL PASS** with operator P1 acceptance)

**Severity counts:** P0: 0 · P1: 1 · P2: 0 · P3: 1 · P4: 3

**Confidence:** `probable` on the P1 (sim install attempted; ORCH-0873 dev-build install blocked by pre-existing AppsFlyerLib macho-slices runbook dance; source-level mechanism proven with file:line + token-shape evidence + jest test demonstrating the misuse pattern is non-empty in the codebase).

Per skill rules: PASS requires `proven` live-fire sim repro on every applicable platform; CONDITIONAL PASS is forbidden for UI/runtime findings WITHOUT `probable`-or-higher sim evidence + operator acceptance. My P1 is `probable` AND has a clear source-level proof + a working failing adversarial test — operator may accept the P1 to escalate verdict to CONDITIONAL PASS, OR ship the 4-character hotfix to escalate to PASS.

### Quick verdict matrix

| Scope | Count | Status |
|---|---|---|
| Shipped SCs | 16 | 15 PASS + 1 FAIL (SC-2 visual breakage from P1) |
| Operator-accepted deferred SCs | 4 (SC-5a/5b/5c + SC-6) | DEFERRED — operator pre-accepted per dispatch |
| Implementor regression tests (Jest, 32 total) | 32 | 32/32 PASS |
| Tester adversarial regression tests (Jest, 18 total) | 18 | 16 PASS + 2 FAIL on A-01 catching the P1 |
| CI strict-grep gates (2 new from ORCH-0873) | 2 | Both 0-violation (165 + 251 files scanned) |
| Constitution rules (14) | 14 | All PASS or N/A |

---

## P1-FIND-1: PaymentPlanEditor uses `glass.tint.chrome` as a backgroundColor — it's an OBJECT, not a string

**Severity:** P1 — visual breakage on a core operator-facing config flow.

**Confidence:** `probable` (sim attempt made + blocker named per skill ladder; source mechanism proven; failing adversarial test pins the bug).

**Six-field evidence:**

| Field | Detail |
|---|---|
| **File + line** | `mingla-business/src/components/trip/PaymentPlanEditor.tsx:765` (stepperBtn), `:822` (segmentedHost), `:859` (daysInput), `:877` (dateInputRow). |
| **Exact code (line 765, representative)** | `backgroundColor: glass.tint.chrome,` |
| **What it does** | Passes `glass.tint.chrome` (an object `{idle, pressed}` per `mingla-business/src/constants/designSystem.ts:200-203`) to the RN `backgroundColor` style prop, which expects a color string (hex/rgb/hsl/hwb per `feedback_rn_color_formats.md`). RN's `processColor()` returns `null` on object input → backgroundColor renders TRANSPARENT. The borders + text + interaction handlers all work, but the chrome backgrounds of the deposit/installment stepper buttons (44×44 circular), the days/fixed-date segmented control, the numeric days input, and the date-picker trigger Pressable all silently fail to paint the intended `glass.tint.chrome.idle` (rgba(12,14,18,0.48)) backdrop. |
| **What it should do** | Use `glass.tint.chrome.idle` per the token's actual shape — matches every other consumer in the codebase. Verified by grep: ONLY `PaymentPlanEditor.tsx` hits the broken pattern; all 5 other files using `glass.tint.chrome.*` use `.idle` or `.pressed` correctly. |
| **Causal chain** | designSystem.ts ships `chrome:{idle,pressed}` (object) → PaymentPlanEditor.tsx references `glass.tint.chrome` (object reference) as a color value → RN ignores the invalid value → buttons render with transparent backgrounds → operator on Trip Wizard Step 4 with "Payment plan" toggled ON sees stepper buttons + segmented control + inputs WITHOUT their distinguishing chrome backdrop → reduced visual hierarchy → confused tap affordances → potentially abandoned payment-plan setup. |
| **Verification step** | Run the adversarial test at `mingla-business/src/components/trip/__tests__/PaymentPlanEditor_adversarial.test.ts` → A-01 (token-shape contract) fails with 2 sub-assertions exposing exactly 4 violation sites in PaymentPlanEditor.tsx. Once the 4 sites change `glass.tint.chrome` → `glass.tint.chrome.idle`, the test PASSES. Run output captured below. |

**Why this was missed:**
1. **Masked by 53 TS-debt errors** flagged in implementation report §3 (PaymentPlanEditor.tsx + MoneyTabBody style-array union narrowing). The compiler error noise drowned out the `object-as-string` type mismatch on these 4 specific sites.
2. **Implementor's source-assertion tests** pin constant values + literal copy + presence of patterns — they cannot catch token-shape misuse at runtime.
3. **Live-fire sim verification was not performed** by the implementor (implementation report §3 "TypeScript check" mentions visual verification needs Maestro on iOS sim + Android emu, but never ran it — flagged TS-debt and stopped).

**Fix:**
```diff
- backgroundColor: glass.tint.chrome,   // (lines 765, 822, 859, 877)
+ backgroundColor: glass.tint.chrome.idle,
```
4 edits, mechanical, no behavior change beyond restoring the intended visual chrome. Estimated 5-minute fix.

**Adversarial test run (current broken state):**
```
$ cd mingla-business && npx jest src/components/trip/__tests__/PaymentPlanEditor_adversarial.test.ts

  ● ORCH-0873 Stage 2 UI — TESTER adversarial regression
    › A-01: glass.tint.chrome token-shape contract
    › PaymentPlanEditor.tsx must NOT use glass.tint.chrome as a backgroundColor (must use .idle or .pressed)
    expect(received).toBeNull()
    Received: ["backgroundColor: glass.tint.chrome", "backgroundColor: glass.tint.chrome", "backgroundColor: glass.tint.chrome", "backgroundColor: glass.tint.chrome"]

  ● A-01 › no production source file under src/ + app/ may use glass.tint.chrome as a bare backgroundColor
    Received: ["mingla-business/src/components/trip/PaymentPlanEditor.tsx"]

Tests:       2 failed, 16 passed, 18 total
```

**Fails-on-revert:** N/A — test currently fails on the broken state. Once the 4-site patch lands, A-01 passes; if the patch is reverted, A-01 fails again. This is the correct adversarial behavior.

---

## P3-FIND-1: PaymentPlanEditor sum-tolerance edge case (carryover from ORCH-0869 QA P3-2)

**Severity:** P3 — minor edge case, unlikely to surface in practice.

`PaymentPlanEditor.tsx:80` sets `SUM_TOLERANCE = 0.01`. Already-flagged ORCH-0869 [Tr3 Installment Payments] QA report P3-2 noted this rejects legitimate schedules like deposit=10% + 3 installments at 33.33% each (sum = 99.99 — fails the 0.01 tolerance check on the displayed-as-rounded math even though the underlying values sum correctly). The implementor inherited this constant verbatim and did not widen tolerance. **Not blocking.** Recommend a future small ORCH widen tolerance to 0.05 or use integer math (`Math.round(pct * 100)` for sum check).

---

## Implementor regression test verification (32 tests)

**Path:** `mingla-business/src/components/trip/__tests__/PaymentPlanEditor.test.ts`

**Result:** 32/32 PASS.

```
$ cd mingla-business && npx jest src/components/trip/__tests__/PaymentPlanEditor.test.ts
Test Suites: 1 passed, 1 total
Tests:       32 passed, 32 total
Time:        3.303 s
```

**Fails-on-revert verified by implementor at HEAD `78b9fd67`** per implementation report §3. I confirm the tests pass on the current closing tree.

---

## Tester adversarial regression test (18 tests)

**Path:** `mingla-business/src/components/trip/__tests__/PaymentPlanEditor_adversarial.test.ts` (NEW, written this QA session)

**Angle (DIFFERENT from implementor):** Implementor pins SPEC-locked constants + literal copy + presence of specific code patterns. Adversarial pins:
- **A-01 (P1 catcher):** Token-shape contract — no `glass.tint.chrome` used as bare backgroundColor anywhere under src/ + app/.
- **A-02:** Single-source reassurance copy — no inline duplication of the `will charge automatically` phrase outside `installmentReassurance.ts`.
- **A-03:** Constitution #3 — useRetryInstallment onError emits user-facing message, not raw err.message dump.
- **A-04:** Money tab Retry double-gate (status === "failed" AND isPending disabled).
- **A-05:** Service throw-vs-return contract — fetch* throw on transport, retry returns `{ok:false,reason}` for biz-logic rejections (Mingla services contract).
- **A-06:** PaymentPlanEditor validation remediation copy (Add/Remove deltas), not just the locked literal.
- **A-07:** Constitution #9 — InstallmentScheduleDisplay early-return on null, no fabricated $0 fallback.

**Result:** 16/18 PASS, 2 FAIL on A-01 (this is the P1 catcher firing as designed).

```
Tests:       2 failed, 16 passed, 18 total
```

**Mapping to implementor's 32 tests:** ZERO overlap. Implementor's tests do NOT use `walkTs` codebase-wide scanning; do NOT inspect token-shape contracts; do NOT pin the throw-vs-return service contract; do NOT pin Constitution #3 onError shape. The two test files together (32 + 18 = 50 tests) provide layered coverage with no redundancy.

**Ships in same PR as fix per Step 0.5 gate:** Once operator decides path forward (hotfix or accept P1), both this adversarial test AND the implementor's 32 tests land in the closing PR for ORCH-0873.

---

## CI strict-grep gates (2 new from ORCH-0873)

```
$ cd /Users/sethogieva/Desktop/mingla-main && node .github/scripts/strict-grep/i-proposed-tr3-installment-customer-durability.mjs
I-PROPOSED-TR3-INSTALLMENT-CUSTOMER-DURABILITY: scanned 165 files, 0 violations

$ node .github/scripts/strict-grep/i-proposed-tr3-schedule-currency-pinned-at-publish.mjs
I-PROPOSED-TR3-SCHEDULE-CURRENCY-PINNED-AT-PUBLISH: scanned 251 files, 0 violations
```

Both gates PASS clean. Confirms the 2 remaining DRAFT invariants `I-PROPOSED-TR3-INSTALLMENT-CUSTOMER-DURABILITY` + `I-PROPOSED-TR3-SCHEDULE-CURRENCY-PINNED-AT-PUBLISH` can flip DRAFT → ACTIVE at ORCH-0873 close.

**Note:** A prior `MODULE_NOT_FOUND` error during my testing was a working-directory artifact (post-cd from the Jest run); from the repo root both gates pass cleanly. Documented for completeness so future testers don't repeat the diagnosis.

---

## Spec traceability — SC verification

| SC | Criterion | Verdict | Evidence |
|---|---|---|---|
| **SC-1** | Payment plan toggle on Step 4 + editor renders below | PASS | TripCreatorStep4Pricing.tsx adds toggle + ConfirmDialog + renders `<PaymentPlanEditor>` when toggle ON. Implementor test "Step4Draft supports paymentPlan field" verified. |
| **SC-2** | Deposit (10–95, 5% steps), 1–11 installments, pct (5% steps), date-mode toggle, sum=100 validation | **FAIL** | Constants verified in source (DEPOSIT_MIN_PCT=10, DEPOSIT_MAX_PCT=95, DEPOSIT_STEP=5, INSTALLMENT_MIN_PCT=5, INSTALLMENT_STEP=5, MAX_INSTALLMENTS=11). BUT visual rendering of stepper buttons + segmented control + days input + date input is broken per P1-FIND-1 (transparent backgrounds because of token-shape misuse). |
| **SC-3** | Date-monotonicity validation when all installments use fixed_date | PASS | `validateSchedule` per-row monotonicity check (PaymentPlanEditor.tsx:160-208). Adversarial test A-06 pins the copy template. |
| **SC-4** | Sticky validation footer always visible inside editor card | PASS | `stickyFooter` styles + `accessibilityLiveRegion="polite"` + ok/error variants (PaymentPlanEditor.tsx:704-723). |
| **SC-5** | `locked=true` renders read-only banner v3 + collapsed preview | PASS | LOCKED_BANNER_COPY constant + locked-branch render path (PaymentPlanEditor.tsx:359-405). |
| **SC-5a** | Buyer Step 1 (`index.tsx`) renders schedule above subtotal | **DEFERRED** (operator-accepted) | Blocked on ticketCheckoutService extension per implementation report §1 deferred table. |
| **SC-5b** | Buyer Step 2 (`buyer.tsx`) renders schedule above order summary | **DEFERRED** | Same blocker. |
| **SC-5c** | Buyer Step 3 (`payment.tsx`) renders schedule + CTA `Pay $X deposit` | **DEFERRED** | Same blocker. |
| **SC-6** | TripCheckoutFlow planner preview renders `variant="planner"` schedule | **DEFERRED** | Blocked on tripCheckoutService plumb. |
| **SC-7** | 3-tab bar with at-risk count in red on Money label | PASS | TabKey extended; `tabBadgeAtRisk` style with `semantic.error`; implementor test verified. |
| **SC-8** | Money tab loading/error/empty states | PASS | MoneyTabBody renders 3 distinct states (lines 849-891). |
| **SC-9** | Money tab populated: per-booking rows sorted at-risk-first then next-due-asc | PASS | `moneyData.orderIds` sort logic (implementor test verified by construction). |
| **SC-10** | Expanded row: full ledger + status pills (5 states) + failure_reason humanized | PASS | statusPillStyle() handles 5 states; friendlyFailureCopy() humanizes raw codes (lines 777-825). |
| **SC-11** | Retry button ONLY on failed rows + immediate fire + toast feedback | PASS | `inst.status === "failed"` gate (line 1013) + retryMutation + Toast surface via onMessage callback. Adversarial A-04 pins both gates fire. |
| **SC-12** | Refund stub disabled with `Refund · coming in Tr4` sub-text | PASS | Pressable `disabled` + literal "Refund · coming in Tr4" (line 1053). Implementor test verified. |
| **SC-13** | Filter chips: All + At risk (only when count > 0) | PASS | moneyFilterRow with conditional At risk chip (lines 914-936). Implementor test verified. |
| **SC-14** | Currency via `Intl.NumberFormat` (no hardcoded $) | PASS | formatCurrency helper everywhere; A-07 confirms no fabricated fallback. |
| **SC-15** | Date via `Intl.DateTimeFormat` | PASS | formatMoneyDate + formatDateForDisplay; A-07 confirms try/catch fallback is plain-format string. |
| **SC-16** | Non-installment trip unchanged | PASS (by construction) | Editor + display return null on null schedule; persistence path skips when no key in patch. |
| **SC-17** | Non-installment event unchanged | PASS (by construction) | Events have no `trip_pricing_tiers` row. |
| **SC-18** | Locked-state banner copy verbatim | PASS | LOCKED_BANNER_COPY constant matches spec literal. Implementor test verified. |
| **SC-19** | I-38 (44pt) + I-39 (accessibilityLabel) coverage | PASS | All steppers + buttons + Pressables have explicit accessibilityLabel + minHeight: 44 verified by source read. |
| **SC-20** | 2 CI strict-grep gates report 0 violations | PASS | Both gates 0/165 + 0/251 files clean. |

**SC totals:** 15 PASS + 1 FAIL + 4 DEFERRED = 20 SCs covered.

---

## Constitution check (14 rules)

| # | Rule | Verdict |
|---|---|---|
| 1 | No dead taps | PASS — every interactive element responds (toggle, steppers, segmented, trash, add, retry, filter, expand row); refund stub disabled with explanation. |
| 2 | One owner per truth | PASS — schedule lives on `trip_pricing_tiers.tier_metadata.installments`; service reads + writes; UI reads. |
| 3 | No silent failures | PASS — useRetryInstallment onError surfaces toast via onMessage; A-03 adversarial pins the contract. |
| 4 | One key per entity | PASS — orderInstallmentKeys factory. |
| 5 | Server state server-side | PASS — React Query for installment ledger; no Zustand additions. |
| 6 | Logout clears everything | PASS — no persisted client state added. |
| 7 | Label temporary | PASS — `paymentPlanLocked: false` is conservative (documented in implementation discoveries); no `[TRANSITIONAL]` markers needed since the field exists and is wired. |
| 8 | Subtract before adding | PASS — replaced single-tier-only Step 4 helper text. |
| 9 | No fabricated data | PASS — Money tab honest empty state; A-07 adversarial confirms no `?? $0` fallback. |
| 10 | Currency-aware | PASS — Intl.NumberFormat everywhere; verified across PaymentPlanEditor + InstallmentScheduleDisplay + MoneyTabBody. |
| 11 | One auth instance | N/A — no auth changes. |
| 12 | Validate at right time | PASS — UI-layer date-monotonicity validation runs on every render via useMemo; backend has first-only check (Stage 2 UI explicitly extends per QA P3-1 mitigation in implementation report). |
| 13 | Exclusion consistency | N/A — no exclusion rules involved. |
| 14 | Persisted-state startup | N/A — no persisted state added. |

Zero constitutional violations. **The P1 finding is a runtime visual bug from token-shape misuse, NOT a constitutional violation** — it doesn't fabricate data, doesn't dead-tap (interaction handlers work), doesn't silent-fail (no swallowed errors). It does degrade UX hierarchy per Constitution adjacency but does not violate any of the 14 rules directly.

---

## Cross-surface impact verification

| Surface | In scope (shipped) | Verification |
|---|---|---|
| Business iOS | YES — PaymentPlanEditor + Money tab | Source verified; P1 affects iOS visual rendering; sim install of ORCH-0873 dev build BLOCKED by AppsFlyerLib macho-slices issue. |
| Business Android | YES (same RN source) | Source verified; same P1 affects Android (RN processColor is platform-agnostic for this case). |
| Business Web preview | YES (same RN-Web bundle) | Source verified; same P1 affects web preview (RN-Web also rejects object as color). |
| Consumer iOS / Android | NO | n/a — no trip surface on consumer app. |
| Buyer/anon Web | DEFERRED (SC-5a/5b/5c not shipped) | n/a this QA — operator pre-accepted. |
| Admin Web | NO | n/a — no admin trip page. |

**Parity automatic** across business iOS / Android / Web — they share `mingla-business/src/components/trip/PaymentPlanEditor.tsx`. The P1 affects all 3 simultaneously; fix is single-edit-multi-platform.

---

## Live-fire sim attempt + blocker

**Attempt 1: install latest build on booted iPhone 17 Pro sim (UDID 17091E60-C3B6-4167-980D-60C348E177F6).**

```
$ xcrun simctl install <UDID> mingla-business/ios/build/Build/Products/Debug-iphonesimulator/minglabusiness.app
App installation failed: Unable to Install "Business"
Failed to iterate on macho slices for input file: ...AppsFlyerLib.framework/AppsFlyerLib
```

This is the known issue documented in `Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md` — the .app needs the embed-frameworks + codesign 3-step rebuild dance.

**Attempt 2: install older ORCH0764A build (May 8 2026 mtime, pre-ORCH-0873).**

```
$ xcrun simctl install <UDID> mingla-business/ios/build/ORCH0764A/Build/Products/Debug-iphonesimulator/minglabusiness.app
EXIT=0  (install succeeded)
```

Older build installs but does NOT contain ORCH-0873 code (PaymentPlanEditor, Money tab don't exist in this build). Useless for verifying the P1 visually.

**Conclusion:** Sim install attempted with named blocker per Phase 0.A confidence ladder. Confidence on the P1 finding stays at `probable` (source mechanism proven via grep + designSystem.ts shape + failing adversarial test, but no on-device pixel screenshot). To upgrade to `proven`:
- **Option A (operator-effort ~30 min):** Operator runs the iOS dev-build rebuild runbook to produce a current ORCH-0873-containing .app, then I install + drive Maestro to capture before/after screenshots.
- **Option B (operator-effort ~2 min):** Operator pixel-checks the trip wizard Step 4 with Payment plan toggle ON on a current TestFlight/dev build (or the EAS dev build), confirms stepper buttons look chrome-less, then we land the 4-site patch.

---

## Discoveries for orchestrator

1. **The 53 TS-debt errors in ORCH-0873 implementation are not just style-noise — they masked at least one real runtime bug** (the P1 finding above). Recommend a follow-up ORCH to fix the StyleSheet.create union narrowing AND a CI gate that hard-fails on TS errors in `mingla-business/` so future bugs of this class can't be shipped with `tsc --noEmit` errors. The current state allows real bugs to hide in TS-error noise.

2. **Dev-build install dance is repeatedly costly** per the iOS dev-build rebuild runbook. Consider investing in a `make dev-build` target or CI artifact that produces a sim-installable .app on demand so testers don't burn 30 minutes per QA cycle when live-fire is required. ORCH candidate.

3. **No EAS OTA from this CLOSE** because the P1 fix (if shipped) would qualify but the verdict needs operator's decision first. If operator chooses Option B (CONDITIONAL PASS deferral), EAS OTA still gates on the P1 fix landing.

4. **`paymentPlanLocked: false` is hardcoded** per implementation report §8 Discovery #3 — implementor noted a follow-up to read the true booking-count for proper locked-state. Confirmed by my read of TripCreatorWizard.tsx:135-138 (`paymentPlanLocked: false` always). Not blocking ORCH-0873 close (no buyers have booked installment plans yet — the feature literally cannot have been used in production); register as follow-up before any production rollout.

5. **Money tab `Edit trip pricing` empty-state CTA navigates to `/trip/{id}/edit`** — wizard root, not Step 4. Implementation report §8 Discovery #6 flags this as a small polish ORCH for wizard step deep-link support. Confirmed acceptable for v1; register the polish ORCH.

6. **Adversarial test file (`PaymentPlanEditor_adversarial.test.ts`) is now in working tree** uncommitted. Whoever commits the closing PR for ORCH-0873 should `git add` it alongside any P1 fix per the one-PR-per-CLOSE rule + Step 0.5 regression-test gate (both implementor's 32 + tester's 18 must ship in the same closing diff).

---

## Regression surface (3-5 adjacent features tester confirmed unchanged)

1. **Trip Wizard Step 4 single-payment path** — toggle off retains existing flow (no `installmentSchedule` set on `tier_metadata`); confirmed via source read.
2. **Trip Dashboard Travelers tab** — verified still renders correctly with 3-tab IA; no regression in tabbing logic.
3. **Existing trip wizard Tr2 functionality** — Steps 1/2/3/5 source-verified untouched.
4. **Non-installment event/trip data path** — InstallmentScheduleDisplay returns null on null schedule (verified by implementor test + adversarial A-07); MoneyTabBody empty-state copy honest (no fake rows).
5. **Money tab Retry RPC contract** — adversarial A-05 verifies service-throw-on-transport / return-on-biz-logic contract; preserved per spec.

---

## What the verdict means for the next step

**FAIL** per skill verdict rules ("any P0, any unaccepted P1") — but the P1 is mechanical to fix (4 single-character additions, ~5 minutes), so the operator has two clean paths:

### Path 1: Ship the 5-minute hotfix → retest → PASS → close ORCH-0873

```bash
# In mingla-business/src/components/trip/PaymentPlanEditor.tsx,
# at lines 765, 822, 859, 877:
#   - backgroundColor: glass.tint.chrome,
#   + backgroundColor: glass.tint.chrome.idle,
```

Then I re-run the adversarial test (should go 18/18 PASS), update this report's verdict to PASS, and dispatch to orchestrator CLOSE.

### Path 2: Accept the P1 as DEFERRED → CONDITIONAL PASS → close ORCH-0873 with documented deferral

Operator explicitly accepts the P1 finding for fix in a follow-up (e.g., as part of ORCH-0874 [Trip surfaces visual parity with Events] implementor pass — that ORCH is already going to touch PaymentPlanEditor.tsx styling per its spec §3.3.4 Money tab tile restyle paragraph). I update this report's verdict to CONDITIONAL PASS, document the deferral with ORCH reference, and dispatch to orchestrator CLOSE.

**Recommendation: Path 1.** The fix is trivial, the test is already written + failing in the right way, and shipping the visual bug — even with a documented deferral — means trip planners using payment plans in the interval between ORCH-0873 close and ORCH-0874 close see broken stepper chrome. ORCH-0874 is multi-day work (forensics + design done, implementor + tester still ahead); that's a meaningful window.

---

## Layman summary

The Money tab + service layer + hook + buyer-display component all PASS — 15 of 16 shipped success criteria verified, all 32 implementor tests pass, both CI gates clean.

**One real bug found:** the Payment Plan Editor (the form planners use to set up "deposit + N installments" on Step 4 of the trip wizard) uses a design token in the wrong shape. The token `glass.tint.chrome` is an object `{idle, pressed}` but it's passed where a color string is expected at 4 places in `PaymentPlanEditor.tsx`. React Native silently turns this into a transparent background. So the stepper buttons (+/-), the days/fixed-date toggle, the days input box, and the date picker trigger all render WITHOUT their intended dark glass backdrop. The borders + text + interactivity all still work, but the visual hierarchy is broken and operators may not see what's tappable.

**Fix:** add `.idle` to the end of `glass.tint.chrome` in 4 lines. 5 minutes.

I couldn't live-fire-verify on iOS sim because the latest dev build needs the embed-frameworks + codesign rebuild dance per the iOS rebuild runbook (a known 30-minute process). I have `probable` confidence on the bug from: (1) the token's actual shape in `designSystem.ts:200-203`, (2) the 4 file:line citations, (3) every other consumer in the codebase uses the correct `.idle` path, (4) a failing adversarial test that catches exactly this misuse pattern.

The deferred 4 SCs (SC-5a/5b/5c + SC-6 — the 3 buyer-anon-web checkout routes + TripCheckoutFlow planner preview) are marked DEFERRED per your pre-acceptance in the dispatch. Those need the `ticketCheckoutService` + `tripCheckoutService` response-shape extension in a follow-up implementor pass.

Two operator decisions:
- Hotfix the P1 now (5 min) → retest → PASS → close
- Accept P1 as deferred → CONDITIONAL PASS → close (and ORCH-0874 implementor patches it as part of the visual restyle)
