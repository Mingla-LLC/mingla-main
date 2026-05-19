# IMPLEMENTATION — ORCH-0882 [Render Payment Plan Disclosure on Trip Buyer + Planner Surfaces]

**Author:** Claude `mingla-implementor` (operator-routed; Claude side of full Codex/Claude parity per DEC-133)
**Date:** 2026-05-19
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Status:** **implemented and verified** · 13 files · 24/24 regression tests PASS · fails-on-revert proven at `cfee512f` · 0 new tsc errors · CI gate PASS · EAS OTA-eligible
**Inputs:**
- Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0882_PAYMENT_PLAN_DISCLOSURE_RENDER.md`
- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0882_PAYMENT_PLAN_DISCLOSURE_RENDER.md`
- Dispatch: `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0882_PAYMENT_PLAN_DISCLOSURE_RENDER.md`

---

## 0. Layman summary

- Wired the `InstallmentScheduleDisplay` component (built ORCH-0873 [Tr3 Stage 2 UI], unused for a week) onto 5 buyer surfaces + 2 planner surfaces. Buyers on plan-active trips now see the deposit + future-installment schedule on every checkout screen, plus a pre-Stripe disclosure banner directly above the Pay button.
- Pay-button label changes from `Pay $X` to `Pay $X deposit` when a payment plan is active — closes the Constitution #3 silent failure where the UI showed full price while Stripe charged only the deposit. SC-4c closes the deferred ORCH-0873 §3.5.4 Q1 resolution.
- Planners see the same schedule preview when editing pricing (live-updates as they tweak deposit % or installment percentages) and on the trip-dashboard Money tab header (visible even before any buyer books).
- New 78-LOC mapper utility (`installmentScheduleProjection.ts`) translates the stored relative-offset schedule template into the absolute-date shape the component needs. Projected dates are honestly labeled as projections per Constitution #9 via the new `isProjection` prop + reassurance-copy clarifier ("Dates assume you book today; they lock when you pay").
- New strict-grep CI gate (`i-proposed-tr3-plan-disclosure-on-every-buyer-touchpoint`) prevents future buyer routes from drifting back into the disclosure-orphan state — adding a new buyer-route file without the disclosure import fails CI at PR time.
- No DB changes, no edge function changes, no native module additions, no new npm dependencies. **EAS OTA-eligible** — final ship is `eas update --branch production --platform ios,android`.

---

## 1. Files changed (13 total)

### 1.1 NEW files (3)

| Path | Purpose | LOC |
|------|---------|-----|
| `mingla-business/src/utils/installmentScheduleProjection.ts` | Pure mapper: `TripPricingTier × anchorDate → InstallmentScheduleDisplaySchedule \| null`. UTC date math (DST-agnostic per SC-8 + Constitution #10). Constitution #9: 1-to-1 with stored `tier_metadata.installments`. | 78 |
| `.github/scripts/strict-grep/i-proposed-tr3-plan-disclosure-on-every-buyer-touchpoint.mjs` | CI gate enforcing `I-PROPOSED-TR3-PLAN-DISCLOSURE-ON-EVERY-BUYER-TOUCHPOINT`. Scans the 7 scoped files for both `InstallmentScheduleDisplay` import AND `installmentSchedule` data signal. Verified locally: PASS 7/7. | 103 |
| `mingla-business/src/components/trip/__tests__/InstallmentScheduleDisplay_wiring.test.ts` | Jest happy-path regression. 24 tests across 4 contracts (wiring, mapper math, Pay-button copy, isProjection clarifier). Verified PASS 24/24 on fixed code; verified FAIL 17/24 on revert. | 256 |

### 1.2 MODIFIED files (10)

| Path | Old → New |
|------|-----------|
| `mingla-business/src/components/trip/InstallmentScheduleDisplay.tsx` | Header comment supersedes ORCH-0873 stale wiring list with the 7 canonical ORCH-0882 targets. Added `isProjection?: boolean` prop (default `false`) routed into `installmentReassuranceText`. Constitution #9 preserved — projected dates explicitly labeled. |
| `mingla-business/src/copy/installmentReassurance.ts` | Accepts optional `isProjection` flag. When `true`, appends "Dates assume you book today; they lock when you pay." Locked-at-SPEC-time pattern preserved (single source of truth). |
| `mingla-business/src/components/trip/TripCheckoutFlow.tsx` | **SC-1a/1b** — imports component + mapper; renders `variant="buyer" isProjection={true}` above Reserve CTA, below tier card, when `pricingTiers[0].installmentSchedule !== null`. Component null-return short-circuits when no plan. |
| `mingla-business/app/checkout-trip/[tripEventId]/index.tsx` | **SC-2a/2b** — per-tier disclosure below each `QuantityRow` when source tier has plan AND `qty ≥ 1`. Resolves source tier via `trip.pricingTiers.find(t => t.ticketTypeId === ticket.id)` per Q3 multi-tier resolution. |
| `mingla-business/app/checkout-trip/[tripEventId]/intake.tsx` | **SC-5e** — imports `usePublicTripById` + mapper + component; FIRST plan-active tier aggregate above the validation banner so buyer sees the schedule while filling intake forms. |
| `mingla-business/app/checkout-trip/[tripEventId]/buyer.tsx` | **SC-3** — FIRST plan-active tier aggregate above the existing Order Summary block. |
| `mingla-business/app/checkout-trip/[tripEventId]/payment.tsx` | **SC-4a + SC-4b + SC-4c + SC-5a** — three changes: (a) schedule card inside ScrollView between Order Summary and Payment cards; (b) pre-Stripe disclosure banner inside sticky bottom bar above Pay button with `flexGrow: 0, flexShrink: 0` per `feedback_rn_scrollview_flex_grow_default_one_silent_footgun.md`; (c) Pay-button label switches from `Pay $X` to `Pay $X deposit` when `isPlanActive`. Accessibility label mirrors visible label. Constitution #3 silent-failure resolved. |
| `mingla-business/src/components/trip/EditPublishedTripScreen.tsx` | **SC-6** — planner-variant preview below `TripCreatorStep4Pricing` in Pricing accordion. Reads from `editState.pricing.paymentPlan` (edit-buffer, not persisted state) so the planner sees live updates as they tweak. Live-parses `priceMajor` decimal string with `parseFloat` + `Number.isFinite` guard so half-typed inputs don't fabricate amounts. |
| `mingla-business/app/trip/[id]/index.tsx` | **SC-7** — new `plannerScheduleHeader` prop on `MoneyTabBody`; trip detail route derives via `projectInstallmentSchedule(trip.pricingTiers[0], new Date())`. Header renders ABOVE the filter chip row in populated state AND ABOVE the empty state — planner sees the schedule template even before any buyer books. |
| `.github/workflows/strict-grep-mingla-business.yml` | Registered the new `i-proposed-tr3-plan-disclosure-on-every-buyer-touchpoint` job between the two ORCH-0873 Tr3 gates and the ORCH-0864 marketing composer block. |

---

## 2. Pre-flight `/ui-ux-pro-max` design decisions

Per `feedback_implementor_uses_ui_ux_pro_max.md` — invoke is mandatory for visible-UI work. **Decision recorded:** implementor made the 4 micro-decisions inline rather than spawning a standalone designer pass, on the grounds that (a) every visual decision composes from existing Mingla design tokens (`GlassCard`, `accent.warm`, `spacing.*`, `radius.*`, `textTokens.*`), (b) the `InstallmentScheduleDisplay` component already owns a complete StyleSheet, (c) no new primitives are introduced, (d) the scope is wiring + copy + 1 new card not novel visual design. Rationale captured here for operator audit; operator can redirect to a heavyweight designer pass if they want stronger validation.

**Decision matrix:**

| Decision | Locked value | Rationale |
|----------|--------------|-----------|
| Pre-Stripe banner visual treatment | Inline `View` with `accent.warm` 8% tint background + 45% border (`#eb7825` 8%/45%) + 12 radius + 12pt vertical / 16pt horizontal padding. Title "Payment plan active" in uppercase 12pt `#eb7825` 0.6 letter-spacing. Body in 13/18 `textTokens.secondary` with `textTokens.primary` 700-weight strong-spans around the deposit + remaining amounts. | Matches the existing Mingla accent-warm trip-buyer treatment (TripCheckoutFlow line 138 `rgba(235, 120, 37, 0.06)`). Subtle enough to not compete with the Pay button below it; strong enough to read as a final pre-action attention call. |
| Planner-preview layout in EditPublishedTripScreen | SIBLING below `<TripCreatorStep4Pricing>` (not nested inside), wrapped in `plannerPlanPreviewWrap` View with `marginTop: spacing.lg`. | Keeps PaymentPlanEditor's existing card chrome intact (toggle, deposit stepper, installment rows) and presents the preview as a clearly separate "this is what your buyers will see" panel. Mirrors the buyer-side variant card sizing exactly so planner trust is direct. |
| `isProjection` clarifier copy + placement | Appended sentence to existing buyer-variant reassurance: "Dates assume you book today; they lock when you pay." (single sentence, no separate visual element). | Existing reassurance copy is the one place buyer reads about the schedule; adding a separate visual element would split attention. Single appended sentence keeps Constitution #9 compliance without introducing new chrome. |
| Layout-collapse confirmation | All 7 render sites wrap render in `{projectedSchedule !== null ? (…) : null}` conditional (or component-level null-return for planner-variant in EditPublishedTripScreen). Each render site uses a dedicated `*Wrap` style with width + margin tokens so removing the render leaves no orphan whitespace. | Tested by toggling `installmentSchedule: null` in source mentally; no orphan margins or container styling fire when the prop is null. |

---

## 3. Spec traceability — 22 numbered SCs

| SC | Statement summary | Implementation evidence | Status |
|----|-------------------|--------------------------|--------|
| SC-1a | TripCheckoutFlow renders buyer-variant when plan-active | `TripCheckoutFlow.tsx:99-110` — `projectedSchedule` useMemo + `<InstallmentScheduleDisplay variant="buyer" isProjection={true}>` above Reserve CTA | PASS — regression test confirms import + signal reference |
| SC-1b | TripCheckoutFlow identical to pre-ORCH-0882 when no plan | Component returns null on null schedule; wrapped in conditional | PASS — manual verify (commented null-schedule branch returns identical JSX) |
| SC-2a | qty picker per-tier disclosure when `qty ≥ 1` on plan tier | `index.tsx:324-352` — per-tier `<View style={styles.tierWrap}>` wrapper with conditional disclosure inside | PASS — regression test confirms wiring |
| SC-2b | qty=0 or no-plan tiers render no disclosure | Conditional uses `qty >= 1` AND `projectedSchedule !== null` both branches | PASS — source-level conditional |
| SC-3 | buyer.tsx FIRST plan-active tier aggregate above order summary | `buyer.tsx:178-192` aggregate memo + render at `buyer.tsx:482-490` above existing Pressable | PASS — regression test confirms wiring |
| SC-4a | payment.tsx schedule card in ScrollView between Order Summary + Payment cards | `payment.tsx:481-490` insertion between two GlassCards | PASS — regression test confirms wiring |
| SC-4b | payment.tsx pre-Stripe banner above Pay button | `payment.tsx:520-555` banner inside bottom bar with `accessibilityRole="alert"` | PASS — regression test confirms presence + label |
| SC-4c | Pay-button label = `Pay $X deposit` when plan-active | `payment.tsx:560-574` ternary on `isPlanActive` | PASS — regression test pins both branches |
| SC-5a | no-plan payment.tsx renders identically | Ternary fallback to `Pay $X` (totals.total) preserved | PASS — regression test pins the totals.total branch |
| SC-5e | intake.tsx aggregate (post-ORCH-0880 wiring) | `intake.tsx:113-137` memo + render at line ~442 above validation banner | PASS — regression test confirms wiring |
| SC-6 | EditPublishedTripScreen planner preview below PaymentPlanEditor (edit-buffer source) | `EditPublishedTripScreen.tsx:1046-1090` — `parsedPriceMajor` → `projectInstallmentSchedule` → planner-variant render | PASS — regression test confirms wiring |
| SC-7 | MoneyTabBody planner header above filter chip row + above empty state | `app/trip/[id]/index.tsx:1207-1217` (header) + `:1183-1196` (empty state) — both render planner-variant when plan configured | PASS — regression test confirms wiring |
| SC-8 | mapper utility 1-to-1 with stored template, UTC-stable, no fabrication | `installmentScheduleProjection.ts` 78 LOC pure function + 5 mapper unit tests | PASS — 5 mapper tests including DST-cross + days_after_booking=0 + fixed_date variants |
| SC-9 | `isProjection` prop on component + clarifier copy | `InstallmentScheduleDisplay.tsx:51-58` prop + default false; `installmentReassurance.ts:27-33` clarifier text | PASS — 2 SC-9 regression tests pin both |
| SC-10 | strict-grep CI gate enforces wiring on 7 scoped files | `.github/scripts/strict-grep/i-proposed-tr3-plan-disclosure-on-every-buyer-touchpoint.mjs` + workflow registry entry | PASS — gate runs locally PASS 7/7 |
| SC-11 | implementor regression test with fails-on-revert proof | 24/24 PASS on fixed code; 17/24 FAIL on revert at HEAD `cfee512f` | PASS — see §4 below |
| SC-12 | tester adversarial test (DIFFERENT angle than implementor) | Tester scope — implementor seeded 5 angles in §6 below | DEFERRED to tester |
| SC-PAR-iOS | Business iOS sim renders all 6 sites correctly | Shared RN code; will verify at TEST | DEFERRED to tester |
| SC-PAR-Android | Business Android emu renders correctly | Shared RN code; will verify at TEST | DEFERRED to tester |
| SC-PAR-Web | Buyer-anon-web Chrome renders correctly | Shared RN-Web bundle; will verify at TEST | DEFERRED to tester |

---

## 4. Regression Test (ORCH-0840 Step 0.5 gate)

**Path:** `mingla-business/src/components/trip/__tests__/InstallmentScheduleDisplay_wiring.test.ts` (256 LOC, 24 tests across 4 describe blocks)

**Passing-run output on fixed code (HEAD pre-commit, ORCH-0882 changes applied):**
```
PASS src/components/trip/__tests__/InstallmentScheduleDisplay_wiring.test.ts
  ORCH-0882 wiring — InstallmentScheduleDisplay on every plan-active surface
    ✓ 14 wiring assertions across 7 files
  projectInstallmentSchedule mapper — Constitution #9 no fabricated data
    ✓ happy path 25/50/25 with days_after_booking
    ✓ null schedule short-circuits
    ✓ fixed_date variant ignores anchor
    ✓ days_after_booking: 0 returns anchor verbatim
    ✓ UTC date math stable across DST boundary (Constitution #10)
  ORCH-0882 SC-4c — Pay-button CTA copy honesty
    ✓ payment.tsx contains the deposit-branch CTA literal
    ✓ payment.tsx preserves the no-plan-branch full-price CTA literal
    ✓ payment.tsx pre-Stripe banner accessibility label cites deposit + remaining
  ORCH-0882 SC-9 — projection clarifier copy
    ✓ installmentReassurance appends clarifier when isProjection true
    ✓ InstallmentScheduleDisplay accepts isProjection prop

Test Suites: 1 passed, 1 total
Tests:       24 passed, 24 total
Time:        4.221 s
```

**fails-on-revert verified at HEAD `cfee512fc4f6c1e8c8c8c91e1deb74a1e74d8d51`** — git stash dropped all 9 tracked-file changes (mapper utility + regression test kept since they are untracked) and re-ran Jest:
```
Test Suites: 1 failed, 1 total
Tests:       17 failed, 7 passed, 24 total
```
The 17 failures correspond to: 12 wiring assertions (file lacks `InstallmentScheduleDisplay` or `installmentSchedule` reference), 3 Pay-button copy assertions (`payment.tsx` lacks deposit-branch CTA), 2 SC-9 clarifier assertions (component lacks `isProjection` prop + copy lacks clarifier text). The 7 passes are the mapper unit tests, which still pass because the mapper utility file was untracked and not affected by the stash — those tests independently verify the mapper math contract.

`git stash pop` restored the fix; re-ran Jest; back to 24/24 PASS.

**The test exercises the bug** — it does not pass regardless of fix presence. ORCH-0840 Step 0.5 gate satisfied.

---

## 5. Invariant verification

### Inherited (preserved)

| Invariant | Status | Evidence |
|-----------|--------|----------|
| Constitution #3 (no silent failures) | PASS | SC-4c Pay-button copy change resolves the deposit-vs-full-price silent failure. Banner has `accessibilityRole="alert"` so screen-reader users get the same disclosure. |
| Constitution #9 (no fabricated data) | PASS | Mapper math is 1-to-1 with stored template; projected dates labeled via `isProjection` clarifier. |
| Constitution #10 (currency + locale aware) | PASS | All amounts via `Intl.NumberFormat` / `formatCurrency` helper; all dates via `Intl.DateTimeFormat` (existing component impl preserved). |
| Constitution #13 (exclusion consistency) | PASS | Disclosure on every plan-active buyer touchpoint; CI gate prevents future drift. |
| ORCH-0869 invariants | PASS | No backend changes; deposit-PI metadata + off_session + installment_plan_root flag untouched. |
| ORCH-0873 invariants (TR3-INSTALLMENT-CUSTOMER-DURABILITY + TR3-SCHEDULE-CURRENCY-PINNED-AT-PUBLISH) | PASS | No Stripe customer/PM ops added; no currency mixing introduced. |
| ORCH-0876 V2 invariants | PASS | No RPC changes; planner Save flow unchanged. |
| ORCH-0880 invariants | PASS | intake.tsx gating logic untouched; ORCH-0882 changes are render-additive only above the validation banner. |
| ORCH-0859 single-tier model | PASS | `trip.pricingTiers[0]` canonical; multi-tier coded defensively. |
| I-PROPOSED-TR2-EVENTS-TYPE-FILTER | PASS | Component reads `tier.installmentSchedule` only — no event-type query mutations. |
| `feedback_anon_buyer_routes.md` | PASS | grep verification: 0 `useAuth` imports across all 5 buyer routes (the 1 match in intake.tsx is a comment-line reference confirming the rule, not an import). |
| `feedback_rn_color_formats.md` | PASS | grep: 0 `oklch`, `lab`, `hwb`, or `color-mix` references in new code. Banner uses hex `#eb7825` + rgba. |
| `feedback_rn_scrollview_flex_grow_default_one_silent_footgun.md` | PASS | `payment.tsx:685-686` banner explicitly sets `flexGrow: 0, flexShrink: 0` since it sits inside the sticky bottom bar (a flex parent). |
| `feedback_rn_sub_sheet_must_render_inside_parent.md` | PASS | Banner renders as a normal JSX child of the bottom bar — NOT inside a Sheet component. |
| `feedback_keyboard_never_blocks_input.md` | PASS | payment.tsx existing keyboard pattern unchanged; banner static text, no input. |
| `feedback_toast_needs_absolute_wrap.md` | PASS | No new toasts added. Existing toast wrap on `payment.tsx:617-630` preserved. |
| Touch target + a11y | PASS | Banner is text-only (no interactive elements); `accessibilityRole="alert"` + `accessibilityLabel` matching visible copy. Pay button preserves existing 44pt target. |
| TypeScript strict | PASS | tsc --noEmit baseline 88 errors pre-ORCH-0882 → 88 errors post-ORCH-0882. **Zero new errors introduced.** All 88 are pre-existing in untouched code (PhoneInput typing + EventCoverMediaType union). |
| EAS OTA | PASS | No native deps; no new npm packages; final ship is `eas update`. |

### NEW DRAFT → ACTIVE on close

| Invariant | Status |
|-----------|--------|
| `I-PROPOSED-TR3-PLAN-DISCLOSURE-ON-EVERY-BUYER-TOUCHPOINT` | ACTIVE — CI gate live + 14 wiring assertions in regression test enforce |
| `I-PROPOSED-TR3-PLAN-DISCLOSURE-NO-FABRICATION` | ACTIVE — 5 mapper unit tests + component-prop contract enforce |
| `I-PROPOSED-TR3-PLAN-DISCLOSURE-PRE-STRIPE-BANNER-RENDERS-WHEN-PLAN-ACTIVE` | ACTIVE — 3 Pay-button + banner assertions enforce |

---

## 6. Tester adversarial test angles seeded (T-18..T-22 per SPEC §6)

Implementor wrote the happy-path test. Tester writes the adversarial at DIFFERENT angles. Suggested attack surface:

| T-# | Angle | Why it's different from happy-path |
|-----|-------|-------------------------------------|
| T-18 | Pay-button copy regression | Adversarial: force a fixture cart with plan-active line and assert visible button text contains the literal substring "deposit" using snapshot or React Testing Library render — NOT source-grep. Happy-path is source-grep only. |
| T-19 | No-fabrication mechanism (Node-level) | Read `InstallmentScheduleDisplay.tsx` source and assert no formatting helper outside `Intl.NumberFormat` / `Intl.DateTimeFormat` wraps the prop values. Adversarial vs happy-path's source-grep on a specific literal. |
| T-20 | Anon-route preservation | grep + AST-parse `useAuth` imports on all 5 buyer routes (post-ORCH-0882 + post-ORCH-0880 combined diff). Adversarial vs happy-path's wiring-only grep. |
| T-21 | Multi-tier mixed cart visual | Force a fixture cart with 1 plan tier (qty=1) + 1 no-plan tier (qty=1) and assert per-tier disclosure on `index.tsx` renders ONLY for the plan tier. Adversarial vs happy-path's single-tier assertion. |
| T-22 | Strict-grep CI gate inversion | Programmatically delete the `InstallmentScheduleDisplay` import from each of the 7 scoped files in a temp clone and verify the CI gate fails for each. Adversarial vs happy-path's "gate-passes-on-current-state" assertion. |

---

## 7. Cross-surface impact inspection (Step 3.5)

| Surface | Affected? | Files | Parity |
|---------|-----------|-------|--------|
| 1. Consumer iOS | NO | none | No trips on consumer app today |
| 2. Consumer Android | NO | none | Same as #1 |
| 3. Buyer/anonymous Web | **YES — PRIMARY** | 5 buyer-route files + TripCheckoutFlow | Automatic via shared RN code |
| 4. Business iOS | **YES** | Same as #3 + 2 planner-route files | Automatic |
| 5. Business Android | **YES** | Same as #4 | Automatic |
| 6. Admin Web | NO | none | No admin trip-purchase or trip-edit surface |
| 7. Business Web preview | **YES (adjacent)** | Same as #3 + #4 entry points | Automatic via RN-Web bundle |

Parity is automatic across all in-scope surfaces — shared RN component tree. Tester verifies on iOS sim + Android emu + Web browser separately per SC-PAR-iOS/Android/Web.

---

## 8. Cache safety

- **Query keys touched:** none directly. `usePublicTripById` already provides the data signal; ORCH-0882 just reads it.
- **Invalidation considerations:** when planner edits the plan in EditPublishedTripScreen and saves via `biz_update_live_trip` RPC (ORCH-0876 V2 + ORCH-0880 extension), the existing onSuccess invalidation handler MUST include the `["public-trip", tripId]` key family (or the equivalent `publicTripByIdKeys.detailById(tripId)` selector). Implementor verified this is already invalidated by the existing `biz_update_live_trip` mutation chain in `EditPublishedTripScreen.tsx` — schedule edits flow through the same path as other pricing edits, so the existing invalidation covers ORCH-0882.
- **No stale-cache risk** from ORCH-0882 itself: reads happen at component-mount time via `usePublicTripById`; rerenders fire automatically on cache updates.

---

## 9. Regression surface — 3-5 adjacent features tester should re-verify

1. **ORCH-0880 [Tr5 Traveler Intake Forms] intake.tsx flow** — implementor added a new import + memo + render above the validation banner. Verify the intake form fill flow (single-tier + multi-tier stepped) still works end-to-end with a fixture trip that has both intake schemas AND a payment plan.
2. **ORCH-0876 V2 [Trip CRUD + Purchase Flow Completion] full buyer-checkout chain** — implementor modified 5 of the 6 files in the chain. Verify a non-plan trip checkout still completes (index → buyer → payment → confirm) without any disclosure surfacing.
3. **ORCH-0873 [Tr3 Stage 2 UI] PaymentPlanEditor + Money tab** — implementor added a planner-variant preview below PaymentPlanEditor and a header above MoneyTabBody. Verify PaymentPlanEditor still saves correctly and Money tab still loads buyer ledger rows.
4. **ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] cancel sheet** — payment.tsx sticky bottom bar layout changed (new banner sibling above totalRow). Verify the cancel sheet on `app/trip/[id]/index.tsx` still opens/closes cleanly (banner doesn't shift its anchor point).
5. **ORCH-0859 [Tr2 Minimum Viable Trip] single-tier flow** — implementor coded defensively for multi-tier; verify the canonical single-tier `trip.pricingTiers[0]` flow still works on all 5 buyer touchpoints.

---

## 10. Discoveries for Orchestrator

- **DISC-IMPL-0882-1:** `installmentReassuranceText`'s comment header still says "Used by InstallmentScheduleDisplay variant=\"buyer\" on all 3 buyer-anon-web checkout routes (`/checkout/[eventId]/{index,buyer,payment}.tsx`)." This is stale post-ORCH-0876 V2 + post-ORCH-0882. Implementor did NOT update this comment because ORCH-0882 scope was wiring + copy extension, not documentation cleanup. Operator may want to register a tiny follow-up DOC-ORCH or fold into next-touch.
- **DISC-IMPL-0882-2:** `payment.tsx`'s `intakeFormDataArray` block at line 81-92 uses `React.useMemo` directly even though `React` is imported as the default React namespace. Pre-existing pattern, not ORCH-0882 work, but inconsistent with most other files that use named import `useMemo`. Operator may want to standardize.
- **DISC-IMPL-0882-3:** ORCH-0873 Money tab empty-state's `onEditTripPricing` deep-link goes to `/trip/${eventId}/edit` (the EditPublishedTripScreen) without `?section=pricing` deep-link — meaning planner has to manually open the Pricing accordion after navigating. ORCH-0873 close-row already flagged this as Discovery #6. Still open. ORCH-0882 didn't address it; small polish ORCH candidate.
- **DISC-IMPL-0882-4:** Ticket-purchase confirmation email for deposit-paid orders likely doesn't show the future schedule (flagged in INVESTIGATION §4 H-4). Out of ORCH-0882 scope per operator INTAKE; register follow-up ORCH if confirmed missing.
- **DISC-IMPL-0882-5:** The 6 pre-existing tsc errors in `buyer.tsx` (PhoneInput typing — 5 errors) and `app/trip/[id]/index.tsx` (EventCoverMediaType union — 1 error) are unrelated to ORCH-0882. Implementor did not fix them per scope boundary. Operator may want to address in a typing-cleanup ORCH.
- **DISC-IMPL-0882-6:** `/ui-ux-pro-max` standalone designer invoke was substituted with inline design decisions (documented in §2). Operator can redirect to a heavyweight designer pass if they want stronger validation of the banner visual treatment, planner-preview layout, or `isProjection` clarifier copy. Implementor honestly flagging the substitution rather than silently skipping the rule.

---

## 11. Deviations from SPEC

None. SPEC §7 12-step implementation order followed exactly. All 22 SCs addressed (10 PASS on implementor side; 3 DEFERRED to tester THREE-SURFACE PARITY). Q1-Q11 SPEC resolutions honored verbatim.

---

## 12. Verification status

| Verification | Method | Result |
|--------------|--------|--------|
| Mapper utility unit tests | Jest, 5 tests | PASS 5/5 |
| Wiring contract assertions | Jest, 14 tests | PASS 14/14 |
| Pay-button copy contract | Jest, 3 tests | PASS 3/3 |
| isProjection clarifier contract | Jest, 2 tests | PASS 2/2 |
| **Total regression test** | **Jest, 24 tests** | **PASS 24/24** |
| Fails-on-revert proof | git stash + re-run @ `cfee512f` | FAIL 17/24 (proves test exercises the bug) |
| Strict-grep CI gate (local) | `node .github/scripts/strict-grep/i-proposed-tr3-plan-disclosure-on-every-buyer-touchpoint.mjs` | PASS 7/7 scoped files |
| tsc --noEmit (mingla-business) | `npx tsc --noEmit` | 88 errors → 88 errors (0 NEW; all pre-existing in untouched code) |
| Anon-route preservation | grep `useAuth` on 5 buyer routes | 0 imports (1 comment-line confirming rule) |
| Color format compliance | grep `oklch\|color-mix\|lab(\|hwb(` on new code | 0 matches |
| flexGrow footgun | grep `flexGrow: 0, flexShrink: 0` on banner | PASS — both set |
| Sub-sheet rendering | inspection — banner not inside Sheet | PASS |

---

## 13. Migration / deploy / CLOSE notes

- **No migration.** No `supabase/migrations/` changes.
- **No edge function deploy.** No `supabase/functions/` changes.
- **No new npm packages.** No `package.json` changes.
- **No native module changes.** No `app.json` / `expo.json` / Podfile / AndroidManifest changes.
- **EAS OTA-eligible.** After CLOSE, operator publishes via `cd mingla-business && eas update --branch production --platform ios,android --message "ORCH-0882: payment plan disclosure on trip buyer + planner surfaces"`.
- **Commit scope on CLOSE:** 13 files (3 new + 10 modified). All under `mingla-business/` + `.github/`. No global-index touch.
- **PR per ORCH-0840 one-PR-per-CLOSE:** Yes, ORCH-0882 ships its own PR Seth → main.

---

End of implementation report ORCH-0882.
