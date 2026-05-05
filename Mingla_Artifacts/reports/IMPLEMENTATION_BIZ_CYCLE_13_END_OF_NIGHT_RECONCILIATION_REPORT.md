# IMPLEMENTATION REPORT — BIZ Cycle 13 (End-of-Night Reconciliation Report)

**Status:** `implemented, partially verified` — all 12 SPEC §8 implementation steps executed; tsc-clean across all Cycle 13 work (only 2 pre-existing errors persist: D-CYCLE12-IMPL-1 + D-CYCLE12-IMPL-2 from Cycle 12 close, unrelated); full grep regression battery T-39..T-47 PASS; manual smoke deferred to operator (T-22..T-34 require device runtime).
**Mode:** IMPLEMENT
**Date:** 2026-05-04
**Surface:** Mingla Business mobile app (`mingla-business/`)
**Cycle:** Cycle 13 (BIZ End-of-Night Reconciliation Report)
**Dispatch:** [`prompts/IMPLEMENTOR_BIZ_CYCLE_13_END_OF_NIGHT_RECONCILIATION.md`](../prompts/IMPLEMENTOR_BIZ_CYCLE_13_END_OF_NIGHT_RECONCILIATION.md)
**SPEC:** [`specs/SPEC_BIZ_CYCLE_13_END_OF_NIGHT_RECONCILIATION.md`](../specs/SPEC_BIZ_CYCLE_13_END_OF_NIGHT_RECONCILIATION.md)
**Investigation:** [`reports/INVESTIGATION_BIZ_CYCLE_13_END_OF_NIGHT_RECONCILIATION.md`](./INVESTIGATION_BIZ_CYCLE_13_END_OF_NIGHT_RECONCILIATION.md)
**Decision lock-in:** `DECISION_LOG.md` DEC-095 (11 architectural decisions D-13-1..D-13-11)

---

## 1 — Layman summary

Cycle 13 ships a single reconciliation screen at `app/event/[id]/reconciliation.tsx` that joins the 4 client ledgers (online orders + door sales + comp guests + scans) for a single event. Operators with `finance_manager+` rank (30) see a new "Reconciliation" tile on Event Detail; tapping it opens a dedicated screen with adaptive per-status headline (live/upcoming/past/cancelled), 4 sections (Tickets/Revenue/Scans/Discrepancies), and a CSV export with `Gross/Refunded/Net` columns + 5-line summary stanza prefix for accountant-friendly import. Cycle 12 J-D5 door-only card stays put — Cycle 13 is the cross-source SUPERSET. ZERO migrations, ZERO new dependencies, ZERO mutations to existing stores. Pure read-only aggregation over already-shipping persisted Zustand stores. Settlement-stub corrected per D-13-10 (online×0.96 + door×1.0) — fixes the EventDetailKpiCard payout overstatement (D-CYCLE13-RECON-FOR-3) locally on this route. PDF export DEFERRED to B-cycle email-attachment-via-Resend per D-13-7 ("Email PDF report" CTA renders DISABLED with caption "B-cycle"). Discrepancies ADVISORY-only per D-13-4 (silent when clean). Cycle 12 door route gets a small permission-gated "View full reconciliation" CTA per D-CYCLE13-RECON-FOR-4 polish.

**What's TRANSITIONAL:**
- `payoutEstimate` uses 4% Stripe-fee stub on online revenue. EXIT: B-cycle Stripe payout API + Stripe Terminal SDK fee schedules.
- "Email PDF report" CTA visibly DISABLED with caption "B-cycle". EXIT: B-cycle email-attachment-via-Resend.
- Native CSV degradation persists from Cycle 10 (D-CYCLE10-IMPL-1 — `Share.share({ message })` text-content; no `.csv` file artifact on iOS/Android until `expo-sharing` + `expo-file-system` ship).
- I-27 store-level enforcement gap (D-CYCLE13-RECON-FOR-1) — Cycle 13 dedupes scans defensively via `Set` at the aggregator layer. EXIT: B-cycle scan-ticket edge function adds DB-level UNIQUE constraint.
- `MIN_RANK.VIEW_RECONCILIATION = 30` is mobile-UX only (no server RLS counterpart yet — Cycle 13 reads-only over local stores). EXIT: B-cycle server-side reconciliation RPC mirrors finance_manager+ gate.

**What's locked + production-ready:**
- All 11 D-13-N decisions threaded verbatim into code-level contracts (DEC-095)
- I-32 amendment honestly documents the forward-compat gap (no silent UX dishonesty)
- Defensive Set dedupe per I-27 (FOR-1 acknowledged for B-cycle backlog)
- Const #9 silent-when-clean discrepancy section (no false-positive warm-orange noise)
- Const #1 dual permission gates (tile null-return + route NotAuthorizedShell) — never dead taps
- ORCH-0710 hook-ordering rule honored: ALL hooks (lines 113-217) BEFORE any conditional early-return (lines 224, 245)
- Memory rule `feedback_toast_needs_absolute_wrap` honored: Toast wrapped in absolute-positioned View at line 1023
- Memory rule `feedback_rn_color_formats` honored: 0 hits for oklch/lab/lch/color-mix in any new file (only 1 documentation comment reference)
- Cycle 12 J-D5 door-only card behavior UNCHANGED — door route diff is ADDITIVE-only (60 insertions, 0 deletions)

---

## 2 — Status & verification matrix

| Stage | Status |
|-------|--------|
| All 12 SPEC §8 implementation steps | ✅ Complete |
| Step 1: deriveLiveStatus extraction | ✅ Util created + Event Detail import wired + cancelled→past local collapse for HeroStatusPill |
| Step 2: reconciliation aggregator | ✅ ~340 LOC pure aggregator with EMPTY_SUMMARY + computeReconciliation + headlineCopyFor |
| Step 3: VIEW_RECONCILIATION constant | ✅ Added to MIN_RANK after REFUND_DOOR_SALE |
| Step 4: CSV serializer extension | ✅ 14-column shape + summaryStanza arg + ReconciliationCsvSummary type + exportReconciliationCsv wrapper |
| Step 5: /ui-ux-pro-max pre-flight | ✅ Query: `"operator finance reconciliation summary multi-source dashboard dark glass" --domain product`. Returned: Dark Mode (OLED) + Data-Dense + Glassmorphism + Real-Time Monitoring. Applied: reused existing GlassCard glass tokens; tabular-nums on currency; warm-orange (accent.warm) for advisory discrepancies (data-dense alert palette without escalating to red since D-13-4 ADVISORY-only); zero new visual primitives. |
| Step 6: ActionTile extraction | ✅ Extracted to src/components/event/ActionTile.tsx; Event Detail imports + inline definition deleted |
| Step 7: ReconciliationCtaTile | ✅ ~30 LOC permission-gated null-return wrapper around ActionTile |
| Step 8: Reconciliation route | ✅ ~1030 LOC route (full screen + 7 inline section components + StyleSheet) |
| Step 9: Event Detail wire-up | ✅ Import + handleReconciliation + render after Door Sales tile |
| Step 10: Door route polish CTA | ✅ Permission-gated CTA above TESTING MODE banner; ADDITIVE-only diff (60 insertions, 0 deletions) |
| Step 11: I-32 amendment | ✅ Forward-compat note appended; NO new invariants Cycle 13 |
| Step 12: Grep regression battery + IMPL report | ✅ T-39..T-47 all PASS; this report |
| `npx tsc --noEmit` (Cycle 13 work) | ✅ Clean — only 2 pre-existing errors persist (D-CYCLE12-IMPL-1 + D-CYCLE12-IMPL-2; unrelated to Cycle 13) |
| Final 15-section IMPL report | ✅ This document |

---

## 3 — Files touched matrix

| Path | Action | LOC delta |
|------|--------|-----------|
| `mingla-business/src/utils/eventLifecycle.ts` | NEW (Step 1) | +47 |
| `mingla-business/src/utils/reconciliation.ts` | NEW (Step 2) | +340 |
| `mingla-business/src/utils/permissionGates.ts` | MOD (Step 3) | +5 (constant + comment) |
| `mingla-business/src/utils/guestCsvExport.ts` | MOD (Step 4) | ~+108 (3 new columns + summary stanza + reconciliation wrapper + types) |
| `mingla-business/src/components/event/ActionTile.tsx` | NEW (Step 6 extraction) | +97 |
| `mingla-business/src/components/event/ReconciliationCtaTile.tsx` | NEW (Step 7) | +33 |
| `mingla-business/app/event/[id]/reconciliation.tsx` | NEW (Step 8) | +1030 |
| `mingla-business/app/event/[id]/index.tsx` | MOD (Steps 1, 6, 9) | +18 / -75 (delete inline ActionTile + deriveLiveStatus; add tile + handler + 2 imports) |
| `mingla-business/app/event/[id]/door/index.tsx` | MOD (Step 10) | +60 / -0 (ADDITIVE-only) |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | MOD (Step 11) | +2 (I-32 amendment) |

**Totals:** 5 NEW + 5 MOD = 10 file touches. ~+1740 / -75 = ~+1665 net LOC.

---

## 4 — Old → New receipts

### 4.1 `src/utils/eventLifecycle.ts` (NEW)

**Purpose:** Extracted predicate. Originally inline in `app/event/[id]/index.tsx:191-203`. Cycle 13 needs it on the new reconciliation route too — Const #2 (one owner per truth) demands consolidation.

**Change of behavior vs original:** util now returns 4-state `EventLifecycleStatus` ("live" | "upcoming" | "past" | "cancelled") instead of original 3-state ("live" | "upcoming" | "past"). The reconciliation route needs cancelled as a distinct status to render the "Event cancelled · refund/payout audit" headline branch. Event Detail's HeroStatusPill (3-state ENDED treatment) is preserved by the local `deriveScreenStatus` adapter that collapses cancelled→past — UX UNCHANGED.

**Why:** SPEC §4.3.2 + Step 1 implementation order.

### 4.2 `src/utils/reconciliation.ts` (NEW)

**Purpose:** Pure aggregator joining 4 client stores into deterministic `ReconciliationSummary`. Side-effect-free; same inputs → identical output.

**Implements verbatim per SPEC §4.2.1:**
- `EventLifecycleStatus`, `PaymentMethodKey`, `DiscrepancyKind`, `DiscrepancyEntry` types
- `ReconciliationSummary` interface (24 fields)
- `ReconciliationInputs` interface
- `EMPTY_SUMMARY` constant (zero-everywhere fallback)
- `headlineCopyFor(status)` — 4 status branches with verbatim copy locked per SPEC §4.2.1
- `computeReconciliation(inputs)` — main aggregator implementing all 5 derivation passes:
  1. Tickets (online live = qty - refundedQty for paid + refunded_partial; door live = qty - refundedQty for ALL door sales; comps = entries.length)
  2. Revenue (online live = max(0, total - refunded) for paid + refunded_partial; door live for ALL door sales)
  3. Refunds (per-channel sum)
  4. Per-method revenue (8-key Record matching grossRevenue ±0.005 tolerance)
  5. Settlement stub split (D-13-10): `payoutEstimate = round(onlineRevenue × 96)/100 + doorRevenue`
- 3 discrepancy detectors (D1 auto-check-in mismatch via expandDoorTickets + Set lookup; D2 method sum drift > 0.005; D3 refund-status mismatch failsafe)
- I-27 defensive scan dedupe via `successTicketIds: Set<string>`; per-scanner counts via `perScannerSuccessTicketIds: Record<string, Set<string>>`
- `unscannedTickets = Math.max(0, totalLiveTickets - uniqueScannedTickets)` clamp prevents negative output

**Why:** SPEC §4.2.1.

**Lines changed:** +340.

### 4.3 `src/utils/permissionGates.ts`

**What it did before:** `MIN_RANK` const had 12 action keys (Cycle 13a + 13b ranks).

**What it does now:** Added `VIEW_RECONCILIATION: BRAND_ROLE_RANK.finance_manager` (30) after `REFUND_DOOR_SALE` with comment block citing DEC-095 D-13-3 + I-32 forward-compat note.

**Why:** SPEC §4.2.2 + DEC-095 D-13-3.

**Lines changed:** +5.

### 4.4 `src/utils/guestCsvExport.ts`

**What it did before:** 3-kind union (`order | comp | door`); 11-column CSV header; `serializeGuestsToCsv(rows)` 1-arg signature; web Blob + native Share.share. `exportGuestsCsv` (J-G6) + `exportDoorSalesCsv` (J-D5).

**What it does now:**
- `serializeGuestsToCsv(rows, summary?)` 2-arg — second arg optional `ReconciliationCsvSummary`
- 14-column header — added `Gross / Refunded / Net` at positions 12-14
- 5-line `#`-prefixed summary stanza prepended when `summary` arg present
- Per-row Gross/Refunded/Net derived: order = `o.totalGbpAtPurchase` / `o.refundedAmountGbp` / `max(0, gross-refunded)`; door = same shape via `s.totalGbpAtSale` / `s.refundedAmountGbp`; comp = "0.00" for all 3 (zero-priced)
- NEW `ReconciliationCsvSummary` exported type (eventName + status + tickets + revenue + refunded + net + scanned)
- NEW `exportReconciliationCsv(args)` wrapper — joins 3 sources newest-first + populates summary stanza + filename `{slug}-reconciliation-{YYYY-MM-DD}.csv`
- Reuses existing `downloadCsvWeb` + `downloadCsvNative` (TRANSITIONAL native degradation persists from Cycle 10)

**Why:** SPEC §4.2.3 + DEC-095 D-13-7 + D-13-8 + D-13-9.

**Lines changed:** ~+108.

### 4.5 `src/components/event/ActionTile.tsx` (NEW — Step 6 extraction)

**Purpose:** Generic Pressable tile for Event Detail action grid. Originally inline in `app/event/[id]/index.tsx:866-929`. Extracted so `ReconciliationCtaTile` (Cycle 13) can compose without duplication. Const #2 (one owner per truth).

**Behavior:** UNCHANGED — verbatim copy of inline definition. Same props (icon/label/sub/primary/onPress); same 48% flexBasis grid behavior; same glass tokens; same primary-variant accent treatment.

**Why:** SPEC §4.3.1 implementor note (recommended option B — extract to shared file).

**Lines changed:** +97.

### 4.6 `src/components/event/ReconciliationCtaTile.tsx` (NEW)

**Purpose:** Permission-gated adapter for Event Detail action grid. Renders `ActionTile` with `icon="chart"` + `label="Reconciliation"` only when `useCurrentBrandRole` returns rank ≥ `MIN_RANK.VIEW_RECONCILIATION` (30). Const #1 — null-return when permission missing (NOT disabled with caption).

**Why:** SPEC §4.3.1 + DEC-095 D-13-3.

**Lines changed:** +33.

### 4.7 `app/event/[id]/reconciliation.tsx` (NEW — the substantive surface)

**Purpose:** Cycle 13 J-R1 + J-R2 + J-R3 cross-source reconciliation route. Mirrors Cycle 12 J-D5 chrome + ScrollView pattern. ALL hooks declared BEFORE any conditional early-return per ORCH-0710. Toast wrapped per memory rule.

**Render branches (3-state machine):**

1. **Not-found shell** (`event === null || typeof eventId !== "string"`): Chrome + EmptyState (`illustration="ticket"`, "Event not found")
2. **Permission gate shell** (`!canPerformAction(rank, "VIEW_RECONCILIATION")`): Chrome + EmptyState (`illustration="shield"`, "Restricted", caption from `gateCaptionFor("VIEW_RECONCILIATION")`)
3. **Populated render** (full screen): Chrome (with permission-gated download icon) + ScrollView containing:
   - HeadlineBanner (adaptive per status)
   - TicketsSection (online sold / door sold / comps / TOTAL LIVE)
   - RevenueSection (8 method rows + Gross + Refunded online/door + NET + Stripe fee + Door fee + PAYOUT estimated)
   - ScansSection (Scanned in pct% / Waiting|No-shows / Duplicate / Wrong event / Not-found / Voided / Cancelled / by-scanner expandable)
   - DiscrepanciesSection (only renders if `summary.discrepancies.length > 0` — Const #9)
   - ExportSection (primary CSV CTA + disabled "Email PDF report" with B-cycle caption)

**State (all raw entries + useMemo per Cycle 9c v2 selector pattern rule):**

- `allOrderEntries` / `allDoorEntries` / `allCompEntries` / `allScanEntries` (raw subscriptions)
- `summary` useMemo via `computeReconciliation`
- `eventOrders` / `eventDoorSales` / `eventComps` pre-filtered useMemo (for CSV export)
- `byScannerExpanded` / `exporting` / `toast` UI state (useState)
- `hasAnyData` derived useMemo

**Adaptive copy:**
- Headline copy: 4 status branches via `summary.headlineCopy` (from `headlineCopyFor`)
- Unscanned label: `(status === "past" || status === "cancelled") ? "No-shows" : "Waiting"` per D-13-6
- Empty state: section value slots show `"—"` (em dash) when `hasAnyData === false`; export CTA disabled with caption "No data to export yet."

**Why:** SPEC §4.3.2 + DEC-095 D-13-1..D-13-11 + ORCH-0710 + memory rules.

**Lines changed:** +1030.

### 4.8 `app/event/[id]/index.tsx`

**What it did before:** Inline `EventStatus = "live" | "upcoming" | "past"` + inline `deriveLiveStatus` collapsing cancelled→past + inline `ActionTile` component (~50 LOC) + inline `tileStyles` StyleSheet (~30 LOC). 7-tile action grid (Scan/Scanners/Orders/Guests/Public/Brand/Door).

**What it does now:**
- Imports `deriveLiveStatus` from `src/utils/eventLifecycle.ts`
- Imports `ActionTile` from `src/components/event/ActionTile.tsx`
- Imports `ReconciliationCtaTile` from `src/components/event/ReconciliationCtaTile.tsx`
- Inline `deriveLiveStatus` definition deleted; replaced by `deriveScreenStatus` adapter that collapses cancelled→past for HeroStatusPill (preserves existing 3-state UX)
- Inline `ActionTile` component + `tileStyles` deleted (replaced by single comment line)
- Added `handleReconciliation` callback routing to `/event/{id}/reconciliation`
- Added `<ReconciliationCtaTile brandId={brand?.id ?? null} onPress={handleReconciliation} />` AFTER Door Sales tile in action grid
- 3 import additions; 2 import-related comment additions

**Implementor note on tile placement:** SPEC §3.1 file matrix said "render tile in action grid (between Door Sales and Public page)" — but the actual code already has Public page BEFORE Door Sales. Placed AFTER Door Sales (end of grid) per the SPEC's "AFTER Door Sales" intent + matches the gated-cluster pattern (Door Sales is also conditionally rendered). Documented for orchestrator visibility — placement is semantically correct (Reconciliation + Door Sales are both finance/operator surfaces; clustering them at grid end is the right UX).

**Why:** SPEC §4.3.3 + Step 1 + Step 6 + Step 9 implementation order.

**Lines changed:** +18 / -75 (net -57 LOC; reflects the substantial inline-deletion of ActionTile + deriveLiveStatus).

### 4.9 `app/event/[id]/door/index.tsx`

**What it did before:** J-D2 list view + J-D5 inline reconciliation card (Cycle 12 close).

**What it does now:** Adds permission-gated "View full reconciliation report" CTA at top of route (above TESTING MODE banner). 60 insertions, 0 deletions — purely ADDITIVE per D-CYCLE13-RECON-FOR-4 polish.
- New imports: `Icon` (was already imported via accent palette but now explicit) + `useCurrentBrandRole` + `canPerformAction`
- New hook usage: `const { rank: currentRank } = useCurrentBrandRole(brand?.id ?? null);` + `canViewReconciliation` derived
- New handler: `handleViewReconciliation` (router.push to `/event/{id}/reconciliation`)
- New CTA Pressable above banner, gated on `canViewReconciliation`
- New StyleSheet entries: `viewReconCta` + `viewReconCtaPressed` + `viewReconCtaLabel`

**Why:** SPEC §4.3.4 + D-CYCLE13-RECON-FOR-4 polish from forensics §9.

**Lines changed:** +60 / -0 (ADDITIVE-only).

### 4.10 `Mingla_Artifacts/INVARIANT_REGISTRY.md`

**Added:** I-32 amendment paragraph after the existing "Test that catches a regression" line. Documents `MIN_RANK.VIEW_RECONCILIATION = finance_manager (30)` introduction + forward-compat note that no server RLS counterpart exists yet (mobile-UX gate only) + EXIT condition (B-cycle server-side reconciliation RPC).

**Why:** SPEC §4.4 + DEC-095 D-13-3.

**Lines changed:** +2.

---

## 5 — SC verification matrix (SC-1..SC-34)

| SC | Description | Status | Evidence |
|----|-------------|--------|----------|
| SC-1 | NEW route exists at `app/event/[id]/reconciliation.tsx` | ✅ PASS | File exists; expo-router will auto-register |
| SC-2 | `MIN_RANK.VIEW_RECONCILIATION === BRAND_ROLE_RANK.finance_manager` (30) | ✅ PASS | grep + visual inspection |
| SC-3 | `canPerformAction(rank, "VIEW_RECONCILIATION")` returns true for rank≥30 | ✅ PASS (static) | Existing `canPerformAction` is `currentRank >= MIN_RANK[action]` |
| SC-4 | ReconciliationCtaTile null-return when rank<30 | ✅ PASS (static) | Code: `if (!canPerformAction(rank, "VIEW_RECONCILIATION")) return null;` |
| SC-5 | Sub-rank user route deep-link → friendly Restricted shell | ✅ PASS (static) | Code: permission gate at line 245 returns NotAuthorizedShell with `gateCaptionFor("VIEW_RECONCILIATION")` |
| SC-6 | computeReconciliation pure (no side effects) | ✅ PASS (static) | No async, no console.log, no mutations; pure JS over input arrays |
| SC-7 | totalLiveTickets === sum of components | ✅ PASS (static) | Code: `const totalLiveTickets = onlineLiveTickets + doorLiveTickets + compTickets;` |
| SC-8 | grossRevenue === onlineRevenue + doorRevenue | ✅ PASS (static) | Code: `const grossRevenue = round2(onlineRevenue + doorRevenue);` |
| SC-9 | grossRevenue and revenueByMethod sum within ±0.005 | ✅ PASS (static) | Both derived from same input filter+max(0,...); D2 detector uses 0.005 tolerance |
| SC-10 | payoutEstimate === round(onlineRevenue×96)/100 + doorRevenue | ✅ PASS (static) | Code: `const payoutEstimate = round2(round2(onlineRevenue * 0.96) + doorRevenue);` |
| SC-11 | uniqueScannedTickets === Set(successScans.ticketIds).size | ✅ PASS (static) | Code: `successTicketIds.add(scan.ticketId)` then `uniqueScannedTickets = successTicketIds.size` |
| SC-12 | unscannedTickets clamp via Math.max(0, ...) | ✅ PASS (static) | Code: `Math.max(0, totalLiveTickets - uniqueScannedTickets)` |
| SC-13 | Headline copy matches table for 4 statuses | ✅ PASS (static) | `headlineCopyFor` switch verbatim per SPEC §4.2.1 |
| SC-14 | Past-cancelled label === "No-shows"; live-upcoming === "Waiting" | ✅ PASS (static) | Code: `unscannedLabel = (status === "past" || status === "cancelled") ? "No-shows" : "Waiting"` |
| SC-15 | D1 detection — door tickets without scans | ✅ PASS (static) | Code: expandDoorTickets + Set diff; copy includes count + plural |
| SC-16 | D2 detection — method sum mismatch | ✅ PASS (static) | Code: `Math.abs(grossRevenue - methodSum) > 0.005` |
| SC-17 | D3 detection — refund without status flip | ✅ PASS (static) | Code: filter on `refunds.length > 0 && status !== "refunded_*"` |
| SC-18 | D1+D2+D3 warm-orange icon-badge + copy + hint | ✅ PASS (static) | DiscrepanciesSection uses `accent.warm` icon + `discrepancyCopy` + `discrepancyHint` |
| SC-19 | Discrepancy section silent when length===0 | ✅ PASS (static) | Code: `{summary.discrepancies.length > 0 ? <DiscrepanciesSection /> : null}` |
| SC-20 | "Email PDF report" disabled with B-cycle caption | ✅ PASS (static) | ExportSection renders View (NOT Pressable) with `Email PDF report` + "B-cycle" hint |
| SC-21 | Export success/failure toast paths | ✅ PASS (static) | handleExport try/catch with showToast on both branches |
| SC-22 | CSV 14-column shape | ✅ PASS (static) | serializeGuestsToCsv headers array has 14 entries; positions 12-14 = Gross/Refunded/Net |
| SC-23 | CSV 5-line summary stanza prefix | ✅ PASS (static) | Code: 5 push() calls when summary !== undefined |
| SC-24 | Filename `{slug}-reconciliation-{YYYY-MM-DD}.csv` | ✅ PASS (static) | Code: `${args.event.eventSlug}-reconciliation-${formatYmdToday()}.csv` |
| SC-25 | Web export Blob + anchor | ✅ PASS (static) | Existing downloadCsvWeb reused unchanged |
| SC-26 | Native export Share.share text | ✅ PASS (static) | Existing downloadCsvNative reused unchanged (TRANSITIONAL) |
| SC-27 | Selector pattern — raw entries + useMemo | ✅ PASS | T-41 grep gate: 0 hits to fresh-array selectors in `app/event/[id]/reconciliation.tsx` |
| SC-28 | Hook ordering ORCH-0710 | ✅ PASS | T-43 verification: all hooks (lines 113-217) BEFORE first early-return (line 224) |
| SC-29 | tsc clean | ✅ PASS | T-39: only 2 pre-existing errors persist (D-CYCLE12-IMPL-1 + D-CYCLE12-IMPL-2; unrelated) |
| SC-30 | NO oklch/lab/lch/color-mix in new files | ✅ PASS | T-40: 0 hits in any new file (1 documentation comment in route file is text-only) |
| SC-31 | NO new TextInputs | ✅ PASS | T-45: 0 hits in route + util files |
| SC-32 | Toast wrap absolute | ✅ PASS | T-44: `position: "absolute"` in styles.toastWrap at line 1023 |
| SC-33 | Cycle 12 J-D5 ADDITIVE-only | ✅ PASS | T-46: git diff shows 60 insertions, 0 deletions |
| SC-34 | Constitutional compliance scan | ✅ PASS | See §11 — no violations across 14 principles |

**Summary:** 34 / 34 PASS (29 static-verified + 5 grep-gate-verified). 0 FAIL. Manual smoke (T-22..T-34 component tests) require operator device run (camera permission OS prompts unavailable in this surface; only requires populated event data).

---

## 6 — T outcomes (T-01..T-48)

### Aggregator unit tests (T-01..T-19)

UNVERIFIED at this stage — `computeReconciliation` is pure and offline-runnable; T-01..T-19 are deterministic and would PASS by code-trace inspection. Recommend tester runs them as Jest unit tests in retest battery for empirical confirmation.

| Test | Status | Notes |
|------|--------|-------|
| T-01 (empty event) | UNVERIFIED — code-trace PASS | `EMPTY_SUMMARY` returned via early branch `event === null` at route layer; aggregator with empty arrays returns zero counts |
| T-02..T-04 (happy path online/door/mixed) | UNVERIFIED — code-trace PASS | Filter + reduce semantics straightforward |
| T-05..T-07 (refunds + cancelled exclusion) | UNVERIFIED — code-trace PASS | Status filter + max(0, ...) handle all branches |
| T-08..T-09 (D1 plural) | UNVERIFIED — code-trace PASS | Singular/plural string interpolation verified |
| T-10..T-11 (D2 + D3 detection) | UNVERIFIED — code-trace PASS | Threshold checks correct |
| T-12 (scan dedup defensive) | UNVERIFIED — code-trace PASS | Set semantics |
| T-13..T-16 (4 headline copy branches) | UNVERIFIED — code-trace PASS | switch + verbatim string checks |
| T-17..T-18 (payout split D-13-10) | UNVERIFIED — code-trace PASS | Math operations match SPEC §4.2.1 verbatim |
| T-19 (unscanned clamp) | UNVERIFIED — code-trace PASS | `Math.max(0, ...)` |

### Component tests (T-20..T-34)

UNVERIFIED — manual smoke required. All branches code-verified.

### CSV export tests (T-35..T-38)

UNVERIFIED — recommend tester runs as Jest snapshot tests.

### Static + regression (T-39..T-48)

| Test | Status |
|------|--------|
| T-39 tsc clean | ✅ PASS — only 2 pre-existing errors (D-CYCLE12-IMPL-1/2) |
| T-40 RN color formats | ✅ PASS — 0 hits to oklch/lab/lch/color-mix in new files |
| T-41 Selector pattern | ✅ PASS — 0 hits to fresh-array selector subscriptions |
| T-42 I-21 anon-route safety | ✅ PASS — 0 hits to reconciliation/stores in app/o/, app/e/, app/checkout/ |
| T-43 Hook ordering ORCH-0710 | ✅ PASS — all hooks at lines 113-217 BEFORE first early-return at line 224 |
| T-44 Toast wrap absolute | ✅ PASS — `position: "absolute"` at line 1023 |
| T-45 No new TextInputs | ✅ PASS — 0 hits in route + util |
| T-46 Cycle 12 J-D5 ADDITIVE-only | ✅ PASS — 60 insertions, 0 deletions on door route |
| T-47 TRANSITIONAL labels | ✅ PASS — 8 hits in route file (payoutEstimate stub + Email PDF + Stripe fee + B-cycle hints) |
| T-48 No fabricated data | ✅ PASS — empty state shows `"—"` em dash, never seeds fake values |

**Summary:** 10 / 10 grep gates PASS. 0 FAIL. 38 unit/component/CSV tests UNVERIFIED (manual smoke deferred).

---

## 7 — Invariant verification

| ID | Status | Evidence |
|----|--------|----------|
| I-19 (Immutable order financials) | ✅ Preserved | Reconciliation reads-only; ZERO mutations to OrderRecord/RefundRecord |
| I-21 (Anon-tolerant buyer routes) | ✅ Preserved | T-42: 0 imports to reconciliation/stores in app/o/, app/e/, app/checkout/ |
| I-25 (Comp guests in useGuestStore only) | ✅ Preserved | Reconciliation reads useGuestStore.entries directly, no duplication |
| I-26 (privateGuestList no buyer surface) | ✅ Preserved | No Cycle 13 touchpoint |
| I-27 (Single-scan-per-ticket) | ✅ Preserved + DEFENSIVE | Cycle 13 dedupes via Set at aggregator layer (D-CYCLE13-RECON-FOR-1 acknowledges store-level enforcement gap for B-cycle) |
| I-28 (UI-only scanner invitation flow) | ✅ Preserved | No Cycle 13 touchpoint |
| I-29 (Door sales NEVER as phantom orders) | ✅ Preserved | Reconciliation reads useDoorSalesStore — separate authority from useOrderStore |
| I-30 (Door-tier vs online-tier separation) | ✅ Preserved | Reconciliation aggregates by SOURCE not by tier; tier-level filtering N/A |
| I-31 (UI-only brand invitation) | ✅ Preserved | No Cycle 13 touchpoint |
| **I-32** (Mobile UI gates mirror RLS) | ✅ Preserved + AMENDED | NEW `MIN_RANK.VIEW_RECONCILIATION = 30` declared client-side per DEC-095 D-13-3; forward-compat note honestly documents server RLS gap (no counterpart yet — Cycle 13 reads-only over local stores; B-cycle will mirror) |
| I-33 (permissions_override deny-list shape) | ✅ Preserved | No Cycle 13 touchpoint |
| I-34 (permissions_matrix DECOMMISSIONED) | ✅ Preserved | No Cycle 13 touchpoint |

**No invariant violations.** I-32 amendment text added to INVARIANT_REGISTRY.md per Step 11.

---

## 8 — Memory rule deference proof

| Rule | Compliance | Evidence |
|------|------------|----------|
| `feedback_diagnose_first_workflow` | YES | No silent SPEC reinterpretation. SPEC §3.1 file-matrix said "render tile between Door Sales and Public page" but actual code order is different — surfaced explicitly in §4.8 implementor note (placed AFTER Door Sales per SPEC's primary anchor; documented for orchestrator visibility). |
| `feedback_orchestrator_never_executes` | YES | Implementor wrote code + report; did not spawn forensics/orchestrator/tester subagents |
| `feedback_no_summary_paragraph` | YES | This report has structured sections (no narrative paragraphs); chat output is tight summary + report path |
| `feedback_implementor_uses_ui_ux_pro_max` | YES | Step 5 pre-flight ran: `py .claude/skills/ui-ux-pro-max/scripts/search.py "operator finance reconciliation summary multi-source dashboard dark glass" --domain product`. Returned 3 results: (1) Financial Dashboard — Dark Mode (OLED) + Data-Dense; (2) Smart Home/IoT Dashboard — Glassmorphism + Dark Mode (OLED) + Real-Time Monitoring; (3) Fintech/Crypto — Glassmorphism + Dark Mode + Real-Time Monitoring + Predictive. Applied to IMPL: reused existing GlassCard glass tokens (`glass.tint.profileBase` / `glass.border.profileBase`) per Cycle 12 J-D5 pattern; tabular-nums on all currency/count values; warm-orange (`accent.warm`) for advisory discrepancies (data-dense alert palette without escalating to red since D-13-4 ADVISORY-only); real-time recompute via raw entries + useMemo (matches Real-Time Monitoring guidance); zero new visual primitives. |
| `feedback_keyboard_never_blocks_input` | N/A — VERIFIED | T-45: 0 TextInputs in reconciliation.tsx + reconciliation.ts |
| `feedback_rn_color_formats` | YES | T-40: 0 hits to oklch/lab/lch/color-mix in any new file. All inline colors hex (`#xxx`), rgb/rgba (`rgba(235, 120, 37, 0.18)`), or hsl when via tokens. |
| `feedback_anon_buyer_routes` | YES | T-42: 0 imports of reconciliation/stores in app/o/, app/e/, app/checkout/ |
| `feedback_toast_needs_absolute_wrap` | YES | T-44: `<View style={styles.toastWrap}>` wraps Toast; `styles.toastWrap.position === "absolute"` at line 1023 |
| `feedback_rn_sub_sheet_must_render_inside_parent` | N/A — VERIFIED | No sub-sheets in reconciliation route (no Sheet primitive used) |
| `feedback_orchestrator_never_executes` | YES | (duplicate row from canonical table — preserved for completeness) |
| `feedback_no_coauthored_by` | YES | No AI attribution lines anywhere in code or report |
| `feedback_sequential_one_step_at_a_time` | YES | Sequential 12 steps with tsc checkpoints after Steps 1, 2, 3, 4, 6, 7, 8, 9, 10, 12. Step 5 (pre-flight) is process-only. Step 11 (registry) is .md. 0 step skipped; 0 step combined. |

---

## 9 — Cache safety

- No React Query keys touched (Cycle 13 is pure Zustand reads). Persist versions UNCHANGED across all 4 source stores.
- Selector pattern grep-clean (T-41 0 hits): NEVER subscribe to fresh-array selectors directly. All multi-record reads use raw `useXxxStore((s) => s.entries)` + `useMemo`.
- `useCurrentBrandRole` is React Query — query key reused from Cycle 13a (`brandRoleKeys.byBrand(brandId, userId)`). Cycle 13 adds NO new keys. Cache invalidation rules unchanged.
- AsyncStorage shape UNCHANGED — Cycle 13 doesn't touch any persisted store schema.

---

## 10 — Regression surface (5 areas tester should spot-check)

1. **Cycle 12 J-D5 door-only reconciliation card** (`app/event/[id]/door/index.tsx`) — must continue rendering reconciliation totals + by-scanner expandable + Export CSV unchanged. The new "View full reconciliation" CTA is purely additive (above TESTING MODE banner). Verify both surfaces work in parallel.
2. **Event Detail action grid** (`app/event/[id]/index.tsx`) — 7 tiles + new Reconciliation tile (8th, gated). Verify HeroStatusPill still renders ENDED for cancelled/past events (preserved via `deriveScreenStatus` collapse). Verify Door Sales tile still gates on `event.inPersonPaymentsEnabled`. Verify all existing Pressables route correctly.
3. **EventDetailKpiCard** — payout stub (`revenueGbp × 0.96`) still renders unchanged. Cycle 13 reconciliation route uses corrected split (online×0.96 + door×1.0), but Event Detail KPI is intentionally simplified per D-13-10 (separate follow-up candidate). No drift.
4. **CSV exports for Cycle 10 J-G6 + Cycle 12 J-D5** — both still call `serializeGuestsToCsv(rows)` 1-arg signature (summary arg optional). Verify both exports still produce valid CSVs with old 11-column shape NOT visible — they get the new 14-column shape too (Gross/Refunded/Net columns added unconditionally; old columns at unchanged positions). Spot-check that Cycle 10 + Cycle 12 exports don't break for accountants importing into existing spreadsheets — they'll see 3 new trailing columns.
5. **Permission gate behavior on stub brands** — operator on local stub brand (lm/tll/sl/hr) with synthesized account_owner role (rank 60) MUST see the Reconciliation tile + access the route. Verify by switching to a stub brand on Event Detail.

---

## 11 — Constitutional compliance scan (14 principles)

| # | Principle | Cycle 13 status |
|---|-----------|-----------------|
| 1 | No dead taps | ✅ Tile null-return when no permission (NOT disabled with caption); route shows friendly "Restricted" shell on deep-link; "Email PDF report" visibly DISABLED with caption "B-cycle" (never tappable but explicitly labeled) |
| 2 | One owner per truth | ✅ `deriveLiveStatus` extracted to single util shared by Event Detail + reconciliation route; `ActionTile` extracted to shared component |
| 3 | No silent failures | ✅ handleExport try/catch surfaces both success/failure via Toast; aggregator never throws (defensive Math.max + Set dedupe) |
| 4 | One key per entity | N/A (no React Query keys added) |
| 5 | Server state server-side | ✅ All 4 source stores TRANSITIONAL Zustand; Cycle 13 reads-only over them (no Zustand mutations) |
| 6 | Logout clears | ✅ Inherited — all 4 source stores already wired in `clearAllStores`; Cycle 13 adds no new persisted state |
| 7 | Label temporary | ✅ TRANSITIONAL markers on payoutEstimate stub + "Email PDF report" disabled CTA + Stripe fee comment + B-cycle hints in revenue rows + native CSV degradation comment in guestCsvExport.ts persists from Cycle 10 |
| 8 | Subtract before adding | ✅ Step 1 deleted inline `deriveLiveStatus` before adding util import; Step 6 deleted inline `ActionTile` + `tileStyles` before adding shared import; both extractions are net-negative LOC in Event Detail |
| 9 | No fabricated data | ✅ Empty state shows `"—"` em dash; aggregator returns zero-counts on empty inputs; discrepancy section silent when clean (no fake "0 issues found" noise) |
| 10 | Currency-aware UI | ✅ `formatGbp` everywhere; `currency: "GBP"` frozen on every order/sale (existing) |
| 11 | One auth instance | ✅ Inherited — useAuth singleton used via useCurrentBrandRole |
| 12 | Validate at right time | ✅ Permission gate at route entry (after data hooks, before render); export disabled when `hasAnyData === false` |
| 13 | Exclusion consistency | N/A (no serving/recommendation paths) |
| 14 | Persisted-state startup | ✅ Cycle 13 doesn't touch persisted state; cold-start hydration unchanged |

**No violations.**

---

## 12 — Discoveries for orchestrator

### D-CYCLE13-IMPL-1 (S3, observation) — SPEC tile placement vs actual action grid order

**What:** SPEC §3.1 file matrix specified "render tile in action grid (between Door Sales and Public page)" but the actual code order is `[Scan, Scanners, Orders, Guests, Public page, Brand page, Door Sales]` — i.e., Public page is BEFORE Door Sales. Implementor placed the new tile AFTER Door Sales (end of grid) since that honors the SPEC's primary "AFTER Door Sales" anchor + clusters gated finance tiles together.

**Impact:** Cosmetic positioning. Reconciliation tile appears at end of grid alongside Door Sales (both gated). Visually coherent.

**Recommendation:** Note in DEC-095 amendment (or accept as-is). If operator prefers different physical placement, swap `<ReconciliationCtaTile />` to between any two existing tiles — single-line move. No code changes elsewhere.

### D-CYCLE13-IMPL-2 (S3, observation, pre-existing) — `app/(tabs)/events.tsx:720` duplicate object literal property

**Persisted from Cycle 12 close** (D-CYCLE12-IMPL-1). Still appears in tsc output. NOT mine — Cycle 13 didn't touch events.tsx.

### D-CYCLE13-IMPL-3 (S3, observation, pre-existing) — `src/services/brandMapping.ts:180` Brand type drift

**Persisted from Cycle 12 close** (D-CYCLE12-IMPL-2). Still appears in tsc output. NOT mine.

### D-CYCLE13-IMPL-4 (S3, observation) — CSV column shape changed for Cycle 10 + Cycle 12 exports

**What:** `serializeGuestsToCsv` now produces 14-column CSVs unconditionally (the new Gross/Refunded/Net columns are appended for ALL callers, not just `exportReconciliationCsv`). This means:
- Cycle 10 J-G6 `exportGuestsCsv` output now has 14 columns (was 11)
- Cycle 12 J-D5 `exportDoorSalesCsv` output now has 14 columns (was 11)
- Existing accountants who imported the 11-column CSVs into spreadsheets will see 3 new trailing columns on next export

**Impact:** Slightly more useful data for accountants (refund attribution per row); existing import templates may need column-mapping updates. NOT a regression — just a columnshape evolution.

**Recommendation:** Acceptable for Cycle 13 launch. If operator prefers Cycle 10 + Cycle 12 exports stay at 11 columns, the change can be made conditional on the `summary` arg presence (only reconciliation export shows the 3 new columns) — ~10 LOC adjustment. Surfaced for orchestrator decision.

### D-CYCLE13-IMPL-5 (S3, observation) — `EventLifecycleStatus` type duplicated in 2 files

**What:** The `EventLifecycleStatus` type is exported from BOTH `src/utils/eventLifecycle.ts` (Step 1) AND `src/utils/reconciliation.ts` (Step 2). They are identical 4-value union types. Implementor chose to declare both to avoid cross-file dependency between utilities (eventLifecycle is the pure predicate; reconciliation imports it would be acceptable but creates a util→util dependency chain).

**Impact:** Cosmetic duplication; no behavioral risk. tsc happily resolves both.

**Recommendation:** Acceptable. If operator prefers single source, change reconciliation.ts to `import type { EventLifecycleStatus } from "./eventLifecycle";` — 1-line change. Surfaced for orchestrator awareness.

---

## 13 — Transition items (none new for Cycle 13)

| Marker | Location | Description | EXIT condition |
|--------|----------|-------------|----------------|
| `[TRANSITIONAL]` payoutEstimate (D-13-10) | `src/utils/reconciliation.ts` header + computeReconciliation comment | 4% Stripe-fee stub on online; door×1.0 | B-cycle Stripe payout API + Stripe Terminal SDK fee schedules |
| Email PDF report disabled (D-13-7) | `app/event/[id]/reconciliation.tsx` ExportSection | DEFERRED entirely | B-cycle email-attachment-via-Resend |
| Native CSV text-content share (D-CYCLE10-IMPL-1) | `src/utils/guestCsvExport.ts` downloadCsvNative | Persists from Cycle 10 | `expo-sharing` + `expo-file-system` install |
| `MIN_RANK.VIEW_RECONCILIATION = 30` mobile-UX-only (D-13-3) | `src/utils/permissionGates.ts` comment + INVARIANT_REGISTRY I-32 amendment | No server RLS counterpart yet | B-cycle server-side reconciliation RPC |
| I-27 store-level enforcement gap (D-CYCLE13-RECON-FOR-1) | `src/store/scanStore.ts` (existing TRANSITIONAL marker) | Cycle 13 dedupes defensively at aggregator | B-cycle scan-ticket edge function adds DB UNIQUE constraint |

All TRANSITIONAL markers in code; all documented above.

---

## 14 — Verification commands run

```bash
cd mingla-business

# 1. Final tsc — Cycle 13 work clean
npx tsc --noEmit | grep -v "\\.expo[/\\\\]types[/\\\\]router\\.d\\.ts"
# → 2 errors, both pre-existing and unrelated to Cycle 13 (D-CYCLE12-IMPL-1 + D-CYCLE12-IMPL-2)

# 2. T-40 — RN color format check (0 hits)
grep -rE "oklch|lab\\(|lch\\(|color-mix" \
  src/utils/reconciliation.ts \
  src/utils/eventLifecycle.ts \
  src/components/event/ReconciliationCtaTile.tsx \
  "app/event/[id]/reconciliation.tsx"
# → 0 hits (1 documentation comment in route file is text-only — `// No oklch/lab/lch/color-mix anywhere.`)

# 3. T-41 — banned direct fresh-array subscription (0 hits)
grep -rEn "useOrderStore\\(\\(s\\) => s\\.getOrdersForEvent|useDoorSalesStore\\(\\(s\\) => s\\.getSalesForEvent|useGuestStore\\(\\(s\\) => s\\.getCompEntriesForEvent|useScanStore\\(\\(s\\) => s\\.getScansForEvent" \
  "app/event/[id]/reconciliation.tsx"
# → 0 hits

# 4. T-42 — anon-tolerant buyer route safety (0 hits)
grep -rE "reconciliation|useOrderStore|useDoorSalesStore|useGuestStore|useScanStore" app/o/ "app/e/" app/checkout/
# → 0 hits

# 5. T-43 — ORCH-0710 hook ordering (J-R1 route)
grep -nE "useMemo|useState|useCallback" "app/event/[id]/reconciliation.tsx" | head -20
# → all hook lines (113-217) BEFORE early-return shells (line 224 not-found, line 245 permission). PASS.

# 6. T-44 — Toast wrap absolute (1 match)
grep -nE 'position: "absolute"' "app/event/[id]/reconciliation.tsx"
# → line 1023: position: "absolute" (toastWrap style)

# 7. T-45 — No new TextInputs (0 hits)
grep -rE "TextInput" \
  "app/event/[id]/reconciliation.tsx" \
  src/utils/reconciliation.ts \
  src/components/event/ReconciliationCtaTile.tsx
# → 0 hits

# 8. T-46 — Cycle 12 J-D5 ADDITIVE-only (60 insertions, 0 deletions)
git diff --stat HEAD -- "mingla-business/app/event/[id]/door/index.tsx"
# → 60 +, 0 −

# 9. T-47 — TRANSITIONAL labels (8 hits)
grep -nE "\\[TRANSITIONAL\\]|TESTING MODE|B-cycle" "app/event/[id]/reconciliation.tsx"
# → 8 hits: payoutEstimate stub + Email PDF + Stripe fee + 2× B-cycle revenue rows + 3× more
```

All 9 verifications PASS.

---

## 15 — Recommended next action

### 15.1 Curated commit set

```bash
git add \
  mingla-business/src/utils/eventLifecycle.ts \
  mingla-business/src/utils/reconciliation.ts \
  mingla-business/src/utils/permissionGates.ts \
  mingla-business/src/utils/guestCsvExport.ts \
  mingla-business/src/components/event/ActionTile.tsx \
  mingla-business/src/components/event/ReconciliationCtaTile.tsx \
  "mingla-business/app/event/[id]/reconciliation.tsx" \
  "mingla-business/app/event/[id]/index.tsx" \
  "mingla-business/app/event/[id]/door/index.tsx" \
  Mingla_Artifacts/INVARIANT_REGISTRY.md \
  Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_13_END_OF_NIGHT_RECONCILIATION_REPORT.md
```

### 15.2 Recommended commit message

```
feat(business): Cycle 13 — End-of-night reconciliation report (J-R1 + J-R2 + J-R3 + DEC-095)

Cross-source reconciliation route at app/event/[id]/reconciliation.tsx joining 4
client ledgers (orders + door sales + comps + scans) with adaptive headline,
4 sections (Tickets/Revenue/Scans/Discrepancies), advisory discrepancy flags
(D1+D2+D3 ADVISORY-only per D-13-4), corrected payout split (online×0.96 +
door×1.0 per D-13-10), CSV export with Gross/Refunded/Net columns + 5-line
summary stanza (D-13-8/9), permission-gated finance_manager+ (rank 30 per
D-13-3), defensive scan dedupe per I-27. Cycle 12 J-D5 door-only card stays
put — Cycle 13 is the cross-source SUPERSET. ZERO migrations + ZERO new deps
+ ZERO mutations to existing stores. PDF deferred to B-cycle email-attachment
per D-13-7. I-32 amended with VIEW_RECONCILIATION forward-compat note.

3 NEW utilities: eventLifecycle.ts (deriveLiveStatus extraction) +
reconciliation.ts (pure aggregator) + ReconciliationCtaTile.tsx
(permission-gated tile). 1 NEW route: reconciliation.tsx (~1030 LOC).
1 NEW shared component: ActionTile.tsx (extracted from Event Detail).
4 MOD: permissionGates.ts (+1 const), guestCsvExport.ts (3 new columns +
summary stanza + reconciliation wrapper), Event Detail (tile wire-up +
extractions), door route (D-CYCLE13-RECON-FOR-4 polish CTA). I-32 amendment.

5 forensics discoveries registered (D-CYCLE13-RECON-FOR-1..5 in investigation
report). 5 implementor discoveries (D-CYCLE13-IMPL-1..5 in IMPL report).
ORCH-0710 hook-ordering honored (all hooks before early-return).
feedback_toast_needs_absolute_wrap honored (Toast in absolute View).
feedback_rn_color_formats honored (0 hits oklch/lab/lch/color-mix).
feedback_implementor_uses_ui_ux_pro_max honored (Step 5 pre-flight).

Closes Cycle 13 IMPL per dispatch + SPEC + DEC-095.
```

### 15.3 Hand back

Hand back to `/mingla-orchestrator` for REVIEW + (if APPROVED) optional `/mingla-tester` dispatch + post-PASS protocol (update 7 artifacts + EAS OTA + announce next dispatch = Cycle 14 = Account / edit profile / settings / delete-flow / sign out per cycle-14.md).

### 15.4 Manual smoke required (operator device run, ~30 min)

1. Open Event Detail on a populated past event with mixed data: ≥1 paid order + ≥1 door sale + ≥1 comp + ≥1 success scan
2. Verify Reconciliation tile appears in action grid (operator role = account_owner / admin or finance_manager+)
3. Tap tile → reconciliation route opens
4. Verify all 4 sections populated: TICKETS (online + door + comps + TOTAL LIVE), REVENUE (per-method break + Gross + Refunded + NET + payout estimate), SCANS (scanned-of-total + waiting/no-shows + duplicate/wrong-event/not-found/voided counts), DISCREPANCIES (only renders if non-zero — with mixed data it should be silent)
5. Verify adaptive headline copy matches event status (live / past / cancelled / upcoming)
6. Verify "By scanner" expandable shows per-scanner counts when ≥1 scan exists
7. Tap export icon → verify CSV downloads (web) or shares (native) with 14-column shape + 5-line `#`-prefixed summary stanza prefix
8. Verify filename format `{slug}-reconciliation-{YYYY-MM-DD}.csv`
9. Switch to a sub-rank user (e.g., `marketing_manager` rank 20) — verify tile disappears from Event Detail action grid + direct deep-link to `/event/{id}/reconciliation` shows friendly "Restricted" shell (NOT 404)
10. Open Door Sales route on same event → verify new "View full reconciliation report" CTA appears at top (above TESTING MODE banner) when permission rank ≥ 30
11. Tap polish CTA → navigates to reconciliation route
12. Verify Cycle 12 J-D5 door-only reconciliation card still renders unchanged below the new CTA + TESTING MODE banner
13. Verify Event Detail HeroStatusPill still shows ENDED for cancelled/past events (preserved via deriveScreenStatus collapse)
14. Verify EventDetailKpiCard payout still shows simplified `revenueGbp × 0.96` stub (separate follow-up per D-13-10 — Event Detail KPI not corrected; only reconciliation route uses corrected split)

---

## 17 — Rework v2 — Honest export toast (D-CYCLE13-IMPL-6)

**Status:** `implemented and verified` (static + tsc + grep). Manual smoke required for SC-v2-6 (silent dismiss path).
**Mode:** REWORK
**Dispatch:** [`prompts/IMPLEMENTOR_BIZ_CYCLE_13_REWORK_v2_HONEST_EXPORT_TOAST.md`](../prompts/IMPLEMENTOR_BIZ_CYCLE_13_REWORK_v2_HONEST_EXPORT_TOAST.md)
**Date:** 2026-05-04 (post Cycle 13 commit `0ab7e63d`)

### 17.1 Symptom

Operator device smoke 2026-05-04 (post Cycle 13 ship): tapped export icon on `/event/[id]/reconciliation` → native iOS share sheet appeared → operator dismissed → toast fired `"Exported reconciliation report."`. **No actual export happened, but the UI claimed success — Const #3 silent-failure violation.**

### 17.2 Root cause

`downloadCsvNative` in `src/utils/guestCsvExport.ts` awaited `Share.share()` without checking `result.action`. RN's Share.share resolves on BOTH `sharedAction` (user picked destination) AND `dismissedAction` (user dismissed) — pre-rework code hit the success branch in both cases.

Same bug existed in:
- Cycle 10 J-G6 export (`exportGuestsCsv` caller `app/event/[id]/guests/index.tsx:321-332`)
- Cycle 12 J-D5 export (`exportDoorSalesCsv` caller `app/event/[id]/door/index.tsx:260-272`)
- Cycle 13 J-R3 export (`exportReconciliationCsv` caller `app/event/[id]/reconciliation.tsx:189-216`)

All 3 inherited the silent `await` and the unconditional success toast.

### 17.3 Fix shape

1. **NEW `ExportResult` discriminated union** in `guestCsvExport.ts`: `{ method: "downloaded" | "shared" | "dismissed" }`
2. **Modified `downloadCsvNative`** to capture `Share.share()` result.action and return `"shared" | "dismissed"`
3. **Modified 3 export wrappers** to return `Promise<ExportResult>` (was `Promise<void>`)
4. **Adapted 3 caller `handleExport` blocks** with adaptive toast logic per `result.method`

**Operator-locked decision (D-CYCLE13-IMPL-6 chat 2026-05-04):** "go tight fix" — fix at the source so all 3 export flows benefit. Defer proper file-share UX (`expo-sharing` + `expo-file-system` install per D-CYCLE10-IMPL-1) to B-cycle.

### 17.4 Old → New receipts (4 MOD files)

#### `src/utils/guestCsvExport.ts`

**What it did before:** `downloadCsvNative` awaited `Share.share()` without checking `result.action`. 3 export wrappers returned `Promise<void>`. Pre-rework Cycle 13 IMPL had no `ExportResult` type.

**What it does now:** Adds NEW `ExportResult` discriminated union (`downloaded | shared | dismissed`). `downloadCsvNative` now captures `result.action` and returns `"shared" | "dismissed"`. All 3 export wrappers (`exportGuestsCsv` / `exportDoorSalesCsv` / `exportReconciliationCsv`) return `Promise<ExportResult>`. Web path returns `{ method: "downloaded" }` after `downloadCsvWeb`. Native path returns `{ method: action }` from the `downloadCsvNative` discriminator. Heading docstring on `ExportResult` cites D-CYCLE13-IMPL-6 + D-CYCLE10-IMPL-1 forward-compat path.

**Why:** D-CYCLE13-IMPL-6 + Const #3 (no silent failures).

**Lines changed:** ~+30 / -10 (net ~+20).

#### `app/event/[id]/reconciliation.tsx`

**What it did before:** `handleExport` awaited `exportReconciliationCsv` and unconditionally fired `showToast("Exported reconciliation report.")` on the success path.

**What it does now:** Captures `result` from `exportReconciliationCsv`. Branches:
- `result.method === "downloaded"` → `"Downloaded reconciliation report."`
- `result.method === "shared"` → `"Reconciliation CSV shared."`
- `result.method === "dismissed"` → silent (no toast — operator knows they dismissed)

**Why:** D-CYCLE13-IMPL-6 + Const #3.

**Lines changed:** +12 / -1.

#### `app/event/[id]/door/index.tsx`

**What it did before:** `handleExport` unconditionally fired `showToast(`Exported ${eventSales.length} door sale(s).`)` on success path.

**What it does now:** Captures `result`. Branches:
- `downloaded` → `"Downloaded {N} door sale(s)."`
- `shared` → `"{N} door sale(s) — CSV shared."`
- `dismissed` → silent

**Why:** D-CYCLE13-IMPL-6 + Const #3.

**Lines changed:** +9 / -1.

#### `app/event/[id]/guests/index.tsx`

**What it did before:** `handleExport` unconditionally fired `showToast(`Exported ${merged.length} guests.`)` on success path.

**What it does now:** Captures `result`. Branches:
- `downloaded` → `"Downloaded {N} guest(s)."`
- `shared` → `"{N} guest(s) — CSV shared."`
- `dismissed` → silent

**Why:** D-CYCLE13-IMPL-6 + Const #3.

**Lines changed:** +9 / -1.

### 17.5 SC-v2 verification matrix

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| SC-v2-1 | `ExportResult` exported | ✅ PASS | grep + tsc resolution |
| SC-v2-2 | `downloadCsvNative` returns `"shared" \| "dismissed"` | ✅ PASS | code-trace: line 321 `result.action === "sharedAction" ? "shared" : "dismissed"` |
| SC-v2-3 | 3 export wrappers return `Promise<ExportResult>` | ✅ PASS | tsc clean + grep |
| SC-v2-4 | Web path → `{ method: "downloaded" }` | ✅ PASS | code-trace |
| SC-v2-5 | Native shared → `"...CSV shared."` toast (per flow) | ✅ PASS (static) | code-trace; manual smoke required for visual confirmation |
| SC-v2-6 | Native dismissed → NO toast fires (silent) | ✅ PASS (static) | code-trace; manual smoke required for visual confirmation |
| SC-v2-7 | Native dismissed → exporting state cleared | ✅ PASS | finally block sets `setExporting(false)` (reconciliation route only — door/guests don't have this state, but their CTAs aren't disable-during-submit anyway) |
| SC-v2-8 | Error path → unchanged "Couldn't export..." | ✅ PASS | catch block unchanged |
| SC-v2-9 | tsc clean | ✅ PASS | only 2 pre-existing errors persist |
| SC-v2-10 | All 3 export flows adapted | ✅ PASS | grep `result.method === "downloaded"\|result.method === "shared"\|result.method === "dismissed"` returns 3 file matches: guests/index.tsx + door/index.tsx + reconciliation.tsx |

### 17.6 Constitutional compliance (delta from Cycle 13 IMPL)

- **Const #3 no silent failures:** RESOLVED — toast now matches outcome. Pre-rework was a Const #3 violation in disguise (`catch` block surfaced errors fine, but the `try`-success-path wrongly toasted on dismiss).
- **Const #1 no dead taps:** preserved — export icon still tappable.
- **Const #7 label temporary:** D-CYCLE10-IMPL-1 TRANSITIONAL marker stays (proper file-share UX is the EXIT condition for B-cycle).

### 17.7 Side effect — Cycle 10 + Cycle 12 ALSO gain honest toasts

The fix at the source (`guestCsvExport.ts`) means all 3 export flows now toast honestly without separate fixes:
- Cycle 10 J-G6 guest list export
- Cycle 12 J-D5 door sales export
- Cycle 13 J-R3 reconciliation export

This is a quiet improvement: pre-rework, those 2 sibling exports also lied on dismiss; post-rework they are honest too. Documented for tester regression awareness — operators retesting Cycle 10 J-G6 + Cycle 12 J-D5 will notice the new dismiss-silent behavior is correct (not a regression).

### 17.8 Files touched (rework v2)

| Path | Action | LOC delta |
|------|--------|-----------|
| `mingla-business/src/utils/guestCsvExport.ts` | MOD | ~+30 / -10 (ExportResult type + downloadCsvNative discriminator + 3 wrappers) |
| `mingla-business/app/event/[id]/reconciliation.tsx` | MOD | +12 / -1 (handleExport adaptive toast) |
| `mingla-business/app/event/[id]/door/index.tsx` | MOD | +9 / -1 (handleExport adaptive toast) |
| `mingla-business/app/event/[id]/guests/index.tsx` | MOD | +9 / -1 (handleExport adaptive toast) |
| `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_13_END_OF_NIGHT_RECONCILIATION_REPORT.md` | MOD (this section) | +~140 |

**Totals:** 4 MOD code files + 1 MOD report. ~+60 / -13 net code LOC.

### 17.9 Verification commands run

```bash
cd mingla-business

# tsc clean (only 2 pre-existing errors)
npx tsc --noEmit | grep -v "\\.expo[/\\\\]types[/\\\\]router\\.d\\.ts"
# → 2 errors (D-CYCLE12-IMPL-1 + D-CYCLE12-IMPL-2)

# All 3 callers adapted
grep -rE 'result\\.method === "(downloaded|shared|dismissed)"' "app/event/[id]"
# → 3 files: guests/index.tsx + door/index.tsx + reconciliation.tsx

# Share.share action handling
grep -nE '"sharedAction"|"dismissedAction"' src/utils/guestCsvExport.ts
# → line 310 (docstring) + line 321 (code)
```

### 17.10 Manual smoke required (operator device run, ~5 min)

1. Open `/event/{id}/reconciliation` on past event with data
2. Tap export icon → share sheet appears → **dismiss without picking** → verify NO TOAST appears (silent)
3. Tap export icon again → share sheet appears → **pick "Mail" or "Notes"** → verify toast: `"Reconciliation CSV shared."`
4. Repeat steps 2-3 on `/event/{id}/door` (Cycle 12) and `/event/{id}/guests` (Cycle 10) — verify same dismiss-silent / pick-shared behavior with sibling toast strings
5. Web context (if testing web bundle): tap export → file downloads → verify toast: `"Downloaded reconciliation report."` (or sibling per flow)

### 17.11 Updated commit message proposal

```
fix(business): Cycle 13 v2 — honest export toast (D-CYCLE13-IMPL-6 + Const #3)

Native CSV export was firing "Exported successfully" toast even when the
operator dismissed the share sheet without picking a destination — caught
at Cycle 13 device smoke 2026-05-04 (Const #3 silent-failure violation).

Fix at the source in guestCsvExport.ts: NEW ExportResult discriminated union
(downloaded | shared | dismissed). downloadCsvNative now captures
Share.share() result.action and returns the discriminator. 3 export wrappers
(exportGuestsCsv + exportDoorSalesCsv + exportReconciliationCsv) return
Promise<ExportResult>. Caller handleExport blocks in 3 routes adapt their
toast strings: web "Downloaded..."; native shared "...CSV shared."; native
dismissed → silent (no false-positive success toast).

Side effect: Cycle 10 J-G6 + Cycle 12 J-D5 ALSO gain honest toasts in same
change (they shared the same lie). TRANSITIONAL D-CYCLE10-IMPL-1 native CSV
text-content limitation persists; full file-share UX (expo-sharing +
expo-file-system) defers to B-cycle.

4 MOD: guestCsvExport.ts (~+30/-10) + reconciliation.tsx (+12/-1) +
door/index.tsx (+9/-1) + guests/index.tsx (+9/-1). tsc clean.

Closes D-CYCLE13-IMPL-6.
```

### 17.12 Discoveries for orchestrator (rework v2)

**None new.** All findings tracked under existing IDs:
- D-CYCLE13-IMPL-6 (the fix itself — closed by this rework)
- D-CYCLE10-IMPL-1 (TRANSITIONAL native file-share UX) — still open as B-cycle backlog
- Pre-existing Cycle 12 errors (D-CYCLE12-IMPL-1/2) still persist in tsc output (not Cycle 13 scope)

---

## 16 — Cross-references

- Dispatch: [`prompts/IMPLEMENTOR_BIZ_CYCLE_13_END_OF_NIGHT_RECONCILIATION.md`](../prompts/IMPLEMENTOR_BIZ_CYCLE_13_END_OF_NIGHT_RECONCILIATION.md)
- SPEC: [`specs/SPEC_BIZ_CYCLE_13_END_OF_NIGHT_RECONCILIATION.md`](../specs/SPEC_BIZ_CYCLE_13_END_OF_NIGHT_RECONCILIATION.md)
- Investigation: [`reports/INVESTIGATION_BIZ_CYCLE_13_END_OF_NIGHT_RECONCILIATION.md`](./INVESTIGATION_BIZ_CYCLE_13_END_OF_NIGHT_RECONCILIATION.md)
- Decision lock-in: `DECISION_LOG.md` DEC-095
- Cycle 12 close (J-D5 partial coverage): [`reports/IMPLEMENTATION_BIZ_CYCLE_12_DOOR_SALES_REPORT.md`](./IMPLEMENTATION_BIZ_CYCLE_12_DOOR_SALES_REPORT.md)
- Cycle 9c v3 (orderStore + activity feed pattern): [`reports/IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT_v3.md`](./IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT_v3.md)
- Cycle 10 (guestStore + CSV TRANSITIONAL): [`reports/IMPLEMENTATION_BIZ_CYCLE_10_GUEST_LIST_REPORT.md`](./IMPLEMENTATION_BIZ_CYCLE_10_GUEST_LIST_REPORT.md)
- Cycle 11 v2 (scanStore + ORCH-0710 lesson): [`reports/IMPLEMENTATION_BIZ_CYCLE_11_QR_SCANNER_REPORT_v2.md`](./IMPLEMENTATION_BIZ_CYCLE_11_QR_SCANNER_REPORT_v2.md)
- Cycle 13a (rank gate prerequisite): [`reports/IMPLEMENTATION_BIZ_CYCLE_13A_PERMISSIONS_FOUNDATIONS_REPORT.md`](./IMPLEMENTATION_BIZ_CYCLE_13A_PERMISSIONS_FOUNDATIONS_REPORT.md)
- Cycle 13b (audit_log RLS — DEFERRED): [`reports/IMPLEMENTATION_BIZ_CYCLE_13B_PERMISSIONS_DEPTH_REPORT.md`](./IMPLEMENTATION_BIZ_CYCLE_13B_PERMISSIONS_DEPTH_REPORT.md)
- INVARIANT_REGISTRY: I-19 / I-21 / I-25 / I-26 / I-27 / I-28 / I-29 / I-30 / I-31 / I-32 (AMENDED) / I-33 / I-34
- Memory rules honored: 11 entries (§8)
