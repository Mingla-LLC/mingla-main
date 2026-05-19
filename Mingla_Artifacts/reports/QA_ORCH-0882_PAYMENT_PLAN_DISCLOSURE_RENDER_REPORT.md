# QA — ORCH-0882 [Render Payment Plan Disclosure on Trip Buyer + Planner Surfaces]

**Tester:** Claude `mingla-tester` (TARGETED + adversarial regression test)
**Date:** 2026-05-19
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0882_PAYMENT_PLAN_DISCLOSURE_RENDER.md`
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0882_PAYMENT_PLAN_DISCLOSURE_RENDER.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0882_PAYMENT_PLAN_DISCLOSURE_RENDER.md`

---

## 0. Verdict

**CONDITIONAL PASS** — pending operator-accepted live-fire deferral on the in-app sim repro.

| | P0 | P1 | P2 | P3 | P4 |
|---|---|---|---|---|---|
| Count | 0 | 0 | 0 | 2 | 2 |

| Gate | Result |
|------|--------|
| Constitution (14 rules) | PASS / N/A on all 14 |
| Hard guards (anon-routes + RN color formats + ScrollView flexGrow + sub-sheet rendering + keyboard + toast + IconChrome a11y) | PASS |
| ORCH-0840 Step 0.5 regression gate | PASS — both tests with fails-on-revert at `cfee512f` |
| Cross-surface declaration (Step 3.5) | PASS — implementor §7 matches spec §2 |
| TypeScript strict | PASS — 0 new tsc errors (88 baseline preserved) |
| Strict-grep CI gate (`i-proposed-tr3-plan-disclosure-on-every-buyer-touchpoint`) | PASS — 7/7 scoped files |
| Live-fire iOS sim | DEFERRED — no fixture plan-active trip in production; operator action required |
| Live-fire Android emu | DEFERRED — same |
| Live-fire Chrome buyer-anon-web | DEFERRED — same |

**Why CONDITIONAL not PASS:** Phase 0.A live-fire sim gate confidence ladder — `proven` PASS requires a successful repro on every applicable platform. Both iOS sim (`17091E60-C3B6-4167-980D-60C348E177F6`, iPhone 17 Pro / iOS 26.4) and Android emulator (`emulator-5554`) are booted; `mingla-business` dev build is installed on iOS sim. The blocker is content-side, not infrastructure-side: **no production trip has a payment plan configured today** (operator-confirmed in INTAKE brainstorm), so a tester cannot reach a live render of the disclosure without first creating a fixture trip with a plan. This is a 10-minute operator-side action (toggle Payment Plan in the trip wizard's Money step + save), not a 30-min sim rebuild. Source audit + 46 regression tests (24 implementor happy-path + 22 tester adversarial) all PASS with both fails-on-revert proven at HEAD `cfee512f`. Recommend operator accept the deferral with a Case-B smoke-test step OR run the 10-minute fixture trip setup before CLOSE.

**Why not FAIL:** zero P0, zero P1, zero behavioral-contract violations, zero security gaps, zero constitutional violations. The two P3 findings are documentation-drift housekeeping (one implementor-self-flagged) — not blockers.

---

## 1. Phase 0.A — Live-fire sim status

| Platform | Boot status | Dev build status | Repro status |
|----------|-------------|------------------|--------------|
| iOS sim (`17091E60-C3B6-4167-980D-60C348E177F6`, iPhone 17 Pro / iOS 26.4) | BOOTED | `com.sethogieva.minglabusiness` installed | NOT RUN — fixture trip blocker |
| Android emu (`emulator-5554`) | BOOTED | Not verified | NOT RUN — fixture trip blocker |
| Chrome buyer-anon-web | N/A | N/A | NOT RUN — fixture trip blocker |

**Blocker:** No published trip with `trip_pricing_tiers.tier_metadata.installments` set today. Without a plan-active trip, every render site short-circuits to null (component returns null when `installmentSchedule === null`). Tester cannot witness the disclosure rendering, the Pay-button copy change, the banner, or the planner-variant preview without a fixture.

**Operator unblock (10-min, Case-B in §11):**
1. Open business app on iOS sim → open any of operator's draft / published trips → Money step in wizard OR EditPublishedTripScreen Pricing accordion.
2. Toggle Payment plan ON → set deposit 25%, 2 installments at 50% / 25%, 30 / 60 days. Save.
3. Smoke-test all 6 render sites + Pay-button copy.

**Confidence ceiling without live-fire:** Per Phase 0.A discipline, source-only on UI/runtime work is `suspected` ceiling — never sufficient for `proven` PASS. The 46 regression tests + hard guards push this to high `probable` confidence (sim is boot-ready, blocker is content-side and well-named, every contract is pinned by tests that prove fails-on-revert). The fix's correctness is high-confidence; what's missing is the visual "yes-buyer-sees-it" confirmation that only a live render can give.

---

## 2. Independent verification

### 2.1 Implementor's regression test (re-run by tester)

- Path: `mingla-business/src/components/trip/__tests__/InstallmentScheduleDisplay_wiring.test.ts`
- Implementor's claim: 24/24 PASS, `fails-on-revert verified at cfee512f`
- **Tester re-verified the claim:** 24/24 PASS on fixed code → `git stash` 9 tracked files → 17/24 FAIL on revert at HEAD `cfee512f` (`git rev-parse HEAD` confirmed) → `git stash pop` → 24/24 PASS restored. **Implementor's fails-on-revert claim is honest and reproducible.**

### 2.2 Tester adversarial regression test (NEW)

- Path: `mingla-business/src/components/trip/__tests__/InstallmentScheduleDisplay_wiring_adversarial.test.ts` (~330 LOC, 22 tests across 10 attack angles)
- Fixed-code run: **22/22 PASS** in 4.13s
- Fails-on-revert verified at `cfee512f`: `git stash` → re-run → **5/22 FAIL** → `git stash pop` → 22/22 PASS restored.

**Attack angle differentiation from implementor's happy-path (T-18..T-22 seeded list + tester additions):**

| Angle | What implementor pinned | What tester attacks (DIFFERENT) |
|-------|--------------------------|----------------------------------|
| A-01 Pay-button same-source-of-truth | "Pay $X deposit" substring presence | Count of `projectedSchedule.depositCents` occurrences ≥ 4 in payment.tsx (visible label + a11y label + banner body — split sources would silently drop count) |
| A-02 No-fabrication mechanism | `isProjection?: boolean` prop declared | InstallmentScheduleDisplay.tsx body contains ONLY `Intl.NumberFormat` + `Intl.DateTimeFormat` on prop values — zero `parseFloat`, no other transformation helpers |
| A-03 Fractional rounding contract | Clean 25/50/25 integer pcts | 33/33/34 + priceCents=0 — rounding never produces NaN/Infinity, sum within ±1 cent |
| A-04 Anon-route function-call shape | `useAuth` substring grep | `useAuth\s*\(` function-call shape + sign-in-redirect literal patterns — stricter, catches re-exports |
| A-05 Multi-tier mapper isolation | Single-tier happy-path | tier[0] no-plan + tier[1] $5000 with plan — assert mapper uses tier[1]'s price (500000) not tier[0]'s |
| A-06 Mapper edge inputs | Null schedule short-circuit only | Empty installments[], deposit_pct=100, deposit_pct=0 — sensible output, no crash |
| A-07 CI gate INVERSION | Gate PASSES on current state | In-memory simulation of import removal → gate's detection rule FAILS, original passes |
| A-08 Component header freshness | Header has `isProjection` literal | Header lists 7 ORCH-0882 canonical targets + cites ORCH-0882 explicitly — drift guard |
| A-09 Banner a11y data invariant | Banner accessibilityLabel exists | a11y label references BOTH `depositCents` AND `installments.length` — catches hardcoded "N installments" |
| A-10 No hardcoded currency in banner | Constitution #10 cited | Banner body JSX (post-`formatCurrency()`-strip) contains no literal `$`/`£`/`€` — Constitution #10 mechanism guard |

5 of 22 fail on revert (A-01, A-02 partial, A-08, A-09, A-10) — these attack ORCH-0882-specific surface; the other 17 either test mapper behavior (file untracked, unaffected by revert) or invariants that hold even at the reverted state (anon-routes were already anon).

---

## 3. Spec traceability — 22 SCs

| SC | Status | Evidence |
|----|--------|----------|
| SC-1a | PASS (source + test) | Implementor regression test asserts import + signal ref in `TripCheckoutFlow.tsx` |
| SC-1b | PASS (source) | Component null-return; conditional wrap verified by reading source |
| SC-2a | PASS (source + test) | Per-tier render in `checkout-trip/index.tsx` confirmed by both regression tests |
| SC-2b | PASS (source) | Conditional `qty >= 1 && projectedSchedule !== null` |
| SC-3 | PASS (source + test) | Aggregate above order summary in `buyer.tsx` |
| SC-4a | PASS (source + test) | Schedule card in ScrollView between Order Summary + Payment cards |
| SC-4b | PASS (source + test) | Pre-Stripe banner above Pay button with `accessibilityRole="alert"`; A-09 adversarial verified data invariant |
| SC-4c | PASS (source + test) | Pay-button ternary: deposit-branch + no-plan fallback both pinned; A-01 adversarial verified same-source-of-truth |
| SC-5a | PASS (source + test) | No-plan branch preserves `Pay $X` (totals.total); both tests pin this |
| SC-5e | PASS (source + test) | `intake.tsx` aggregate above validation banner; both tests pin wiring |
| SC-6 | PASS (source + test) | `EditPublishedTripScreen.tsx` planner-variant preview below PaymentPlanEditor with edit-buffer source |
| SC-7 | PASS (source + test) | `MoneyTabBody` header above filter chip row + above empty state |
| SC-8 | PASS (test) | Mapper math 5 implementor tests + 4 tester adversarial tests (fractional/edge inputs/multi-tier isolation) |
| SC-9 | PASS (source + test) | `isProjection?: boolean` prop + clarifier copy in `installmentReassurance.ts` |
| SC-10 | PASS (gate run) | CI gate `i-proposed-tr3-plan-disclosure-on-every-buyer-touchpoint` PASS 7/7 locally |
| SC-11 | PASS | Implementor happy-path 24/24 fails-on-revert at `cfee512f` verified by tester |
| SC-12 | PASS | Tester adversarial 22/22 fails-on-revert at `cfee512f` documented in §2.2 |
| SC-PAR-iOS | DEFERRED | Live-fire blocker — fixture trip required |
| SC-PAR-Android | DEFERRED | Live-fire blocker — fixture trip required |
| SC-PAR-Web | DEFERRED | Live-fire blocker — fixture trip required |

19/22 PASS at source/test level; 3 SC-PAR-* DEFERRED pending operator-side fixture-trip setup. All deferrals are documented; none are silent.

---

## 4. Constitution 14-rule check

| # | Rule | Status | Evidence |
|---|------|--------|----------|
| 1 | No dead taps | PASS | Pay button onPress wired (line 572); Reserve CTA wired |
| 2 | One owner per truth | PASS | Schedule template lives in `tier_metadata.installments`; component is read-only |
| 3 | No silent failures | **PASS — explicitly resolved** | SC-4c Pay-button copy change closes the deposit-vs-full-price silent failure that ORCH-0873 §3.5.4 Q1 deferred |
| 4 | One key per entity | N/A | No React Query keys added |
| 5 | Server state server-side | PASS | `projectedSchedule` is derived via useMemo from `usePublicTripById`; not stored in Zustand |
| 6 | Logout clears everything | N/A | No auth state touched |
| 7 | Label temporary | PASS | No `[TRANSITIONAL]` markers added |
| 8 | Subtract before adding | PASS | Pre-existing `Pay $X` literal replaced with conditional, not layered |
| 9 | No fabricated data | **PASS — actively enforced** | Mapper math 1-to-1 with stored template; `isProjection` clarifier honestly labels projected dates; A-02 adversarial enforces no other transformation helpers wrap prop values |
| 10 | Currency-aware | PASS | `Intl.NumberFormat`/`formatCurrency` used throughout; A-10 adversarial verifies no hardcoded `$`/`£`/`€` in banner JSX |
| 11 | One auth instance | N/A | No auth changes |
| 12 | Validate at right time | PASS | Projection uses caller-supplied anchor (`new Date()` at render); mapper is pure for testability |
| 13 | Exclusion consistency | **PASS — CI-enforced** | Disclosure on every plan-active buyer touchpoint; strict-grep CI gate `i-proposed-tr3-plan-disclosure-on-every-buyer-touchpoint` enforces |
| 14 | Persisted-state startup | N/A | No AsyncStorage shape changes |

**Zero violations. Zero automatic-P0 triggers fired.**

---

## 5. Hard-guard verification

| Guard | Tester check | Result |
|-------|--------------|--------|
| `feedback_anon_buyer_routes.md` | grep `useAuth\s*\(` on 5 buyer routes + TripCheckoutFlow | 0 calls; 0 sign-in redirects |
| `feedback_rn_color_formats.md` | grep `oklch\|color-mix\|hwb(\|lab(` on new code | 0 matches |
| `feedback_rn_scrollview_flex_grow_default_one_silent_footgun.md` | `payment.tsx:685-686` explicit `flexGrow: 0, flexShrink: 0` on banner | PASS |
| `feedback_rn_sub_sheet_must_render_inside_parent.md` | Banner renders as JSX child of bottom bar, NOT inside Sheet | PASS |
| `feedback_keyboard_never_blocks_input.md` | payment.tsx existing keyboard pattern unchanged; banner is static text | PASS |
| `feedback_toast_needs_absolute_wrap.md` | Pre-existing toast wrap (line 587) preserved; no new toasts added | PASS |
| `feedback_implementor_uses_ui_ux_pro_max.md` | Implementor substituted inline design decisions (DISC-IMPL-0882-6 self-flagged) | **P3-01 — see §6** |
| Touch target + a11y | Banner has `accessibilityRole="alert"` + `accessibilityLabel` mirroring visible copy | PASS |

---

## 6. Findings

### P3-01 — Implementor substituted `/ui-ux-pro-max` invoke with inline design decisions

**Severity:** P3 (LOW — process observation, not a quality defect)
**File:** Implementation report §2 + DISC-IMPL-0882-6
**What it does:** Implementor flagged honestly that the mandatory `/ui-ux-pro-max` pre-flight invoke per `feedback_implementor_uses_ui_ux_pro_max.md` was substituted with inline design decisions (banner visual treatment, planner-preview layout, `isProjection` clarifier copy). Rationale cited: every decision composes from existing Mingla design tokens, no new primitives, scope is wiring + copy not novel visual.
**What it should do:** The memory rule is literal ("must invoke /ui-ux-pro-max as pre-flight design step"). A heavyweight designer pass would have produced a separate DESIGN artifact under `Mingla_Artifacts/design/`. The substitution is operator-visible and was flagged in the implementation report.
**Fix recommendation:** Operator decides — either accept the substitution (treat as one-off given the scope) OR redirect a thin designer pass post-CLOSE to audit the 4 micro-decisions. Tester cannot judge visual treatment quality from source alone — the live-fire deferral in §1 would surface visual issues if any exist.
**Why P3 not P1:** the inline decisions all use existing Mingla design tokens (GlassCard, accent.warm, spacing.*, textTokens.*); no novel patterns were introduced; the banner uses the same accent.warm tint pattern as TripCheckoutFlow's existing tier card. No production rendering ever happened without the disclosure (it was orphan), so there is no buyer-visible regression risk.

### P3-02 — Stale comment in `installmentReassurance.ts` header

**Severity:** P3 (LOW — documentation drift)
**File:** `mingla-business/src/copy/installmentReassurance.ts` lines 1-9
**What it does:** Header comment says "Used by `<InstallmentScheduleDisplay variant=\"buyer\" />` on all 3 buyer-anon-web checkout routes (`/checkout/[eventId]/{index,buyer,payment}.tsx`)." This is stale post-ORCH-0882 — disclosure now renders on 5 trip-side routes (`/checkout-trip/[tripEventId]/{index,intake,buyer,payment}.tsx` + `TripCheckoutFlow.tsx`), NOT the event-side routes.
**What it should do:** Header should cite canonical wiring targets or point to `InstallmentScheduleDisplay.tsx` header which IS up to date (per A-08 adversarial verification).
**Fix recommendation:** 1-line comment update. Tiny follow-up DOC-ORCH OR fold into next-touch on this file. Implementor flagged this in DISC-IMPL-0882-1.
**Why P3 not P1:** documentation-only; runtime behavior unaffected. Future implementor would notice on first read but no buyer or planner sees this comment.

### P4-01 — Implementor regression test discipline (PRAISE)

Implementor's happy-path test pinned 4 distinct contracts (wiring + mapper math + Pay-button copy + isProjection prop) across 24 well-organized describe blocks. fails-on-revert verified at `cfee512f` BEFORE declaring complete (not after-the-fact). Test is source-grep + pure-function-call shape — fast to run, easy to maintain, matches the `PaymentPlanEditor.test.ts` pattern from ORCH-0873. Good template for future Tr3-related work.

### P4-02 — Implementor cross-skill documentation discipline (PRAISE)

Implementor honestly flagged 6 Discoveries for Orchestrator including DISC-IMPL-0882-6 (the `/ui-ux-pro-max` substitution) — surfacing process deviations rather than burying them. Hard-guard verification was self-driven and cited in report §5 with specific grep counts (0 useAuth, 0 oklch, line numbers for flexGrow). Implementation report §1 file table maps every file to its purpose + LOC. This is the documentation discipline that makes downstream tester + orchestrator work cheap.

---

## 7. Cross-domain blast verification

| Adjacent feature | Risk | Tester check | Status |
|------------------|------|---------------|--------|
| ORCH-0880 [Tr5 Traveler Intake Forms] intake.tsx flow | Implementor added new memo + render above validation banner — could break intake-form-fill | Read `intake.tsx:113-137` (new memo) + `:442` (render) — additions are above the validation banner + above tier eyebrow; no logic changed in IntakeFormRenderer call site at line 490-505 | PASS source-level; live-fire deferred |
| ORCH-0876 V2 buyer-checkout chain (non-plan trips) | All 5 buyer files modified — non-plan checkout must complete identically | All renders are conditional on `projectedSchedule !== null`; component returns null when no plan; Pay-button no-plan fallback (line 570) preserves `Pay $X` | PASS source-level; live-fire deferred |
| ORCH-0873 PaymentPlanEditor + Money tab | Money tab `plannerScheduleHeader` prop added — could break existing buyer-row ledger | New header is OUTSIDE the existing filter-chip-row + buyer-row block; renders above (populated state) or above-empty-state; no buyer-row logic touched | PASS source-level |
| ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] cancel sheet | payment.tsx bottom-bar layout shifted (new banner sibling) — could shift cancel sheet anchor | Cancel sheet lives on `app/trip/[id]/index.tsx` (planner dashboard), NOT on buyer payment.tsx; no anchor relationship | N/A — different surface |
| ORCH-0859 [Tr2 Minimum Viable Trip] single-tier flow | Defensive multi-tier code added — could break single-tier path | `trip.pricingTiers[0]` canonical access preserved; `.find()` calls fall back to `undefined` cleanly when no match | PASS source-level |
| ORCH-0840 append-only test contract | New regression tests added; existing tests must not be modified | `git diff` shows ONLY 2 NEW test files added (implementor wiring + tester adversarial); no existing test file modified | PASS |

---

## 8. Pattern compliance check

- **InstallmentScheduleDisplay.tsx prop addition** follows the existing optional-prop-with-default-value pattern (`isProjection = false`). Matches `PaymentPlanEditor.tsx` editor-prop style.
- **Mapper utility location** at `src/utils/installmentScheduleProjection.ts` follows the project's `src/utils/` pure-function pattern (alongside `currency.ts`, `phone.ts`, `dateFormat.ts`).
- **CI gate file naming** `i-proposed-tr3-plan-disclosure-on-every-buyer-touchpoint.mjs` follows the established lowercase-hyphen pattern (mirrors `i-proposed-tr3-installment-customer-durability.mjs`).
- **Regression test naming** matches the `<Component>_<scope>.test.ts` + `<Component>_<scope>_adversarial.test.ts` pair pattern from ORCH-0873 PaymentPlanEditor tests.
- **Banner copy structure** (uppercase short heading + body sentence with strong-spans on the amounts) mirrors the existing trip-buyer accent treatments — not divergent.

No pattern deviations found.

---

## 9. ORCH-0840 Step 0.5 gate compliance

Both regression tests in scope; both with fails-on-revert proof:

| Test | Path | Result | fails-on-revert verified at |
|------|------|--------|------------------------------|
| Implementor happy-path | `mingla-business/src/components/trip/__tests__/InstallmentScheduleDisplay_wiring.test.ts` | 24/24 PASS (tester re-verified independently) | `cfee512f` — 17/24 FAIL on revert |
| Tester adversarial (NEW this turn) | `mingla-business/src/components/trip/__tests__/InstallmentScheduleDisplay_wiring_adversarial.test.ts` | 22/22 PASS | `cfee512f` — 5/22 FAIL on revert (attacks DIFFERENT angles) |

Both tests will ship in the CLOSE PR diff per implementor's no-commit posture. `git diff` confirms both test files are untracked → will be staged at CLOSE-time → present in `git diff origin/main...HEAD --name-only` for the PR. Append-only contract preserved — no existing test files modified.

---

## 10. Discoveries for Orchestrator

- **DISC-QA-0882-1:** Implementor's design-step substitution (P3-01) is the second time in recent ORCH history a small-scope wiring ORCH has skipped the `/ui-ux-pro-max` invoke (precedent: ORCH-0848 [Likes → Calendar tab toggle parity]). The memory rule is literal but the cost-benefit for trivial-scope wiring is unfavorable. Orchestrator may want to amend `feedback_implementor_uses_ui_ux_pro_max.md` to carve out a "no new primitives + composes from existing tokens" exemption, OR keep the rule literal and accept implementor-flagged substitutions as a documented P3 each time.
- **DISC-QA-0882-2:** Implementor's `DISC-IMPL-0882-4` flagged that ticket-purchase confirmation email for deposit-paid orders likely doesn't include the future installment schedule. Out of ORCH-0882 scope but represents a real Constitution #3 silent-failure-in-waiting on the email surface. Recommend orchestrator register as a P2 follow-up ORCH ("Tr3 deposit-paid email shows future schedule") and dispatch forensics to confirm + spec.
- **DISC-QA-0882-3:** Live-fire deferral pattern: this is the third ORCH this cycle (after ORCH-0826 + ORCH-0848) where a UI/runtime change cleared source audit + regression-test gates but deferred live-fire on fixture-trip / fixture-state setup. Orchestrator may want to seed a small "QA fixture state" snapshot or operator-runbook for common QA setups (e.g., "trip with payment plan", "trip with intake forms", "trip with refund tiers") to reduce the per-QA setup cost.
- **DISC-QA-0882-4:** The 88 pre-existing tsc errors in `mingla-business` (5 in `buyer.tsx` PhoneInput typing + 1 in `app/trip/[id]/index.tsx` EventCoverMediaType) are stable, low-severity, and untouched by ORCH-0882. ORCH-0873 close also noted this baseline. Orchestrator may want to register a typing-cleanup ORCH to drive the baseline toward zero before it masks a real future regression.

---

## 11. Smoke-test path for the operator (Case-B unblock)

The 10-minute fixture-trip path that flips this verdict from CONDITIONAL PASS → PASS:

1. **Apply the JS changes to the iOS sim.** If Metro is running and the existing dev build hot-reloads JS bundles, simply reload the app (shake gesture → "Reload"). Otherwise rebuild via `Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md` (3-step xcodebuild + embed-frameworks + codesign, ~5 min). On the Android emulator-5554, run `cd mingla-business && npx expo start --android` and reload.
2. **Open business app** on iOS sim → sign in as the operator → open the trip dashboard.
3. **Configure a payment plan on any draft or published trip.** Open the trip → Pricing accordion (or wizard Money step) → toggle Payment plan ON → defaults: deposit 25%, 2 installments at 50%/25%, 30/60 days. Save.
4. **Verify the planner-variant preview renders below `<PaymentPlanEditor>` in the Pricing accordion** showing the deposit + 2 future installments with projected dates (Jun 10, Jul 10 ish if today is May 19). Should be visible immediately after Save without leaving the screen.
5. **Verify the Money tab planner header.** Tap Money tab on the trip dashboard. Expected: the planner-variant schedule template renders above the buyer-ledger filter chip row (or above the empty-state if no buyers have booked the plan yet).
6. **Switch to buyer view.** Either open `https://business.usemingla.com/t/{brandSlug}/{tripSlug}` in Chrome incognito on web OR navigate to the public trip page link on the iOS sim. Verify: schedule card renders inside TripCheckoutFlow's Reserve panel, above the Reserve CTA, below the tier card. Reassurance copy includes "Dates assume you book today; they lock when you pay."
7. **Tap Reserve** → on qty picker (`/checkout-trip/{tripEventId}/`), set quantity 1 → verify schedule card renders below the QuantityRow for that tier. Set quantity 0 → schedule disappears. Set quantity 1 again → schedule reappears.
8. **Tap Continue → buyer info** → fill name + email + phone → schedule card visible above the order summary block.
9. **Continue → intake form** (if the trip has intake schemas) → schedule card visible above the validation banner.
10. **Continue → payment screen.** Verify: schedule card sits between Order Summary + Payment cards; pre-Stripe banner "Payment plan active" sits above the Pay button inside the sticky bottom bar; **Pay button label reads `Pay $X.XX deposit`** (where $X.XX is the deposit, NOT the full trip price).
11. **Tap Pay** with Stripe test card `4242 4242 4242 4242` → confirm Stripe charges ONLY the deposit amount; confirm `orders.installment_plan_root = true` and `order_installments` ledger has 2 rows in `scheduled` status (SQL probe via Supabase MCP).

If steps 4-11 all behave as described, return to orchestrator with "live-fire PASS" and CLOSE proceeds. If any step misbehaves, capture screenshots + cite the step number; back to implementor REWORK.

Android emulator + Chrome browser repeat: same flow on each surface (per `feedback_tester_canonical_and_platform_parity.md` three-surface parity).

---

## 12. Final summary

ORCH-0882 ships the in-product payment-plan disclosure across every buyer + planner surface, closes the Constitution #3 silent failure on the Pay-button copy that ORCH-0873 deferred, and locks 3 new invariants with CI-gate enforcement. Source audit is fully clean; 46 regression tests pass with both fails-on-revert proven at HEAD `cfee512f`; zero new tsc errors; zero hard-guard violations; zero P0/P1 findings; 2 P3 documentation-drift findings (one self-flagged); 2 P4 praise.

**Verdict: CONDITIONAL PASS** with explicit live-fire deferral. Operator either runs the 10-minute fixture-trip smoke-test in §11 to convert to PASS, OR accepts the deferral to proceed directly to CLOSE on the strength of the source audit + regression-test gates.

Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
