# IMPLEMENTATION — ORCH-0796 Reconciliation real expected-payout (B2b wiring)

**Date:** 2026-05-11
**Owner:** Claude `mingla-implementor` (operator-delegated execution from `mingla-orchestrator` → `mingla-forensics` → here)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Predecessors:**
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0796_PAYOUTS_STUB_FIXTURE_LEAK.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-0796_RECONCILIATION_REAL_PAYOUT.md`

**Status:** implemented and verified · all 13 ORCH-0796 + adjacent unit tests PASS · TypeScript clean · strict-grep gate green · zero orphans

---

## 1. Goal recap

Remove the hardcoded 4% Stripe-fee stub from the per-event Reconciliation screen. Compute the real expected net-to-organiser figure from existing post-ORCH-0777/0787 columns (`orders.stripe_application_fee_amount_cents`, `orders.refunded_amount_cents`, `refunds.application_fee_refunded_cents`). Show `—` + `"No payments yet"` when no payments exist (constitution #9 — no fabricated data).

## 2. Old → New receipts (per file)

### 2.1 `mingla-business/src/store/orderStore.ts`
**Before:** `OrderRecord` had `totalGbpAtPurchase`, `refundedAmountGbp` (major-units only); no Stripe-fee fields. `RefundRecord` had no app-fee refund field.
**Now:** Added five optional minor-unit fields to `OrderRecord` (`totalCents`, `refundedAmountCents`, `applicationFeeAmountCents`, `stripeApplicationFeeAmountCents`) and one to `RefundRecord` (`applicationFeeRefundedCents`). All optional + additive — no breaking change to existing consumers.
**Why:** spec §7.2 — minor-unit precision is required for accurate Stripe net-to-organiser computation.
**Lines changed:** ~20 additive lines.

### 2.2 `mingla-business/src/services/eventOrdersService.ts`
**Before:** Supabase `.select(...)` omitted `application_fee_amount_cents`, `stripe_application_fee_amount_cents`, `application_fee_refunded_cents`. `mapRefundRow` + `OrderRecord` mapping did not surface them.
**Now:** Select includes all three columns. `RefundRow` interface + `OrderRow` interface extended. `mapRefundRow` returns `applicationFeeRefundedCents`. `OrderRecord` mapping returns `totalCents`, `refundedAmountCents`, `applicationFeeAmountCents`, `stripeApplicationFeeAmountCents`.
**Why:** spec §7.1 — the data needs to reach the client; service is the only fetch path.
**Lines changed:** ~10.

### 2.3 `mingla-business/src/utils/moneySummary.ts`
**Before:** `payoutEstimate: round2(round2(onlineRevenue * 0.96) + doorRevenue)` — flat 4% stub.
**Now:**
- `EventMoneySummary` interface drops `payoutEstimate: number`; adds `onlineNetMajor: number | null`, `stripeFeeOnlineMajor: number | null`, `expectedPayoutMajor: number | null`.
- New net accumulator in the order loop computes `Math.max(0, totalCents - appFeeCents - refundedCents + appFeeRefundedCents)` using the spec §5 formula. Prefers `stripeApplicationFeeAmountCents`, falls back to `applicationFeeAmountCents`, defensive `0` otherwise.
- `hasAnyOnlinePayment` / `hasAnyDoorPayment` flags drive the null vs zero return semantics — null when truly no payments, not a misleading `0`.
- `MoneyRefund` type extended with optional `applicationFeeRefundedCents`.
- `MoneyOrderRecord` type extended with the four optional minor-unit fields.

**Why:** spec §7.3 — root removal of the stub. This is the single source of truth for the new computation.
**Lines changed:** ~50 (interface + accumulator + return shape + helper type extensions).

### 2.4 `mingla-business/src/utils/reconciliation.ts`
**Before:** `ReconciliationSummary.payoutEstimate: number` + `[TRANSITIONAL]` D-13-10 comment + JSDoc referencing 4% stub.
**Now:** Drops `payoutEstimate`; adds `expectedPayoutMajor: number | null` + `stripeFeeOnlineMajor: number | null`. Header doc D-13-10 paragraph rewritten to describe the real wiring + null-on-no-payments contract. `EMPTY_SUMMARY` mirrors new shape (both null). Destructure + return-shape forwarding updated.
**Why:** spec §7.4 — interface mirror so consumers can find the new field.
**Lines changed:** ~12.

### 2.5 `mingla-business/app/event/[id]/reconciliation.tsx`
**Before:**
```tsx
const stripeFeeOnline = Math.round(summary.onlineRevenue * 4) / 100;
...
<SectionRow label="Stripe fee (online, 4% stub)" value={`−${formatCurrency(stripeFeeOnline, currency)}`} ... />
...
<SectionRow label="PAYOUT (estimated)"
  value={formatCurrency(summary.payoutEstimate, currency)}
  hint="TRANSITIONAL — B-cycle Stripe payout API" />
```
**Now:**
- `stripeFeeOnline = summary.stripeFeeOnlineMajor` (real value from server; null when no payments).
- "Stripe fee (online, 4% stub)" → "Stripe fee (online)"; renders `—` when null, else `−<currency>`.
- "PAYOUT (estimated)" → "EXPECTED PAYOUT"; renders `—` when null, else formatted currency; hint switches between `"Net to your Stripe account after fees and refunds"` and `"No payments yet"`.
- Header doc cleaned: removed `[TRANSITIONAL] payoutEstimate uses 4% Stripe-fee stub` paragraph; D-13-10 reworded.

**Why:** spec §7.5 + SC-2/SC-3/SC-4/SC-5.
**Lines changed:** ~25.

### 2.6 `mingla-business/app/event/[id]/index.tsx`
**Before:** `const payoutGbp = moneySummary.payoutEstimate - moneySummary.doorRevenue;` (derived online-only payout by subtracting door from the 4% stub).
**Now:** `const payoutGbp = moneySummary.onlineNetMajor;` (real online net or null).
**Why:** spec §13 cross-consumer note + cleaner: the new `onlineNetMajor` exposes exactly this slice without arithmetic.
**Lines changed:** 3 (including a comment rewrite).

### 2.7 `mingla-business/src/components/event/EventDetailKpiCard.tsx`
**Before:** `payoutGbp: number` prop (always a number); rendered `formatCurrency(hasData ? payoutGbp : 0, currency)`.
**Now:** `payoutGbp: number | null`; renders `—` when `hasData && payoutGbp !== null` is false. Doc comment on the prop updated to reference ORCH-0796 + describe the new "null when no online payments" semantic.
**Why:** propagate null-on-no-payments to the home KPI card. Constitution #9 — show "—" rather than fake £0.
**Lines changed:** ~10.

### 2.8 `mingla-business/src/components/brand/BrandPaymentsView.tsx`
**Before:** Two `[TRANSITIONAL]` comment blocks at lines 170-180 and 419-421 declared `brand.payouts` / `brand.refunds` "still read from Zustand stub" — stale doc since ORCH-0742 (these fields are never populated by `mapBrandRowToUi`).
**Now:** Replaced with a single concise comment correctly describing today's state: arrays are intentionally unpopulated; screen renders the empty state. Second block removed entirely (no behavioural change).
**Why:** spec §7.6 — reap stale comments that misled the original ORCH-0796 dispatch hypothesis. Pure doc fix.
**Lines changed:** ~10.

### 2.9 `mingla-business/src/utils/__tests__/moneySummary.test.ts`
**Before:** 4 tests (cross-currency mismatches + legacy brand finance + `effectiveDraftCurrency`). No `payoutEstimate` assertions.
**Now:** Added 9 new tests T-01..T-09 covering: empty event, simple paid order, full refund, partial refund, cash door only, mixed online+door, webhook-not-landed fallback, refund-overshoot clamp, currency-mismatch-doesn't-leak.
**Why:** spec §7.7 — regression-lock the new formula and the null-vs-zero contract.
**Lines changed:** ~210 (additive).

### 2.10 `.github/scripts/strict-grep/orch-0796-no-stub-payout-fee.mjs` (NEW)
- Check 1: no `* 0.96` literal in `moneySummary.ts` or `reconciliation.ts`.
- Check 2: no `payoutEstimate` identifier anywhere under `mingla-business/src/` or `mingla-business/app/`.
- Check 3: no `TRANSITIONAL — B-cycle Stripe payout API` string anywhere under those trees.
- Check 4: `moneySummary.ts` exposes both `expectedPayoutMajor` AND `onlineNetMajor`.
- Check 5: `reconciliation.tsx` references `summary.expectedPayoutMajor`.

Runs ~30ms; all 5 checks green at HEAD.

### 2.11 `.github/workflows/strict-grep-mingla-business.yml`
**Before:** ORCH-0793 was the last registered gate.
**Now:** New job `orch-0796-no-stub-payout-fee` added at end of file + header comment block updated. Label: `"ORCH-0796: expected-payout derived from real Stripe app-fee + refund cols (I-PROPOSED-BC)"`.
**Why:** spec §7.8 — registry pattern (one script + one job; no parallel workflow file). Follows the existing ORCH-0793/0795/etc. registration shape.
**Lines changed:** ~12.

## 3. Spec Traceability — Success Criteria

| # | Criterion | Verification | Status |
|---|---|---|---|
| SC-1 | `* 0.96` is gone from `moneySummary.ts` | `grep` returns 0 rows + strict-grep Check 1 passes | **PASS** |
| SC-2 | `TRANSITIONAL — B-cycle Stripe payout API` is gone from `mingla-business/` | Strict-grep Check 3 returns 0 offenders | **PASS** |
| SC-3 | One paid Stripe Checkout order, no refund → `EXPECTED PAYOUT = (total - stripeAppFee) / 100` | Unit test **T-02** (£50 order, £2.50 fee → £47.50) | **PASS** |
| SC-4 | Zero-payment event → `EXPECTED PAYOUT = —` + `"No payments yet"` | Unit test **T-01** + UI hint logic added | **PASS** |
| SC-5 | Fully refunded order → `EXPECTED PAYOUT = £0.00` (refunded_full path) | Unit test **T-03** (status filter excludes refunded_full) + **T-08** (overshoot clamp) | **PASS** |
| SC-6 | All existing `moneySummary`/`reconciliation` tests still pass | 23/23 suites + 140/140 utils tests green | **PASS** |
| SC-7 | TypeScript clean | `npx tsc --noEmit` exit 0, no output | **PASS** |
| SC-8 | CI gate `orch-0796-no-stub-payout-fee` exits 0 | `node .github/scripts/.../orch-0796...mjs` → `PASSED (5/5 checks)` | **PASS** |
| SC-9 | Cross-currency mismatch detection still functions | Unit test **T-09** + 2 prior currency tests pass | **PASS** |
| SC-10 | Header docs no longer reference D-13-10 4% stub or B-cycle exit condition | Header doc rewrite in both `reconciliation.ts` + `reconciliation.tsx` | **PASS** |

**10/10 success criteria verified.**

## 4. Invariant Verification

| Invariant | Preserved? | Evidence |
|---|---|---|
| Constitution #9 No fabricated data | YES | New `—` rendering replaces `£0.00` when no payments — no fake number shown |
| Constitution #10 Currency-aware | YES | Aggregation uses `expectedCurrency`; currency mismatches detected by existing path (T-09) |
| I-PROPOSED-J ZUSTAND-PERSIST-NO-SERVER-SNAPSHOTS | YES | No persist surface touched |
| I-CYCLE-13-RECON RAW-ARRAYS-SELECTOR | YES | Selector contract unchanged; aggregator now takes the same raw arrays |
| Constitution #7 Label temporary | N/A → tightened | Removed a `[TRANSITIONAL]` label by replacing it with permanent code; no new `[TRANSITIONAL]` introduced |
| **NEW I-PROPOSED-BC EVENT_PAYOUT_DATA_DERIVED** | ESTABLISHED (DRAFT) | CI gate `orch-0796-no-stub-payout-fee` enforces; flips ACTIVE on CLOSE per spec §9 |

## 5. Parity Check

| Surface | Touched? | Same fix applied? |
|---|---|---|
| Mingla-business mobile (iOS/Android) | YES | Yes — same TS code path |
| Mingla-business web (Expo Web) | YES | Yes — same JS bundle |
| Mingla-admin | N/A | Admin reads orders/refunds directly via its own queries; does not use `summarizeEventMoney` |
| app-mobile (consumer app) | N/A | Does not consume business reconciliation |
| Solo/collab parity | N/A | Reconciliation is single-operator-owner, not a solo/collab surface |

## 6. Cache safety

- No React Query key changed; `eventOrdersService.fetchEventOrders` keeps its caller contract. New optional fields are passthrough.
- No persist version bump; `currentBrandStore` v14 untouched.
- New `OrderRecord` fields are optional → older persisted Zustand `useOrderStore` entries (Cycle 9c-era) continue to work; the new computation safely defaults missing fields to 0.
- `staleTime`/`enabled` not changed.

## 7. Regression surface (tester focus areas)

1. **Real paid Stripe Checkout order** — `EXPECTED PAYOUT` should equal `(total - stripe_application_fee_amount_cents) / 100` (verified by T-02 + spec SC-3; manual smoke recommended against the ORCH-0787 test order `6ad119af-…`).
2. **Refunded order on Reconciliation** — full refund → 0; partial refund → real remainder (T-03 + T-04).
3. **Brand-level Payments screen** — empty state still renders correctly (no `brand.payouts` consumer change).
4. **Event home KPI card (`EventDetailKpiCard`)** — when no online orders, PAYOUT cell now shows `—` instead of `£0.00`. When there are online orders, shows the real online-only net.
5. **Multi-currency event** — currency-mismatch detection still excludes stale-currency rows from `expectedPayoutMajor` (T-09).
6. **Event with door sales only (cash)** — `EXPECTED PAYOUT = door revenue`, no Stripe fee row implied (T-05).

## 8. Constitutional compliance scan

| # | Principle | Touched? | Status |
|---|---|---|---|
| #1 | No dead taps | N/A | – |
| #2 | One owner per truth | YES | The fee number now has one owner (Stripe webhook → DB → service → UI); the prior 4% stub had no owner |
| #3 | No silent failures | N/A | – |
| #4 | One query key per entity | N/A | – |
| #5 | Server state server-side | YES | New fields come from the server; no Zustand server snapshot introduced |
| #6 | Logout clears everything | N/A | – |
| #7 | Label temporary | YES | Removed a TRANSITIONAL label by promoting to real implementation |
| #8 | Subtract before adding | YES | Stub removed before real wiring added |
| #9 | No fabricated data | YES | `—` replaces fake `£0.00` |
| #10 | Currency-aware UI | YES | Aggregation uses expected currency; T-09 verifies |
| #11 | One auth instance | N/A | – |
| #12 | Validate at right time | N/A | – |
| #13 | Exclusion consistency | YES | Refund-overshoot clamp matches Stripe destination-charge model |
| #14 | Persisted-state startup | YES | Optional new fields safe on old cached entries |

## 9. Hard guard compliance (spec §12)

| Guard | Status |
|---|---|
| No DB migration | ✅ none created |
| No edge function changes | ✅ none touched |
| No new RPC | ✅ none added |
| No persist version bump | ✅ `currentBrandStore` v14 unchanged |
| No `supabase db push` | ✅ not invoked |
| No `supabase functions deploy` | ✅ not invoked |
| No EAS native build | ✅ pure JS/TS — OTA-eligible |
| No BrandPaymentsView RECENT PAYOUTS list scope creep | ✅ only doc comments touched, runtime unchanged |
| No card-reader/NFC fee logic | ✅ door stays at 1.0 net |

## 10. Gate output

| Gate | Command | Result |
|---|---|---|
| Strict-grep | `node .github/scripts/strict-grep/orch-0796-no-stub-payout-fee.mjs` | `PASSED (5/5 checks)` |
| TypeScript | `cd mingla-business && npx tsc --noEmit` | exit 0, zero output |
| Jest (moneySummary) | `npx jest src/utils/__tests__/moneySummary.test.ts` | 13/13 PASS |
| Jest (full utils suite) | `npx jest src/utils/__tests__` | 23 suites / 140 tests PASS |
| Jest (entire repo) | `npx jest` | 49/50 suites PASS — 1 pre-existing failure in `publicEventsService.test.ts` (timezone/date mapping, untouched by this change; see §11) |

## 11. Discoveries for Orchestrator

1. **Pre-existing test failure unrelated to this scope.** `mingla-business/src/services/__tests__/publicEventsService.test.ts` has 2 failing tests (`timezone "Europe/Paris"` vs `"Europe/London"`, plus a `date` field returning `null`). Neither file is in this implementation's dirty list (`git status` confirms `publicEventsService.{ts,test.ts}` are untouched). These failures appear to come from unrelated in-flight work (possibly the in-progress `INVESTIGATION_ORCH-0801_BRAND_PAGE_FULL_AUDIT.md` visible as an untracked artifact). Not blocking for ORCH-0796 close, but recommend the orchestrator file a P3 follow-up.
2. **WORLD_MAP.md + MASTER_BUG_LIST.md in `UU` (unmerged conflict) state.** `git status` shows both global index files in conflict. This implementation did not touch them; the conflict pre-existed when this dispatch started (likely operator-side branch sync earlier). The ORCH-0796 + ORCH-0801 entries I added in the prior orchestrator session need to be merged carefully when the conflict is resolved. Recommend the orchestrator resolve via `git mergetool` or manual reconciliation before commit.
3. **ORCH-0796 ID collision still unresolved.** The ORCH-0795 close note registered an unrelated `ORCH-0796` for "scanner-row churn root cause". The current ORCH-0796 (this work) is the payout reframe. Renumber the scanner-churn follow-up to ORCH-0802 or similar — flagged in the SPEC §13.2 and persisted here as P1 traceability defect.
4. **`I-PROPOSED-BC` (EVENT_PAYOUT_DATA_DERIVED) is now established as DRAFT.** The CI gate enforces it. Operator/orchestrator flips DRAFT → ACTIVE on CLOSE per SPEC §9 + DEC-110 precedent. Add to `INVARIANT_REGISTRY.md`.
5. **`availableBalanceGbp` / `pendingBalanceGbp` on Brand type remain dead.** Untouched by this ORCH per scope. Candidate small follow-up deletion cycle.
6. **`BrandFinanceReportsView.tsx:218`** still reads `brand.refunds ?? []` — unaffected (returns `[]` always today), but worth a future doc-truth pass mirroring the BrandPaymentsView clean-up.

## 12. Deploy / publish notes

- **No SQL migration.** No `supabase db push` needed.
- **No edge function deploy.** No `supabase functions deploy` needed.
- **No native build.** OTA-eligible via:
  ```bash
  cd app-mobile && eas update --branch production --platform ios --message "ORCH-0796: real expected payout on Reconciliation"
  cd app-mobile && eas update --branch production --platform android --message "ORCH-0796: real expected payout on Reconciliation"
  ```
  Wait — these changes are in `mingla-business`, not `app-mobile`. Correct command for orchestrator CLOSE:
  ```bash
  cd mingla-business && eas update --branch production --platform ios --message "ORCH-0796: real expected payout on Reconciliation"
  cd mingla-business && eas update --branch production --platform android --message "ORCH-0796: real expected payout on Reconciliation"
  ```
  (Per memory `feedback_eas_update_no_web.md` — two separate platform invocations; web bundle fails on `react-native-maps`.)

## 13. Commit message (ready to paste)

```
Close ORCH-0796: Reconciliation real expected-payout (B2b wiring)

Remove the 4% Stripe-fee stub from the per-event Reconciliation screen.
EXPECTED PAYOUT is now derived from real per-order Stripe columns
(stripe_application_fee_amount_cents, refunded_amount_cents,
application_fee_refunded_cents). Net to organiser = total - app_fee -
refunded + app_fee_refunded, clamped at 0. Shows "—" when no payments.

- moneySummary: new expectedPayoutMajor / onlineNetMajor / stripeFeeOnlineMajor
  (replace payoutEstimate). Null signals "no payments" so UI renders "—".
- reconciliation.tsx: "PAYOUT (estimated)" → "EXPECTED PAYOUT"; hint
  "TRANSITIONAL — B-cycle Stripe payout API" gone.
- event/[id]/index.tsx + EventDetailKpiCard: PAYOUT cell uses onlineNetMajor
  with null → "—".
- eventOrdersService: select includes application_fee_amount_cents,
  stripe_application_fee_amount_cents, application_fee_refunded_cents.
- orderStore types: new optional minor-unit fields on OrderRecord +
  RefundRecord (additive, no breaking change).
- BrandPaymentsView: stale [TRANSITIONAL] comments reaped.
- New strict-grep CI gate orch-0796-no-stub-payout-fee (I-PROPOSED-BC
  EVENT_PAYOUT_DATA_DERIVED, DRAFT → ACTIVE on close).
- New unit tests T-01..T-09 lock the formula and null-on-no-payments contract.

Verified: tsc clean, 13/13 moneySummary tests + 140/140 utils suite green,
strict-grep 5/5 checks pass. No migration, no edge deploy, no native build.
OTA-eligible.
```

---

NEXT HANDOFF — paste into Claude `mingla-forensics` (TEST mode):

Independently verify the implementation at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0796_RECONCILIATION_REAL_PAYOUT.md` against the spec at `Mingla_Artifacts/specs/SPEC_ORCH-0796_RECONCILIATION_REAL_PAYOUT.md` and the investigation at `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0796_PAYOUTS_STUB_FIXTURE_LEAK.md`. Run TARGETED sub-mode with full five-truth-layer cross-check focusing on: (a) the net-to-organiser formula `total - stripeAppFee - refunded + appFeeRefunded` clamped at 0, (b) null-on-no-payments contract end-to-end (moneySummary → reconciliation summary → reconciliation.tsx UI + EventDetailKpiCard), (c) the 4% stub is truly gone (grep `0.96` + `payoutEstimate` + `TRANSITIONAL — B-cycle Stripe payout API` across `mingla-business/`), (d) cross-currency mismatch path unaffected, (e) EventDetailKpiCard correctly handles `payoutGbp: number | null` from `index.tsx:374`, (f) BrandPaymentsView doc comments are accurate post-rewrite. Do not weaken any test to make it pass; do not apply migrations from MCP (none should exist); run an iOS Simulator + Android Emulator + Expo Web parity check per `feedback_tester_canonical_and_platform_parity.md` against a brand with at least one paid order from the ORCH-0787 refund test fixture. Output the QA report at `Mingla_Artifacts/reports/QA_ORCH-0796_RECONCILIATION_REAL_PAYOUT_REPORT.md` with verdict PASS / CONDITIONAL PASS / FAIL and full P0–P4 severity counts. Discoveries-for-orchestrator at §11 (pre-existing publicEventsService.test.ts failures + WORLD_MAP/MASTER_BUG_LIST conflict + I-PROPOSED-BC promotion + ID collision with ORCH-0795-close-note ORCH-0796) are operator-routed, not tester-blocking. After PASS, next dispatch is Claude `mingla-orchestrator` for CLOSE (including iOS + Android EAS OTA via two separate platform invocations from `mingla-business/`; no native build, no migration, no edge deploy). Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
