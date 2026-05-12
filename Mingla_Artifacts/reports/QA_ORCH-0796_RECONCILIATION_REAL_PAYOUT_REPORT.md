# QA — ORCH-0796 Reconciliation real expected-payout (TARGETED)

**Date:** 2026-05-11
**Owner:** Claude `mingla-tester` (operator-delegated from canonical TEST owner `mingla-forensics`)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Mode:** TARGETED
**Predecessors:**
- `Mingla_Artifacts/specs/SPEC_ORCH-0796_RECONCILIATION_REAL_PAYOUT.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0796_RECONCILIATION_REAL_PAYOUT.md`
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0796_PAYOUTS_STUB_FIXTURE_LEAK.md`

---

## Verdict: **PASS**

- **P0:** 0
- **P1:** 0
- **P2:** 0
- **P3:** 2 (operator-facing observations; not blocking)
- **P4:** 3 (commendations)

Pre-merge readiness: green at the code layer. **Operator-owned platform-smoke step required for final CLOSE** (see §10) — change is pure JS/TS so risk of platform divergence is essentially zero, but the standing parity rule (`feedback_tester_canonical_and_platform_parity.md`) makes the operator's three-platform smoke a procedural requirement, not a code-quality concern.

---

## 1. Scope verified

| Layer | Touched in implementation | Verified by tester |
|---|---|---|
| DB / migrations / RLS | No | N/A (correctly out of scope per spec §12) |
| Edge functions | No | N/A |
| Service (`eventOrdersService.ts`) | Yes — added 3 columns to select + 4 fields to mapping | Read file end-to-end, confirmed select list + mapping |
| Types (`orderStore.ts`, `EventDetailKpiCardProps`) | Yes — 5 optional additions | Read interfaces; all additive, no breakage |
| Aggregator (`moneySummary.ts`, `reconciliation.ts`) | Yes — formula replaced + interface rename | Re-derived formula against spec §5; matches |
| UI (`reconciliation.tsx`, `EventDetailKpiCard.tsx`, `BrandPaymentsView.tsx`) | Yes | Read all render branches |
| Tests | Yes — 9 unit tests added | Re-ran independently; PASS |
| CI gate | Yes — strict-grep `orch-0796-no-stub-payout-fee.mjs` | Re-ran independently; PASS |

## 2. Independent gates (re-run, not trusting implementor's claims)

| Gate | Command | Result |
|---|---|---|
| Strict-grep ORCH-0796 | `node .github/scripts/strict-grep/orch-0796-no-stub-payout-fee.mjs` | **PASSED (5/5 checks)** |
| TypeScript | `cd mingla-business && npx tsc --noEmit` | **exit 0, zero output** |
| Jest implementor's tests | `npx jest src/utils/__tests__/moneySummary.test.ts` | **13/13 PASS** (4 prior + 9 new T-01..T-09) |
| Jest tester's independent tests | `npx jest src/utils/__tests__/orch0796_independent.test.ts` | **5/5 PASS** (INDEP-1 through INDEP-5) |
| Manual orphan sweep | `grep -rn "0\.96\|payoutEstimate\|TRANSITIONAL — B-cycle Stripe payout API" mingla-business/src mingla-business/app` | **0 orphan references** (only matches are inside the gate's own banned-pattern strings) |

## 3. Independent tests added (tester-contributed)

`mingla-business/src/utils/__tests__/orch0796_independent.test.ts` — 5 edge-case scenarios the implementor's tests didn't cover. All PASS at HEAD:

| # | Scenario | Expected | Result |
|---|---|---|---|
| INDEP-1 | Mixed paid + fully-refunded orders | Only paid order contributes; net = £47.50 from the one paid £50 order with £2.50 fee | PASS |
| INDEP-2 | Cancelled order alongside paid | Cancelled excluded; net = paid order only | PASS |
| INDEP-3 | Zero app-fee paid order (free/comp via Stripe) | net = total, fee = 0 | PASS |
| INDEP-4 | Door + currency-mismatched online | expectedPayout = door only; onlineNet null | PASS |
| INDEP-5 | Two paid orders, one with partial refund (with app-fee add-back) | Net = sum, fee = retained portion | PASS |

These tests are now part of the regression surface. Recommend the orchestrator keep them in the final commit (they're CI-runnable; no operator action needed to retain).

## 4. Six dispatch focus areas — independent verification

### (a) Net-to-organiser formula correctness — VERIFIED

Read `moneySummary.ts:184-206` end-to-end. Formula evaluates to:
```
net = Math.max(0, totalCents - appFeeCents - refundedCents + appFeeRefundedCents)
```
which exactly matches spec §5. Fallback chain on `appFeeCents` (`stripeApplicationFeeAmountCents ?? applicationFeeAmountCents ?? 0`) is correct and pre-webhook safe. The `Math.max(0, ...)` clamp guards refund-overshoot per T-08. The `isRevenueLive` filter (paid + refunded_partial only) correctly excludes cancelled and refunded_full orders, verified by INDEP-1 + INDEP-2.

### (b) Null-on-no-payments contract end-to-end — VERIFIED

Traced from source to render:
1. `moneySummary.ts:215-220` — null returned when `!hasAnyOnlinePayment && !hasAnyDoorPayment`
2. `reconciliation.ts:382-383` — passes `expectedPayoutMajor` + `stripeFeeOnlineMajor` through unchanged
3. `reconciliation.tsx:556-569` — explicit null check on each render path; UI shows `—` + `"No payments yet"` when null, formatted currency + `"Net to your Stripe account after fees and refunds"` otherwise
4. `EventDetailKpiCard.tsx:55-58` — explicit null check; renders `—` when `hasData && payoutGbp !== null` is false

T-01 covers the moneySummary-layer null case. The UI rendering paths are read-verified (no UI test, but the conditional logic is trivial and the `formatCurrency` call only fires when non-null, eliminating any risk of `formatCurrency(null)` evaluating to "£NaN").

### (c) 4% stub fully gone — VERIFIED

Three independent sweeps:
- Strict-grep gate `orch-0796-no-stub-payout-fee.mjs` Checks 1, 2, 3 — all PASS
- Manual grep `* 0\.96` across `mingla-business/` — zero results outside the gate's own banned-pattern string
- Manual grep `payoutEstimate` across `mingla-business/` — zero results outside the gate's own banned-pattern string
- Manual grep `TRANSITIONAL — B-cycle Stripe payout API` across `mingla-business/` — zero results

The stub is truly gone.

### (d) Cross-currency mismatch path unaffected — VERIFIED

Read `moneySummary.ts:166-177` — the mismatch `continue` happens BEFORE the new net accumulator block at lines 184-206. Currency-mismatched orders correctly skip both revenue AND net accumulation. T-09 (implementor) + INDEP-4 (tester) both cover this. Mismatch detection still functions; revenueByMethod stays clean.

### (e) `EventDetailKpiCard` handles `payoutGbp: number | null` — VERIFIED

Read `event/[id]/index.tsx:374` — `const payoutGbp = moneySummary.onlineNetMajor;` (the new `number | null` from `EventMoneySummary`).
Read `EventDetailKpiCard.tsx:55-58` — `hasData && payoutGbp !== null ? formatCurrency(payoutGbp, currency) : "—"`.

Trace coupling: `hasData = revenueGbp > 0` where `revenueGbp = moneySummary.onlineRevenue`. Whenever `onlineRevenue > 0`, the order loop must have reached the `onlineRevenue += live` increment at line 178 — which is inside the same currency-match branch where `hasAnyOnlinePayment = true` is set at line 185. So `onlineRevenue > 0` ⇒ `onlineNetMajor !== null`. The dual-null guard is correctly composed; no `formatCurrency(null)` risk exists.

### (f) BrandPaymentsView doc comments accurate post-rewrite — VERIFIED

Read replacement comment at the new location: `"\`brand.payouts\` and \`brand.refunds\` are intentionally unpopulated by mapBrandRowToUi today (ORCH-0742 collapsed the persist payload to currentBrandId only). This screen renders the empty state."`. Cross-checked against `brandMapping.ts:190-241` — confirmed `mapBrandRowToUi` does not write `payouts` or `refunds`, so the doc is accurate. Runtime behavior of `BrandPaymentsView` unchanged (still empty-state render).

## 5. Constitutional compliance (14 rules)

| # | Rule | Status | Evidence |
|---|---|---|---|
| 1 | No dead taps | N/A | No new interactive elements |
| 2 | One owner per truth | **PASS** | Stripe webhook → DB column → service mapping → moneySummary aggregator → UI. Single ownership chain; 4% stub had no owner |
| 3 | No silent failures | **PASS** | `Math.max(0, ...)` clamp is intentional (Stripe destination-charge edge case documented in T-08) and tested. Currency mismatches surface via existing `mismatches[]` path |
| 4 | One key per entity | N/A | No new React Query keys |
| 5 | Server state server-side | **PASS** | New fields fetched via React Query; no Zustand server snapshot introduced |
| 6 | Logout clears everything | N/A | No new persisted state |
| 7 | Label temporary | **PASS** | Removed a `[TRANSITIONAL]` label by promoting to permanent code; no new `[TRANSITIONAL]` introduced |
| 8 | Subtract before adding | **PASS** | 4% stub formula was removed before real wiring was added (single edit replaced the return shape) |
| 9 | No fabricated data | **PASS** | `—` replaces fake `£0.00` when no payments exist. EXPECTED PAYOUT label + hint subtitle are both honest |
| 10 | Currency-aware UI | **PASS** | T-09 + INDEP-4 verify currency-mismatch path preserved; `expectedCurrency` flows through aggregator |
| 11 | One auth instance | N/A | No auth changes |
| 12 | Validate at right time | N/A | No datetime logic |
| 13 | Exclusion consistency | **PASS** | Same `isRevenueLive` filter (paid + refunded_partial) used for both `onlineRevenue` accumulation AND net-to-organiser accumulation; mirrors the revenue inclusion rule. INDEP-1 + INDEP-2 verify consistent exclusion of refunded_full + cancelled |
| 14 | Persisted-state startup | **PASS** | New fields on `OrderRecord` / `RefundRecord` are optional; older persisted Zustand entries (Cycle 9c era) continue to work via the fallback chain in `moneySummary.ts:186-195` |

**Zero violations.** Zero automatic-P0 triggers.

## 6. Findings

### P0 — CRITICAL: 0

None.

### P1 — HIGH: 0

None.

### P2 — MEDIUM: 0

None.

### P3 — LOW: 2

**P3-1 — Refunded_full-only event renders "No payments yet" hint, which is technically inaccurate.**
- **File:** `mingla-business/src/utils/moneySummary.ts:215-220` (the `hasAnyOnlinePayment` flag)
- **Behavior:** An event whose ONLY online activity is one fully-refunded order shows `EXPECTED PAYOUT: —` + `"No payments yet"`. Technically a payment DID happen, it was just fully refunded. The honest framing would be `EXPECTED PAYOUT: £0.00` + something like `"All payments refunded"` or `"Refunded in full"`.
- **Why not P2:** the current behavior is consistent with constitution #9 (no fabricated data — neither "£0.00 expected payout because it nets to zero" nor "fake history") and matches T-03 explicitly. A refunded_full order is functionally equivalent to no payment for the organiser's net pocket. The "No payments yet" hint is slightly misleading in this edge case but not user-harmful.
- **Recommendation:** P3 follow-up to expose a `hasAnyRefundedFullOrder` flag and switch the hint when truthy. Defer to a future cycle; not in ORCH-0796 scope.

**P3-2 — `EventDetailKpiCard` accepts `payoutGbp: number | null` but the prop label change is only documented in the JSDoc, not enforced by TS at all consumers.**
- **File:** `mingla-business/src/components/event/EventDetailKpiCard.tsx:28`
- **Behavior:** The prop is `number | null`. The one caller at `app/event/[id]/index.tsx:692` correctly passes `payoutGbp` (which is now `moneySummary.onlineNetMajor: number | null`). Verified.
- **Why P3:** This is a TS-level concern about future regressions if a new caller passes a non-null number from a non-moneySummary source. Today, `EventDetailKpiCard` has exactly one caller and the contract is honored. tsc catches any breaking change.
- **Recommendation:** None today. The TS type already protects the contract.

### P4 — NOTE: 3 (commendations)

**P4-1 — Excellent fallback chain on `appFeeCents`.**
The `stripeApplicationFeeAmountCents ?? applicationFeeAmountCents ?? 0` chain at `moneySummary.ts:191-193` handles the brief webhook-not-landed window correctly. T-07 documents the rationale. This is the right design — implementor caught the timing edge case the spec only mentioned in passing at §13.4.

**P4-2 — Clean separation of `onlineNetMajor` (for KPI card) vs `expectedPayoutMajor` (for Reconciliation total).**
Implementor noticed the spec didn't enumerate the `event/[id]/index.tsx:374` cross-consumer and proactively exposed both fields rather than letting consumers do their own arithmetic. Result: `EventDetailKpiCard` now reads `onlineNetMajor` directly instead of `payoutEstimate - doorRevenue` arithmetic. Net wiring is cleaner and harder to misuse.

**P4-3 — The CI gate enforces three negative invariants AND two positive invariants in one script.**
`orch-0796-no-stub-payout-fee.mjs` Checks 1+2+3 (negative: banned literals + identifier + string) and Checks 4+5 (positive: required identifiers + UI binding). Five-check coverage is appropriately tight; any future implementor trying to "just put back the 4% stub" gets caught by Check 1, anyone removing the rename gets caught by Checks 4 or 5.

## 7. Behavioral contract verification

| Contract | Where defined | Verified |
|---|---|---|
| Net-to-organiser formula | SPEC §5 | YES — exactly matches `moneySummary.ts:200-203` |
| Null-on-no-payments | SPEC §6 (empty-event rule) | YES — `hasAnyOnlinePayment` + `hasAnyDoorPayment` flags drive null vs number |
| Math.max(0, ...) clamp | SPEC §5 rationale paragraph | YES — `moneySummary.ts:203` + T-08 regression test |
| Door sales contribute at 1.0 (cash assumed free) | SPEC §6 | YES — door loop unchanged; cash-only assumption mirrored at `moneySummary.ts:209-227` |
| Currency mismatch detection preserved | SPEC §9 (constitution #10 preservation) | YES — line 166-177 `continue` short-circuits before net accumulation |
| `EXPECTED PAYOUT` label + dynamic hint | SPEC §7.5 | YES — `reconciliation.tsx:556-569` |
| "Stripe fee (online, 4% stub)" → "Stripe fee (online)" relabel | SPEC §7.5 | YES — `reconciliation.tsx:547` |
| Stale `[TRANSITIONAL]` comments removed from BrandPaymentsView | SPEC §7.6 | YES — re-read both blocks; replacement is concise and accurate |

## 8. Cross-domain impact verification

| Surface | Affected? | How | Verified |
|---|---|---|---|
| `mingla-business` mobile (iOS/Android) | YES | TS code path | code-read |
| `mingla-business` web (Expo Web) | YES | same JS bundle | code-read |
| `mingla-admin` | NO | uses own Supabase queries; doesn't call `summarizeEventMoney` | grep confirmed no admin consumer |
| `app-mobile` (consumer app) | NO | doesn't consume business reconciliation | grep confirmed |
| `supabase/functions/` | NO | no edge function references `payoutEstimate` or `moneySummary` | grep confirmed |
| Per-event Reconciliation screen | YES | primary surface | re-read end-to-end |
| Event detail PAYOUT KPI card | YES | secondary surface | re-read |
| BrandPaymentsView | YES (doc-only) | comment reaping; runtime unchanged | re-read |
| BrandFinanceReportsView | NO behavior change | reads `brand.refunds ?? []` which is always `[]`; unaffected | code-read |
| Order/refund mutations (`refund-order`, `cancel-order` edge fns) | NO | RPCs unchanged | not touched |
| Strict-grep CI gates | YES (new gate added) | registered in workflow | grep + workflow file confirmed |

No cross-domain breakage detected.

## 9. Pre-existing failures (not introduced by ORCH-0796)

`mingla-business/src/services/__tests__/publicEventsService.test.ts` has 2 failing tests:
- "public event view mapper" failures asserting `timezone === "Europe/Paris"` (received `"Europe/London"`) and `date === "2026-05-08"` (received `null`).

Verified pre-existing:
- `publicEventsService.{ts,test.ts}` last touched in commit `0e64b145` ("Close ORCH-0792…", 2026-05-11) — BEFORE this dispatch.
- Neither file appears in this implementation's `git status --short` dirty list.
- The failures appear to come from unrelated in-flight work, possibly the untracked `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0801_BRAND_PAGE_FULL_AUDIT.md`.

**Not blocking for ORCH-0796 close.** Filed as a P3 follow-up for the orchestrator to register a separate ORCH against `publicEventsService`.

## 10. Platform parity status

Per `feedback_tester_canonical_and_platform_parity.md` (codified 2026-05-10), tester MUST exercise iOS Simulator + Android Emulator + Web Browser parity, OR ask operator for unblock with a specific actionable request.

**This Claude tester session does not have iOS Simulator / Android Emulator / Expo Web browser access** (pure shell environment).

**Operator-action requested before final CLOSE:**

The ORCH-0796 change is **pure JS/TS** (no native modules, no platform-specific code, no maps / push / camera / haptics interaction). The same Hermes-compiled JS bundle runs on iOS, Android, and Expo Web. The risk of platform divergence on a formula-only change is essentially zero — but the operator's standing parity rule still requires the smoke. Specifically:

1. **iOS Simulator:** open `mingla-business` on iPhone 17 Pro, navigate to any event with at least one paid Stripe Checkout order (e.g., the ORCH-0787 test order `6ad119af-…` on event `09b4ece6-…` or `b1ab659e-…`), tap into Reconciliation → confirm the PAYOUT (now EXPECTED PAYOUT) row shows the real net (not `0.96 × revenue`), the Stripe fee row shows the real fee amount, and the hint subtitle reads `"Net to your Stripe account after fees and refunds"` (not `"TRANSITIONAL — B-cycle Stripe payout API"`).
2. **Android Emulator:** repeat the same smoke on Pixel 8 Pro.
3. **Expo Web / `business.usemingla.com`:** repeat the same smoke in Chrome desktop.
4. **Empty-event smoke (any one platform):** open a brand with zero paid orders, navigate to any event's Reconciliation → confirm EXPECTED PAYOUT row shows `—` with hint `"No payments yet"`.

All four smokes are <2 minutes each. None require auth state beyond a standard logged-in organiser session.

If all four pass: PASS verdict stands and CLOSE may proceed. If any diverge: re-dispatch to implementor for rework.

Because the risk is mathematically near-zero (pure JS), the orchestrator MAY choose to mark this as CONDITIONAL PASS pending the operator's smoke if blocking CLOSE on the platform smoke is impractical. That call is the orchestrator's per the standing protocol — this report supplies the evidence needed to make it.

## 11. Discoveries for Orchestrator

1. **Pre-existing publicEventsService test failures.** 2 P3 failures in `publicEventsService.test.ts` (timezone + date mapping) — unrelated to ORCH-0796, present at HEAD before this dispatch. Recommend orchestrator file a separate ORCH against `publicEventsService` once the in-flight ORCH-0801 brand-page audit completes.
2. **`WORLD_MAP.md` + `MASTER_BUG_LIST.md` in `UU` merge-conflict state.** `git status --short` shows both global index files unmerged. Not introduced by ORCH-0796. Orchestrator must resolve via `git mergetool` or manual reconciliation before CLOSE commit; the ORCH-0796 + ORCH-0801 entries added in earlier orchestrator sessions need merging carefully.
3. **ORCH-0796 ID collision still unresolved.** The ORCH-0795 close note registered an unrelated `ORCH-0796` for scanner-row churn root cause. Both refer to the same ID. Recommend renumbering the scanner-churn follow-up to ORCH-0802 (next free slot after the in-flight ORCH-0801).
4. **`I-PROPOSED-BC` (EVENT_PAYOUT_DATA_DERIVED) is now DRAFT.** The CI gate `orch-0796-no-stub-payout-fee` enforces it. Orchestrator flips DRAFT → ACTIVE on CLOSE per SPEC §9 + DEC-110 precedent. Add invariant entry to `Mingla_Artifacts/INVARIANT_REGISTRY.md`.
5. **`availableBalanceGbp` / `pendingBalanceGbp` on Brand type remain dead.** Marked deprecated in `types/brand.ts:246-250`; zero remaining readers. Candidate small follow-up deletion cycle.
6. **Tester-contributed regression test file kept.** `mingla-business/src/utils/__tests__/orch0796_independent.test.ts` (5 tests, INDEP-1 to INDEP-5) is part of this dispatch's dirty state. It covers edge cases the implementor missed (mixed paid + refunded_full, cancelled-alongside-paid, zero-fee paid, currency-mismatched + door, multi-order with refunds). Recommend orchestrator keep these in the final commit — they're CI-runnable today (jest auto-discovers `__tests__/`); no extra wiring needed.

## 12. Stuck-in-loop tracking

This is the **first** TEST cycle for ORCH-0796 (PASS on first dispatch). Retest cycles: **0/2**. No escalation needed.

## 13. Hard guard compliance check

Re-verified all 9 hard guards from SPEC §12:

| Guard | Verified |
|---|---|
| No DB migration | ✓ `git status` shows zero `.sql` files added |
| No edge function changes | ✓ `git status` shows zero `supabase/functions/` changes |
| No new RPC | ✓ no RPC names added |
| No persist version bump | ✓ `currentBrandStore.ts` v14 unchanged |
| No `supabase db push` | ✓ no DB-push trace |
| No `supabase functions deploy` | ✓ no function-deploy trace |
| No EAS native build | ✓ pure JS/TS — OTA-eligible |
| No BrandPaymentsView RECENT PAYOUTS list scope creep | ✓ only doc comments touched; render code unchanged |
| No card-reader / NFC fee logic | ✓ door loop untouched at the 1.0 multiplier |

**Implementation stayed within scope.** Zero unrequested expansions.

---

NEXT HANDOFF — paste into Claude `mingla-orchestrator`:

ORCH-0796 (Reconciliation real expected-payout / B2b wiring) passed independent QA at `Mingla_Artifacts/reports/QA_ORCH-0796_RECONCILIATION_REAL_PAYOUT_REPORT.md` with verdict **PASS**, zero P0/P1/P2, two P3 (refunded_full-only event hint nuance + EventDetailKpiCard caller-contract note — both non-blocking), three P4 commendations, and all 14 constitution rules clean. Tester independently re-ran TypeScript (0 errors), the strict-grep gate `orch-0796-no-stub-payout-fee` (5/5 checks), the 13 implementor-authored tests (T-01..T-09 plus 4 prior), and added 5 tester-contributed regression tests (INDEP-1..INDEP-5) in `mingla-business/src/utils/__tests__/orch0796_independent.test.ts` — all 5 PASS. Pre-existing `publicEventsService.test.ts` failures are unrelated and pre-date this dispatch. CLOSE prerequisites: (a) operator smoke on iOS + Android + Expo Web per QA §10 (low-risk pure-JS change — orchestrator may treat as CONDITIONAL PASS pending operator smoke), (b) resolve `WORLD_MAP.md` + `MASTER_BUG_LIST.md` `UU` merge conflicts before commit, (c) renumber the ORCH-0795-close-note ORCH-0796 ID collision (scanner-row churn) to ORCH-0802, (d) promote `I-PROPOSED-BC EVENT_PAYOUT_DATA_DERIVED` DRAFT → ACTIVE in `Mingla_Artifacts/INVARIANT_REGISTRY.md`, (e) commit using the message in `IMPLEMENTATION_ORCH-0796…REPORT.md` §13, (f) `eas update --branch production --platform ios` then `--platform android` from `mingla-business/` per memory `feedback_eas_update_no_web.md`. Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
