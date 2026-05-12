# INVESTIGATION — ORCH-0796 Payout-line "old data" report (REFRAMED)

**Date:** 2026-05-11
**Owner:** Claude `mingla-forensics` (INVESTIGATE mode, operator-delegated execution)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Confidence:** HIGH

---

## 1. Symptom Summary

**Operator report:** "is reconciliation fully done? if yes, why does under the payout line, i still see old data: 'tarnsactional b-cycle..'"

**Expected:** "Reconciliation" is fully shipped; the payout figure on the Reconciliation screen reflects real Stripe-derived payout truth, not a transitional placeholder.

**Actual:** On the per-event Reconciliation screen (`mingla-business/app/event/[id]/reconciliation.tsx`), the **PAYOUT (estimated)** KPI row carries the literal subtitle hint `"TRANSITIONAL — B-cycle Stripe payout API"` and computes its value from a hardcoded 4% Stripe-fee stub formula (`onlineRevenue * 0.96 + doorRevenue`). The number is a model approximation, not a real Stripe payout.

**Why the operator phrased it "tarnsactional b-cycle":** they were reading the literal on-screen hint subtitle (`TRANSITIONAL — B-cycle Stripe payout API`) under the PAYOUT KPI on the Reconciliation page, recognised it as a B-cycle placeholder, and asked whether reconciliation was supposed to have finished that work.

---

## 2. Original dispatch hypothesis vs. truth

The dispatch prompt (`prompts/INVESTIGATOR_ORCH-0796_PAYOUTS_STUB_FIXTURE_LEAK.md`) suspected the issue was in **`mingla-business/src/components/brand/BrandPaymentsView.tsx`** — that the Zustand persist store was leaking stub `brand.payouts` / `brand.refunds` server-record arrays into the brand-level Payments screen.

**That hypothesis is false.** Six-field disproof below.

### 2.1 Disproof of the original hypothesis

| Field | Evidence |
|---|---|
| File + line | `mingla-business/src/store/currentBrandStore.ts:127-151` |
| Exact code | `name: "mingla-business.currentBrand.v14"`, `partialize: (state) => ({ currentBrandId: state.currentBrandId })`, `version: 14`, `migrate` strips `currentBrand` snapshot at v13→v14 |
| What it does | Persists **only** `currentBrandId: string \| null`; full Brand object is never written to AsyncStorage |
| What ORCH-0796 dispatch claimed | "Zustand persist payload still includes `payouts: BrandPayout[]` + `refunds: BrandRefund[]` server-record arrays" |
| Causal chain | ORCH-0742 (closed 2026-05-06) already enforced I-PROPOSED-J ZUSTAND-PERSIST-NO-SERVER-SNAPSHOTS by collapsing the persist payload to just the ID. The migrator at v13→v14 specifically strips the legacy `currentBrand` snapshot if present. |
| Verification step | `git log -1 --follow mingla-business/src/store/currentBrandStore.ts` shows ORCH-0742 commit; `partialize` block (lines 130-132) confirmed by direct read. |

### 2.2 Where do `brand.payouts` / `brand.refunds` actually come from?

| Layer | Reality |
|---|---|
| **Type** | `mingla-business/src/types/brand.ts:261-266` — `payouts?: BrandPayout[]` + `refunds?: BrandRefund[]` (optional on Brand) |
| **Mapper** | `mingla-business/src/services/brandMapping.ts:190-241` — `mapBrandRowToUi()` **never assigns** `payouts`, `refunds`, `lastPayoutAt`, `availableBalanceGbp`, or `pendingBalanceGbp`. They remain `undefined` on every Brand returned by `useBrand` / `useBrands`. |
| **Service** | `mingla-business/src/services/brandsService.ts` — no fetch of payouts/refunds; just `select * from brands` + `mapBrandRowToUi`. |
| **Patch builder** | `mingla-business/src/utils/brandPatch.ts:76-84` explicitly enumerates these as **server-derived, skipped** in update patches. |
| **Persist payload** | None — see 2.1. |

**Conclusion:** every Brand the runtime ever holds has `payouts === undefined`, `refunds === undefined`, `lastPayoutAt === undefined`. The fields exist on the type purely as architectural placeholder for the B2b/B3 cycle that will populate them from real DB tables.

### 2.3 BrandPaymentsView behaviour today

`mingla-business/src/components/brand/BrandPaymentsView.tsx:175-180` reads `(brand.payouts ?? []).slice().sort(...)` → always `[]` → `sortedPayouts.length === 0` → empty-state branch at line 410-416 renders `"No payouts yet"` + `"Payouts arrive here once you start selling tickets."`. Same logic for refunds (lines 182-187 + 451-484).

The `[TRANSITIONAL]` comments at lines 170-180 + 419-421 are **stale documentation** — they describe a state that ORCH-0742 already neutralised at the persist layer and that `mapBrandRowToUi` never reinstated. The comments do NOT render to users; the screen IS honest at runtime. (Filed as 🟡 hidden flaw 2.5 — comment-vs-code drift, fix is doc-only.)

**No fabricated payout data is reaching users on the brand-level Payments screen.** The dispatch's S1-high severity claim does not survive contact with the code.

### 2.4 The actual screen the operator was looking at

`mingla-business/app/event/[id]/reconciliation.tsx` — the per-event cross-source Reconciliation summary (Cycle 13 J-R1/J-R2/J-R3, locked by DEC-095).

Lines 554-559:

```tsx
<SectionRow
  label="PAYOUT (estimated)"
  value={formatCurrency(summary.payoutEstimate, currency)}
  variant="mid"
  hint="TRANSITIONAL — B-cycle Stripe payout API"
/>
```

The hint subtitle is the literal "tarnsactional b-cycle" text the operator paraphrased. The value is from `summary.payoutEstimate`, which in turn comes from `summarizeEventMoney()` in `mingla-business/src/utils/moneySummary.ts:183`:

```ts
payoutEstimate: round2(round2(onlineRevenue * 0.96) + doorRevenue),
```

A flat 4% Stripe-fee stub applied to online revenue, plus door revenue at 1.0 (cash assumed fee-free; card-reader / NFC fee schedules pushed to B-cycle). Confirmed by reconciliation.ts header doc:

> `D-13-10 settlement-stub split: payoutEstimate = round(onlineRevenue × 96)/100 + doorRevenue.`
> `[TRANSITIONAL] payoutEstimate per D-13-10. EXIT: B-cycle Stripe payout API + Stripe Terminal SDK.`

### 2.5 Two unrelated "reconciliations" got conflated

| Name | Owner ORCH | Status | What it actually does |
|---|---|---|---|
| **Stripe onboarding state reconciliation** | ORCH-0764B (closed 2026-05-09) | DONE | Cached `brand.stripeStatus` defers to live Stripe truth — the app stops claiming "active" when Stripe says otherwise. Touches `BrandPaymentsView` banner, `useBrandStripeStatus`, `pg_derive_brand_stripe_status` RPC, KYC remediation routing. |
| **Cycle 13 event-day reconciliation** | Cycle 13 (DEC-095, 11 decisions locked) | SHIPPED WITH TRANSITIONAL B-CYCLE GATES | Aggregates orders + door sales + scans + guests for an event into a settlement summary. `payoutEstimate` uses 4% Stripe-fee stub. PDF export is disabled. Audit log integration deferred. |

ORCH-0764B has nothing to do with the event-day Reconciliation screen the operator is looking at. The screen the operator is on is honest-by-label (KPI literally says "estimated"; hint literally says "TRANSITIONAL — B-cycle Stripe payout API") but its number is a model approximation, not a Stripe payout.

---

## 3. Investigation Manifest (files read, in trace order)

1. `MEMORY.md` + `feedback_zustand_persist_no_server_snapshots.md` — establish I-PROPOSED-J context
2. `mingla-business/src/store/currentBrandStore.ts` (full) — confirm v14 persist shape
3. `mingla-business/src/types/brand.ts` (full) — Brand shape including `payouts` / `refunds` optionality
4. `mingla-business/src/hooks/useBrands.ts` (full) — server-state pathway (React Query)
5. `mingla-business/src/services/brandsService.ts` (head + grep) — service layer
6. `mingla-business/src/services/brandMapping.ts:175-241` — `mapBrandRowToUi` output shape
7. `mingla-business/src/utils/brandPatch.ts:60-87` — confirms payouts/refunds skipped server-side-only
8. `mingla-business/src/components/brand/BrandPaymentsView.tsx` (full, 690 lines) — consumer
9. `grep "brand\.payouts\|brand\.refunds" mingla-business` — full consumer map (2 files: BrandPaymentsView + BrandFinanceReportsView; both safely default to `[]`)
10. `grep "payouts: \[\|seedPayouts\|stub.*payout"` — confirm no code path ever fills `brand.payouts` with stub data
11. `mingla-business/src/utils/reconciliation.ts:1-260` (then targeted 240-280) — payoutEstimate computation
12. `mingla-business/src/utils/moneySummary.ts:177-183` — 4% Stripe-fee stub formula
13. `mingla-business/app/event/[id]/reconciliation.tsx:1-60 + 540-562` — actual surface rendering "PAYOUT (estimated)" with transitional hint
14. `Mingla_Artifacts/MASTER_BUG_LIST.md` (ORCH-0764B and ORCH-0742 entries) — historical reconciliation context

---

## 4. Findings (classified)

### 🔵 Observation 4.1 — Original ORCH-0796 hypothesis disproven

The dispatch prompt's premise that `brand.payouts` + `brand.refunds` arrays leak from Zustand persist into BrandPaymentsView is false. ORCH-0742 (closed 2026-05-06) already collapsed the persist payload to `currentBrandId` only. `mapBrandRowToUi` never repopulates the arrays. Runtime always renders empty-state "No payouts yet" on BrandPaymentsView for never-sold brands.

**Implication:** ORCH-0796 should be either CLOSED-NO-OP or REFRAMED. See §7.

### 🟠 Contributing Factor 4.2 — The operator is reading the Reconciliation screen, not the Payments screen

The "old data" the operator describes is the literal `"TRANSITIONAL — B-cycle Stripe payout API"` subtitle hint under `PAYOUT (estimated)` on the per-event Reconciliation page. It is on-screen text rendered by the live UI, not stale persisted data. It IS labelled as a transitional estimate per Constitution #7 (label temporary fixes with exit conditions).

**File + line:** `mingla-business/app/event/[id]/reconciliation.tsx:554-559` (the SectionRow with `hint="TRANSITIONAL — B-cycle Stripe payout API"`).
**Causal chain:** operator opens an event → taps Reconciliation → renders Money section → sees PAYOUT row with transitional hint subtitle → reads it as "old data".
**Verification:** grep confirms exactly one occurrence of that hint string in the repo, and the renderer is `SectionRow` with `value={formatCurrency(summary.payoutEstimate, currency)}` from `summarizeEventMoney`.

### 🔴 Root cause 4.3 — `payoutEstimate` is a hardcoded 4% Stripe-fee stub, not a real Stripe payout figure

The figure the operator sees on the PAYOUT (estimated) row is a model approximation, not real Stripe data.

| Field | Value |
|---|---|
| **File + line** | `mingla-business/src/utils/moneySummary.ts:183` |
| **Exact code** | `payoutEstimate: round2(round2(onlineRevenue * 0.96) + doorRevenue),` |
| **What it does** | Subtracts a flat 4% from online revenue, leaves door revenue intact, sums. The 4% is a Stripe-card-fee approximation. It ignores: real Stripe Connect application fees, currency-conversion fees, dispute reserves, Connect destination-charge configuration, Apple Pay / Google Pay variations, Refund offsets via `refundedAmountCents`, Terminal SDK fee schedules. |
| **What it should do** | Pull the real Stripe payout figure (or a server-derived expected payout) for the event's orders, accounting for actual `application_fee_amount`, refunds, and disputes. For events with no Stripe activity yet, render `—` or a clearly-labelled "Once payouts arrive". |
| **Causal chain** | order ledger + door ledger → `summarizeEventMoney` aggregates → returns `payoutEstimate` via the 4% stub → `computeReconciliation` forwards it onto `ReconciliationSummary.payoutEstimate` → reconciliation.tsx SectionRow renders the formatted value with the TRANSITIONAL hint. The hint is honest; the number is a placeholder. |
| **Verification step** | (a) Read `moneySummary.ts:183`; (b) read `reconciliation.ts:17-18` D-13-10 split header doc; (c) confirm hint text uniqueness via grep; (d) DB probe: no edge function or DB view computes real payout per event today — there is no canonical server source for this number. |

### 🟡 Hidden flaw 4.4 — PDF export is also B-cycle-gated

`mingla-business/app/event/[id]/reconciliation.tsx:720-724`:

```tsx
{/* "Email PDF report" — DEFERRED to B-cycle per D-13-7. Visibly disabled, never tappable */}
<Text style={styles.exportSecondaryHint}>B-cycle</Text>
```

Same B-cycle deferral pattern as the payout estimate. Not the operator's reported symptom, but adjacent transitional surface on the same screen.

### 🟡 Hidden flaw 4.5 — Stale `[TRANSITIONAL]` comments in BrandPaymentsView

`mingla-business/src/components/brand/BrandPaymentsView.tsx:170-180` + `:419-421` describe `brand.payouts` / `brand.refunds` as being read "from Zustand stub". This is no longer accurate post-ORCH-0742 — the persist no longer carries those arrays, and the type fields never get populated. The comments mislead future investigators (it misled the ORCH-0796 dispatch). Doc-only cleanup; the runtime is fine.

### 🔵 Observation 4.6 — `availableBalanceGbp` / `pendingBalanceGbp` on the Brand type are deprecated

`types/brand.ts:246-250` explicitly labels them: "Deprecated legacy cache. Do not use for active Payments display." BrandPaymentsView uses the **live** balance via `useBrandStripeBalances` hook (lines 165-167, 225-240) instead of the deprecated cached fields. So real Stripe balance flow IS wired via a separate hook. This means the architectural pattern (use live hook, not cached Brand field) is already proven elsewhere in the same screen — ORCH-0797 (B2b real payouts wiring) has a precedent to mirror.

---

## 5. Five-Layer Cross-Check

| Layer | What it says |
|---|---|
| **Docs** | `mingla-business/src/utils/reconciliation.ts` header §D-13-10 explicitly declares the 4% stub as TRANSITIONAL with EXIT condition "B-cycle Stripe payout API + Stripe Terminal SDK". `Mingla_Artifacts/BUSINESS_PROJECT_PLAN.md` schedules real payout wiring under **B2b/B3**. |
| **Schema** | No `event_payout_summary` / `event_payouts` view or table exists. `payouts` table exists (used by Stripe Connect denormalization) but has no per-event aggregation. `orders.application_fee_amount` field exists post-ORCH-0789/0790 on real Stripe Checkout sessions. |
| **Code** | `summarizeEventMoney` returns the 4% stub. No code path computes a real per-event Stripe payout figure. The reconciliation screen's SectionRow renders the stub with the TRANSITIONAL hint. |
| **Runtime** | An organiser opening Reconciliation on any event sees the 4% approximation. The hint subtitle exposes the transitional state honestly. The figure is internally consistent (matches `0.96 × online + 1.0 × door`) but does not equal what Stripe will actually pay out (which depends on real Connect fee config, refunds, disputes). |
| **Data** | No persisted stub data exists. ORCH-0742 + `mapBrandRowToUi` + the persist v14 migrator all confirm runtime payouts data is empty by default. The "old data" the operator referred to is the LABEL, not stored values. |

All five layers agree. There is no contradiction — the code is honest about being in a transitional state.

---

## 6. Blast Radius Map

| Surface | Affected? | How |
|---|---|---|
| `mingla-business/app/event/[id]/reconciliation.tsx` | YES | PAYOUT (estimated) row + PDF export gate |
| `mingla-business/src/utils/moneySummary.ts` | YES | source of the 4% stub formula |
| `mingla-business/src/utils/reconciliation.ts` | YES | forwards payoutEstimate from moneySummary |
| `mingla-business/src/components/brand/BrandFinanceReportsView.tsx:218` | NO | reads `brand.refunds ?? []` which is always `[]` post-ORCH-0742; no fabrication risk |
| `mingla-business/src/components/brand/BrandPaymentsView.tsx` | NO at runtime (renders honest empty state); YES at doc-comment level (stale `[TRANSITIONAL]` markers) |
| `mingla-admin/` | NO | admin reads orders + refunds directly via Supabase queries, doesn't use the business mobile reconciliation aggregator |
| `app-mobile/` | NO | consumer app does not consume business events |
| `supabase/functions/` | NO | no edge function computes a "real payout estimate" per event yet |

No solo / collab parity concern (this is single-user organiser-side). Multi-currency: `payoutEstimate` is computed in the event's expected currency via `summarizeEventMoney`, so currency-awareness is correct. The PROBLEM is the magnitude of the figure, not its currency formatting.

---

## 7. Reframing Recommendation

**The original ORCH-0796 dispatch is moot.** Recommend the orchestrator REFRAME (not close-no-op, because the operator's underlying question is real). Two viable reframings:

### Option A — REFRAME ORCH-0796 → ORCH-0796-RX "Reconciliation screen payout-estimate honesty + B-cycle wiring"

Scope splits in two:

1. **Immediate doc-truth fix (1-2 hours):** Sharpen the PAYOUT (estimated) row hint to be more specific than "B-cycle Stripe payout API" — e.g., `"Estimated using 4% Stripe-fee approximation. Real payout figure ships when Stripe payout reconciliation lands (B2b)."` so the operator no longer reads it as "old data". Also remove the stale `[TRANSITIONAL]` comments at `BrandPaymentsView.tsx:170-180` + `:419-421` (Finding 4.5).
2. **Real B-cycle work (separately tracked, larger):** ORCH-0797 (queued by the orchestrator dispatch) — wire the Reconciliation PAYOUT row (and BrandPaymentsView's RECENT PAYOUTS list) to a real per-event payout aggregation query against `orders.application_fee_amount` + `refunds.amount_cents` + `payouts` table. This is the cycle-B2b/B3 scope already on the project plan.

### Option B — CLOSE ORCH-0796 as NO-OP, register a fresh ORCH for the Reconciliation screen reframe

The original ORCH-0796 narrative (Zustand stub leak) is structurally inaccurate. A fresh ORCH-0796-A might be cleaner for traceability.

**Recommendation:** Option A. The operator's question is real, and the doc-truth fix is small enough to bundle with the rename in the next implementor dispatch. The big B-cycle work is already queued as ORCH-0797.

---

## 8. Fix Strategy (direction only — not a spec)

If the orchestrator accepts Option A:

1. **Hint subtitle revision** on `mingla-business/app/event/[id]/reconciliation.tsx:558` — tighten language so the operator reads it as "estimated approximation pending B2b" instead of "old data".
2. **Stale comment reap** at `mingla-business/src/components/brand/BrandPaymentsView.tsx:170-180 + :419-421` — replace the misleading "still read from Zustand stub" comments with a single line acknowledging that the fields are unpopulated post-ORCH-0742 and that real wiring lands in B2b (ORCH-0797).
3. **No DB / RLS / edge function changes** in this scope. No persist version bump (already v14). No new tests (the empty-state render is already covered by existing flow).
4. **B-cycle real wiring (ORCH-0797, separate dispatch):** investigator + spec + implementor pass for the per-event Stripe payout aggregation query.

---

## 9. Regression Prevention

**Invariant work needed in ORCH-0797 (NOT ORCH-0796):** when the real per-event payout aggregator lands, add a new strict-grep gate banning re-introduction of the `0.96` literal in any `mingla-business/src/utils/moneySummary.ts` or `mingla-business/src/utils/reconciliation.ts` file. The 4% stub must not survive as dead code.

For ORCH-0796 itself: a doc-truth fix needs no automated regression gate beyond standard typecheck.

---

## 10. Discoveries for Orchestrator

1. **ORCH-0796 reframe required.** The dispatch hypothesis was wrong; the persist already complies with I-PROPOSED-J.
2. **Naming collision risk:** "reconciliation" means three different things in this codebase — Stripe onboarding state (ORCH-0764B), event-day cross-source settlement (Cycle 13 J-R1/J-R2/J-R3), and (proposed) real payout reconciliation (B2b/B3). Future ORCHs that touch any of these should disambiguate up front.
3. **Cross-link with ORCH-0795 follow-ups.** ORCH-0795 close registered ORCH-0796 ID as a P3 "scanner-row churn root cause" follow-up. **There is an ID collision** — the current ORCH-0796 dispatch (payouts) and the ORCH-0795 close-note's mention of ORCH-0796 (scanner churn) appear to share the same ID. Orchestrator must resolve: either renumber the scanner-churn follow-up to ORCH-0796-A / ORCH-0800, or renumber this payout investigation. Flagging as P1 traceability defect.
4. **`availableBalanceGbp` + `pendingBalanceGbp` on the Brand type are dead.** Per `types/brand.ts:246-250` they are deprecated; per grep they have no remaining readers. Candidate for a deletion cycle (separate small ORCH or bundled into ORCH-0797 close).
5. **PDF report export on Reconciliation screen is also B-cycle-gated.** Tracked as 🟡 Finding 4.4. Belongs in the same B-cycle scope as the real payout wiring.

---

## 11. Confidence

**Overall: HIGH.**

| Aspect | Confidence | Why |
|---|---|---|
| Original hypothesis disproved | HIGH | Read the actual persist code, type, mapper, service, and component layers end-to-end; ran 4 independent grep probes |
| Real surface located | HIGH | The exact subtitle hint text the operator paraphrased appears once in the codebase, at the line cited |
| `payoutEstimate` is a 4% stub | HIGH | Formula literally `round2(onlineRevenue * 0.96) + doorRevenue` at `moneySummary.ts:183`; declared as stub in 3 separate doc comments |
| ORCH-0764B is unrelated | HIGH | ORCH-0764B is Stripe onboarding state, not payouts — confirmed by reading the ORCH-0764B implementation/QA report references in MASTER_BUG_LIST |
| ORCH ID collision (Finding 10.3) | MEDIUM-HIGH | Both close-note text and current dispatch use "ORCH-0796"; orchestrator should resolve, but I don't have visibility on which ID was intended canonical |

---

## 12. What this report does NOT do (per skill discipline)

- Does NOT propose a code fix for the 4% stub itself (that is B2b / ORCH-0797 SPEC work).
- Does NOT touch any code.
- Does NOT escalate the original ORCH-0796 dispatch's S1 severity — the dispatch overstated the harm because the false hypothesis (Zustand persist leak) carried I-PROPOSED-J + Constitution #9 weight that the real surface (a clearly-labelled "estimated" KPI with TRANSITIONAL hint) does not.
- Does NOT write a SPEC; per dispatch instruction, this is an INVESTIGATE-only pass.

---

NEXT HANDOFF — paste into Codex `orchestrator-mingla` (or continue with Claude `mingla-orchestrator`):

Reframe ORCH-0796 based on the investigation at `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0796_PAYOUTS_STUB_FIXTURE_LEAK.md`. The original hypothesis (Zustand stub leak into BrandPaymentsView) is structurally disproven — ORCH-0742 already collapsed the persist payload to `currentBrandId` only and `mapBrandRowToUi` never populates `payouts` / `refunds`, so BrandPaymentsView correctly renders the empty state today. The operator's actual report is about the per-event Reconciliation screen's `PAYOUT (estimated)` row at `mingla-business/app/event/[id]/reconciliation.tsx:554-559`, whose value comes from the 4% Stripe-fee stub formula `round2(onlineRevenue * 0.96) + doorRevenue` at `mingla-business/src/utils/moneySummary.ts:183` and whose hint subtitle literally reads `"TRANSITIONAL — B-cycle Stripe payout API"`. Recommended Option A — reframe ORCH-0796 to a small doc-truth pass (sharpen the Reconciliation payout-row hint copy + reap the stale `[TRANSITIONAL]` comments in `BrandPaymentsView.tsx:170-180 + :419-421`) and keep ORCH-0797 as the real B2b/B3 cycle that wires per-event Stripe payout aggregation. Also resolve the ORCH-0796 ID collision flagged in Finding 10.3 (the ORCH-0795 close note already registered an unrelated ORCH-0796 P3 for scanner-row churn). Hard guards: no code edits before the operator approves Option A vs Option B; no spec written yet (this was INVESTIGATE-only); no severity claim above S2 for the reframed scope. Downstream routing after operator confirms Option A: Claude `mingla-forensics` SPEC mode → Codex `implementor-mingla` → Claude `mingla-forensics` (TEST mode) → orchestrator CLOSE. Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
