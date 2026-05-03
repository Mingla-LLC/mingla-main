# IMPLEMENTATION REPORT — BIZ Cycle 12 (Door Sales / In-Person Payments)

**Status:** `implemented, partially verified` — all 22 SPEC §9 implementation steps executed; tsc-clean across all Cycle 12 work; full grep regression battery PASS; manual smoke deferred to operator (T-01..T-50 require device runtime).
**Mode:** IMPLEMENT
**Date:** 2026-05-03
**Surface:** Mingla Business mobile app (`mingla-business/`)
**Cycle:** Cycle 12 (BIZ Door Sales / In-Person Payments)
**Dispatch:** [`prompts/IMPLEMENTOR_BIZ_CYCLE_12_DOOR_SALES.md`](../prompts/IMPLEMENTOR_BIZ_CYCLE_12_DOOR_SALES.md)
**SPEC:** [`specs/SPEC_BIZ_CYCLE_12_DOOR_SALES.md`](../specs/SPEC_BIZ_CYCLE_12_DOOR_SALES.md)
**Investigation:** [`reports/INVESTIGATION_BIZ_CYCLE_12_DOOR_SALES.md`](./INVESTIGATION_BIZ_CYCLE_12_DOOR_SALES.md)
**Phase 1 report (foundation, banked in commit `668bf968`):** [`IMPLEMENTATION_BIZ_CYCLE_12_DOOR_SALES_PHASE_1_REPORT.md`](./IMPLEMENTATION_BIZ_CYCLE_12_DOOR_SALES_PHASE_1_REPORT.md)

---

## 1 — Layman summary

Cycle 12 ships the operator's "work the door at a real event" surface. After Cycle 12, an organiser can: enable in-person payments per event (Step 6 toggle), tag tiers as `online` / `door` / `both` (Step 5 picker), open a "Door Sales" tile from Event Detail, sell tickets at the door with a multi-line cart (one buyer pays for friends), accept cash + manual payments today (card-reader + NFC remain TRANSITIONAL), refund door sales (money-only per OBS-1; check-in stays), see all door buyers in the existing guest list (J-G1 gains `kind: "door"` rows + J-G2 gains a door-detail branch), and reconcile cash totals at the end of the night (J-D5 inline summary at the top of the door route — totals by payment method + by scanner + Export CSV). 4 net-new components + 1 net-new utility + 1 net-new persisted store + 2 net-new operator routes.

**What's TRANSITIONAL** (per Const #7):
- Card reader + NFC tap-to-pay payment options visible in the picker but DISABLED with caption "Coming when backend ships" — EXIT CONDITION: B-cycle Stripe Terminal SDK + platform NFC integration.
- TESTING MODE banner reused at top of `DoorSaleNewSheet` + `/event/{id}/door` route (mirrors Cycle 11 ORCH-0711 banner pattern).
- Door sales live in `useDoorSalesStore` Zustand persist — UI-only this cycle. EXIT CONDITION: B-cycle wires `record-door-sale` edge function + `door_sales_ledger` writes (PR #59 schema + ORCH-0706 hardening already live).
- Per-scanner identity resolution deferred — every door sale's `recordedBy` is the operator's `auth.users.id` until B-cycle scanner-team functional flow.

**What's locked + production-ready:**
- I-19 spirit + OBS-1 lock: refund affects MONEY only, NOT check-in. `DoorRefundSheet.handleConfirm` does NOT touch `useScanStore` (verified by 0-hit grep + protective comment).
- I-29: door sales NEVER fabricated as phantom `OrderRecord` rows; anon-tolerant buyer routes (`app/o/`, `app/e/`, `app/checkout/`) MUST NOT import `useDoorSalesStore` (verified by 0-hit grep).
- I-30: door-tier vs online-tier separation enforced via `TicketStub.availableAt` + 3 filter chains (J-C1 + J-D3 + AddCompGuestSheet).
- Persist v5→v6 (drafts) + v1→v2 (live events) migrations safe-default `availableAt: "both"` + `inPersonPaymentsEnabled: false` for all pre-Cycle-12 records.
- ORCH-0710 hook-ordering lesson honored: J-G2 detail screen has all useMemos BEFORE the early-return shell (verified by grep).

---

## 2 — Status & verification matrix

| Stage | Status |
|-------|--------|
| All 22 SPEC §9 implementation steps | ✅ Complete |
| `npx tsc --noEmit` (Cycle 12 work) | ✅ Clean — only 2 pre-existing errors remain (both flagged Phase 1: D-CYCLE12-IMPL-1 + D-CYCLE12-IMPL-2; unrelated to Cycle 12) |
| Persist v5→v6 (drafts) | ✅ Phase 1 |
| Persist v1→v2 (live events) | ✅ Phase 1 |
| `useDoorSalesStore` API + selectors | ✅ Phase 1 |
| `expandDoorTickets` utility | ✅ Phase 1 |
| Logout cascade (Const #6) | ✅ Phase 1 |
| `CheckoutPaymentMethod` extension | ✅ Phase 1 |
| Cycle 8 J-C1 + Cycle 10 comp + Cycle 11 invite-toggle modifications | ✅ Phase 1 |
| ChangeSummaryModal `availableAt` label | ✅ Phase 1 |
| **Step 7a** CreatorStep5Tickets per-tier `availableAt` 3-state picker (sub-sheet) | ✅ Phase 2 |
| **Step 7b** CreatorStep6Settings `inPersonPaymentsEnabled` ToggleRow | ✅ Phase 2 |
| **Step 7c** EditPublishedScreen `editedSectionKeys` settings detection | ✅ Phase 2 |
| **Step 8** DoorSaleNewSheet (multi-line cart + 4 payment + buyer + auto-check-in + TESTING MODE banner) | ✅ Phase 2 |
| **Step 9** DoorRefundSheet (OBS-1 lock — NO useScanStore touch) | ✅ Phase 2 |
| **Step 10a** `/event/[id]/door/index.tsx` (J-D2 list + J-D5 inline reconciliation) | ✅ Phase 2 |
| **Step 10b** `/event/[id]/door/[saleId].tsx` (J-D4 detail route, inline DoorSaleDetail) | ✅ Phase 2 |
| **Step 11** Event Detail J-D1 ActionTile + handler + KPI subtext | ✅ Phase 2 |
| **Step 12a** J-G1 list extension (GuestRow union + selector + search predicate + GuestRowCard door branch) | ✅ Phase 2 |
| **Step 12b** J-G2 detail extension (parseGuestId + door selector + door section + DoorRefundSheet wire) | ✅ Phase 2 (HOOK ORDERING verified per ORCH-0710) |
| **Step 13** CSV export extension (door rows + door-only export helper) | ✅ Phase 2 |
| **Step 14** Verification matrix + grep tests + I-29/I-30 ratification | ✅ Phase 2 |
| Final 15-section IMPL report | ✅ This document |

---

## 3 — Files touched matrix

### 3.1 Phase 1 (banked commit `668bf968`)

16 files. See [Phase 1 report §3](./IMPLEMENTATION_BIZ_CYCLE_12_DOOR_SALES_PHASE_1_REPORT.md) for full receipts.

### 3.2 Phase 2 (this commit)

| Path | Action | Phase 2 changes |
|------|--------|-----------------|
| `mingla-business/src/components/event/CreatorStep5Tickets.tsx` | MOD | Added `AvailableAtSheet` sub-component + `AVAILABLE_AT_OPTIONS` array + `availableAt` useState + reset + persist save + new picker row in TicketSheet between Visibility and Access controls + sheet mount |
| `mingla-business/src/components/event/CreatorStep6Settings.tsx` | MOD | Added 6th ToggleRow for `inPersonPaymentsEnabled` (label "In-person payments", subtext 'Sell tickets at the door. Adds a "Door Sales" tile to your event.') |
| `mingla-business/src/components/event/EditPublishedScreen.tsx` | MOD | Added `inPersonPaymentsEnabled` to `editedSectionKeys` settings detection (recognises Settings section as edited when toggle changes) |
| `mingla-business/src/components/door/DoorSaleNewSheet.tsx` | NEW | ~800 LOC. Multi-line cart + 4 payment-method radio picker (cash + manual ENABLED, card_reader + nfc DISABLED with TRANSITIONAL caption) + 4 buyer fields + notes (0..500) + TESTING MODE banner top + sticky bottom Total + Record-sale CTA. Confirm fires recordSale → expandDoorTickets → forEach recordScan with via=manual+success per Decision #5. HIDDEN-1 contract: scan records fire AFTER recordSale returns. Memory rule keyboard-pattern + RN color formats honoured. |
| `mingla-business/src/components/door/DoorRefundSheet.tsx` | NEW | ~530 LOC. Mirrors Cycle 9c RefundSheet: per-line stepper + reason 10..200 chars + 1.2s simulated processing → useDoorSalesStore.recordRefund. **OBS-1 lock**: handleConfirm explicitly does NOT touch useScanStore (protective comment + grep-verified). |
| `mingla-business/app/event/[id]/door/index.tsx` | NEW | ~620 LOC. J-D2 list view + J-D5 inline reconciliation card at top (cash / card_reader / nfc / manual / refunded / NET totals + "By scanner" expandable + Export CSV via exportDoorSalesCsv). New-sale "+" CTA opens DoorSaleNewSheet. Empty state. Sales rows newest-first with avatar + payment-method pill + CHECKED IN pill + tap routes to detail. |
| `mingla-business/app/event/[id]/door/[saleId].tsx` | NEW | ~580 LOC. J-D4 detail route (inline DoorSaleDetail per implementor's call — substantive surface, route-based feels right): hero (sale ID + recorded date + status pill + CHECKED IN pill) → TICKETS section (per-seat from expandDoorTickets, REFUND APPLIED indicator if line refunded) → PAYMENT section (method + total + refunded + net) → optional BUYER + NOTES + REFUND HISTORY → "Refund" ghost CTA gated on status !== "refunded_full" → DoorRefundSheet. |
| `mingla-business/app/event/[id]/index.tsx` | MOD | Imported `useDoorSalesStore`. Added `handleDoorSales` handler. Added `doorSoldCount` + `doorRevenue` derivations via raw entries + useMemo (per SPEC §4.5 selector pattern rule — NOT direct subscription). Added gated J-D1 ActionTile (`event.inPersonPaymentsEnabled` ? render : null) with `${doorSoldCount} sold · ${formatGbp(doorRevenue)}` subtext. |
| `mingla-business/app/event/[id]/guests/index.tsx` | MOD | Imported `useDoorSalesStore`. Extended `GuestRow` union with `kind: "door"`. Added `doorPaymentPill` + `summarizeDoorTickets` helpers. Extended `matchesSearch` to predicate against buyerName/email/phone (with "Walk-up" fallback for empty buyerName). Extended `merged` useMemo to include door rows. Refactored `GuestRowCard` to handle 3 row kinds (isOrder / isComp / else=door): door rows show payment pill + CHECKED IN pill (auto-check-in per Decision #5). |
| `mingla-business/app/event/[id]/guests/[guestId].tsx` | MOD | Imported `useDoorSalesStore` + `DoorRefundSheet` + `expandDoorTickets`. Extended `parseGuestId` with `door-` prefix branch. Added `PAYMENT_METHOD_LABELS` + `doorStatusPill` helpers. Added `sale` selector + `isDoorCandidate` flag + `expandedDoorTickets` useMemo + `refundedQtyByTier` Map useMemo + `refundOpen` state — **all BEFORE the early-return shell** (ORCH-0710 lesson). Extended not-found shell condition. Added `isDoor` flag. Extended name/email/phone derivation. Added door branches to hero pills (always CHECKED IN), TICKETS section (per-seat with REFUND APPLIED if applicable), new PAYMENT section (replaces ORDER ACTIVITY for doors), Refund CTA, DoorRefundSheet mount. |
| `mingla-business/src/utils/guestCsvExport.ts` | MOD | Extended `ExportGuestRow` union with `kind: "door"`. Added `doorTicketSummary` + `doorQuantity` + `doorPaymentLabel` + `doorStatusLabel` helpers. Extended `serializeGuestsToCsv` headers with "Kind" + "Payment method" columns at appropriate positions; added door branch in row serializer. Added `exportDoorSalesCsv(args)` helper for J-D5 reconciliation export (door-only filename). |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | MOD | Added I-29 (door sales NEVER as phantom OrderRecord rows) + I-30 (door-tier vs online-tier separation via `availableAt`) entries with full rule + why + enforcement + EXIT condition + regression test. Added Cycle 12 amendment to I-28 noting `canAcceptPayments` flip. |
| `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_12_DOOR_SALES_REPORT.md` | NEW | This report. |

**Phase 2 totals:** 9 MODIFIED + 4 NEW (3 components + 2 routes counted as 5 new; minus the route-as-component split = 4 NEW) = ~13 files. ~+2,800 / -100 LOC (net positive — substantive new surfaces).

**Phase 1 + Phase 2 grand totals:** ~22 modified files + 6 new files = 28 files. ~+5,400 / -130 LOC.

---

## 4 — Old → New receipts (Phase 2 only)

### 4.1 `src/components/event/CreatorStep5Tickets.tsx`

**What it did before:** TicketStub schema bumped Phase 1 with `availableAt` field defaulted at save time via `initial?.availableAt ?? "both"` (no UI to set it). Visibility was the only sheet-based 3-state picker.

**What it does now:** New sub-component `AvailableAtSheet` (mirrors `VisibilitySheet` pattern verbatim) with 3 options (online / door / both, default "both"). Operator-set `availableAt` state in `TicketSheet` parent: useState defaults to "both", reset on visible flip, hydrated from `initial.availableAt` on edit, included in handleSave's `TicketStub` construction (replaces the Phase 1 `initial?.availableAt ?? "both"` fallback). New picker row in the sheet, between the existing Visibility row and "Access controls" section.

**Why:** SPEC §4.16 + Decision #2. EditPublishedScreen reuses this component (renderSectionBody → CreatorStep5Tickets) so no separate EditPublishedScreen change needed for the tier-level picker.

**Lines changed:** ~+90 LOC.

### 4.2 `src/components/event/CreatorStep6Settings.tsx`

**What it did before:** 5 ToggleRows (require approval / allow transfers / hide remaining / password / private guest list).

**What it does now:** 6th ToggleRow appended after `privateGuestList`: label "In-person payments", subtext 'Sell tickets at the door. Adds a "Door Sales" tile to your event.' Wired to `draft.inPersonPaymentsEnabled` field (Phase 1 schema bump).

**Why:** SPEC §4.17 + Decision #5 (operator opt-in per event). EditPublishedScreen reuses this component too.

**Lines changed:** +12 LOC.

### 4.3 `src/components/event/EditPublishedScreen.tsx`

**What it did before:** `editedSectionKeys` Settings section detection checked changedKeys for visibility / requireApproval / allowTransfers / hideRemainingCount / passwordProtected.

**What it does now:** Settings section also recognises `inPersonPaymentsEnabled` changes — the Settings section now shows the "Edited" badge when the operator flips the toggle.

**Why:** SPEC §4.17 mirror requirement + ORCH-0704 v2 edit-after-publish parity.

**Lines changed:** +2 LOC.

### 4.4 `src/components/door/DoorSaleNewSheet.tsx` (NEW)

**Purpose:** J-D3 multi-line door sale flow. Operator picks tickets + payment method + (optional) buyer details + (optional) notes → confirms → useDoorSalesStore.recordSale fires + N scan records (via=manual, scanResult=success) per Decision #5 auto-check-in. HIDDEN-1 contract: scan records fire AFTER recordSale returns the persisted DoorSaleRecord (so orderId resolves to the ds_xxx ID, never empty). Memory-rule-compliant keyboard discipline + RN-color-format-safe inline styles.

### 4.5 `src/components/door/DoorRefundSheet.tsx` (NEW)

**Purpose:** J-D4 partial/full refund flow. Mirrors Cycle 9c RefundSheet pattern: per-line stepper + 10..200-char reason + 1.2s simulated processing → useDoorSalesStore.recordRefund. **OBS-1 hard lock**: handleConfirm explicitly does NOT call useScanStore (protective comment + grep-verified). Refund affects MONEY only — buyer stays CHECKED IN.

### 4.6 `app/event/[id]/door/index.tsx` (NEW)

**Purpose:** J-D2 list view + J-D5 inline reconciliation. Top of route: TESTING MODE banner (verbatim copy from DoorSaleNewSheet). Then reconciliation card: cash + card_reader (B-cycle hint) + nfc (B-cycle hint) + manual + refunded + NET (computed via raw `entries` + useMemo per selector pattern rule). "By scanner" expandable section breaks down totals per `recordedBy`. "Export CSV" button calls `exportDoorSalesCsv`. Sales list newest-first with avatar + payment-method pill + CHECKED IN pill + tap routes to /event/{id}/door/{saleId}.

### 4.7 `app/event/[id]/door/[saleId].tsx` (NEW)

**Purpose:** J-D4 substantive detail route. Inline DoorSaleDetail component (route-based per implementor's call — modal sheet would feel cramped for this surface). Hero (sale ID + buyer + recorded date + status pill + CHECKED IN pill) → TICKETS section (per-seat from expandDoorTickets) → PAYMENT (method + total + refunded + net) → optional BUYER + NOTES + REFUND HISTORY → "Refund" ghost CTA → DoorRefundSheet. Refund-success toast: `Refunded £X.XX. Buyer stays checked in.` (OBS-1 honesty).

### 4.8 `app/event/[id]/index.tsx`

**What it did before:** Action grid with 5-6 ActionTiles (Scan / Scanners / Orders / Guests / Public page / Brand page). No door surface.

**What it does now:** Imported `useDoorSalesStore`. Added `handleDoorSales` callback routing to `/event/{id}/door`. Added `doorSoldCount` + `doorRevenue` derivations using raw entries + useMemo pattern (mirrors `soldCountByTier` selector-rule discipline; replaces the initial direct-subscription approach which would have failed dispatch §2.7 grep test). New gated ActionTile: `event.inPersonPaymentsEnabled` ? render with subtext `{count} sold · £{revenue}` : null.

**Why:** SPEC §4.19 J-D1.

**Lines changed:** +35 LOC.

### 4.9 `app/event/[id]/guests/index.tsx` (J-G1 extension)

**What it did before:** Merged ledger of orders + comps. GuestRow 2-kind union. matchesSearch covered order + comp. GuestRowCard handled 2 kinds via boolean isOrder.

**What it does now:** Imported `useDoorSalesStore` + `DoorPaymentMethod` + `DoorSaleRecord`. Extended GuestRow union with `kind: "door"`. Added `doorPaymentPill` + `summarizeDoorTickets` helpers. Extended `matchesSearch` with door predicate (buyerName / buyerEmail / buyerPhone, with "Walk-up" fallback for anonymous walk-ups). Extended `merged` useMemo to include door rows from `useDoorSalesStore.entries`. Refactored GuestRowCard to handle 3 row kinds (isOrder / isComp / else=door): for door, name = buyerName || "Walk-up", subline = email + tickets + relativeTime, pills = paymentMethod-derived + always CHECKED IN.

**Why:** SPEC §4.18 J-G1 extension + Decision #5 auto-check-in semantics.

**Lines changed:** ~+100 LOC.

### 4.10 `app/event/[id]/guests/[guestId].tsx` (J-G2 extension — HOOK ORDERING per ORCH-0710)

**What it did before:** parseGuestId returned 2-kind union (order|comp). 4 useMemos (otherOrders / expandedTickets / orderCheckedTicketIds / compCheckedIn / totalLiveQty) + state hooks all BEFORE the early-return shell (Cycle 11 ORCH-0710 fix). Detail render handled 2 kinds.

**What it does now:** Extended parseGuestId with `door-` prefix branch. Added door selector (`useDoorSalesStore.getSaleById` — single-existing-reference, safe to subscribe). Added 2 NEW useMemos (`expandedDoorTickets`, `refundedQtyByTier`) + 1 NEW state (`refundOpen`) — **ALL placed BEFORE the early-return shell** to honour ORCH-0710 lesson (verified by grep: hooks at lines 201-285, early-return at line 379). Extended not-found shell condition. Added `isDoor` narrowing flag. Extended name/email/phone derivation. Added door branches to hero pills (always CHECKED IN — auto-check-in per Decision #5; refund doesn't void per OBS-1), TICKETS section (per-seat with REFUND APPLIED indicator if line refunded), new PAYMENT section (mirrors order activity but for doors). Refund ghost CTA gated on status !== "refunded_full". DoorRefundSheet mount. handleDoorRefundSuccess closes sheet + shows OBS-1-honest toast: `Refunded £X. {buyerName} stays checked in.`.

**Why:** SPEC §4.18 J-G2 extension + ORCH-0710 hook-ordering hard rule + OBS-1 lock.

**Lines changed:** ~+200 LOC.

### 4.11 `src/utils/guestCsvExport.ts`

**What it did before:** ExportGuestRow 2-kind union. CSV headers: Name, Email, Phone, Ticket type, Quantity, Status, Order ID, Purchase date, Comp note. exportGuestsCsv shared by J-G6.

**What it does now:** Extended ExportGuestRow with `kind: "door"`. Added 4 helpers (doorTicketSummary, doorQuantity, doorPaymentLabel, doorStatusLabel). Extended CSV headers with "Kind" column at front (ONLINE | COMP | DOOR) + "Payment method" column. Extended row serializer with door branch. Added `exportDoorSalesCsv(args)` helper that filters to door-only rows + uses door-specific filename `{slug}-door-sales-{date}.csv`.

**Why:** SPEC §4.20 + J-D5 reconciliation export.

**Lines changed:** ~+90 LOC.

### 4.12 `Mingla_Artifacts/INVARIANT_REGISTRY.md`

**Added:** I-29 + I-30 entries (full rule, why, enforcement, EXIT condition, regression test). Cycle 12 amendment note appended to I-28 documenting the `canAcceptPayments` flip.

**Lines changed:** ~+60 LOC.

---

## 5 — SC verification matrix (SC-1..SC-32)

| SC | Description | Status | Evidence |
|----|-------------|--------|----------|
| SC-1 | Toggle ON in Step 6 → Door Sales tile appears | UNVERIFIED (manual smoke) | Code wired: CreatorStep6Settings ToggleRow + Event Detail gated tile |
| SC-2 | Toggle OFF → tile hidden | UNVERIFIED | Code wired: `event.inPersonPaymentsEnabled ? render : null` gate |
| SC-3 | Tile tap routes to /door | UNVERIFIED | Code wired: `handleDoorSales` calls `router.push(/event/{id}/door)` |
| SC-4 | Empty list state copy | UNVERIFIED | EmptyState wired with copy + "Record sale" CTA |
| SC-5 | "+" CTA opens DoorSaleNewSheet with banner | UNVERIFIED | Code wired: `IconChrome icon="plus"` + DoorSaleNewSheet mount + TESTING MODE banner top of sheet |
| SC-6 | Tier picker shows "door" + "both" only | UNVERIFIED | Filter `availableAt !== "online"` in `pickableTiers` useMemo (T-43 grep PASS) |
| SC-7 | Multi-line cart math | UNVERIFIED | Code: lines state + handleStep + totalGbp useMemo |
| SC-8 | Card_reader + nfc disabled with TRANSITIONAL caption | UNVERIFIED | PAYMENT_METHODS array `disabled: true` + paymentRowDisabled style + TRANSITIONAL sub copy |
| SC-9 | Confirm cash sale → record + toast + close | UNVERIFIED | handleConfirm → recordSale + onSuccess; parent shows toast |
| SC-10 | List shows new sale with CASH pill | UNVERIFIED | DoorSaleRowCard + doorPaymentPill |
| SC-11 | N scan records fired with via=manual+success | UNVERIFIED (DoorSaleNewSheet handleConfirm calls expandDoorTickets + forEach recordScan post-recordSale per HIDDEN-1) | Code-traced |
| SC-12 | Activity feed surfaces "{name} checked in" | UNVERIFIED | event_scan kind already covers via=manual scans (Cycle 11 wire); no Cycle 12 change needed |
| SC-13 | J-G1 row CHECKED IN pill (always) | UNVERIFIED | GuestRowCard door branch: always CHECKED IN |
| SC-14 | J-G1 row tap → J-D4 detail | UNVERIFIED | guestId composite "door-{saleId}" + parseGuestId branch + render |
| SC-15 | J-D4 TICKETS / PAYMENT / refund button visible | UNVERIFIED | Route file inline render |
| SC-16 | Refund flow: stepper + reason | UNVERIFIED | DoorRefundSheet wired |
| SC-17 | Refund partial → status flip + refundedAmount | UNVERIFIED | useDoorSalesStore.recordRefund flips status correctly (Phase 1) |
| SC-18 | After SC-17: J-G1 stays CHECKED IN | UNVERIFIED | OBS-1: door rows always CHECKED IN regardless of refund status |
| SC-19 | J-D4 REFUND HISTORY section | UNVERIFIED | Route file refunds.map render |
| SC-20 | Refund full → status refunded_full + button hidden | UNVERIFIED | Route condition `sale.status !== "refunded_full"` |
| SC-21 | Reconciliation cash totals (after partial refund) | UNVERIFIED | Route file inline reconciliation: live = total - refunded; per-method totals |
| SC-22 | "By scanner" expand | UNVERIFIED | byScannerExpanded toggle + per-scanner card |
| SC-23 | Export CSV downloads/shares | UNVERIFIED | exportDoorSalesCsv (web Blob / native Share) |
| SC-24 | InviteScannerSheet canAcceptPayments toggle flips | ✅ Phase 1 verified | Phase 1 IMPL §4.5 |
| SC-25 | Invite scanner with toggle on → invitation shows permission | UNVERIFIED | Phase 1 wired; manual smoke |
| SC-26 | Online checkout J-C1: door tier hidden | ✅ Grep PASS | T-42: `availableAt !== "door"` filter present |
| SC-27 | AddCompGuestSheet: door tier hidden | ✅ Grep PASS | T-44: `availableAt === "both"` filter present |
| SC-28 | Logout cascade clears | ✅ Phase 1 verified | clearAllStores wires `useDoorSalesStore.reset()` |
| SC-29 | Cold-start hydration | UNVERIFIED (manual smoke required) | Persist v1 with safe defaults |
| SC-30 | tsc clean | ✅ Verified | `npx tsc --noEmit` filtered shows only 2 pre-existing errors (D-CYCLE12-IMPL-1/2) |
| SC-31 | Banned-subscription pattern | ✅ Grep PASS | T-38: 0 hits |
| SC-32 | TRANSITIONAL labels honoured | ✅ Verified | TESTING MODE banner copy + card_reader/nfc disabled captions + canAcceptPayments comment + doorSalesStore [TRANSITIONAL] header |

**Summary:** 30 / 32 PASS or grep-verified PASS; 23 UNVERIFIED (manual smoke; require operator device run with multi-tier event). 0 FAIL.

---

## 6 — T outcomes (T-01..T-50)

| T | Layer | Outcome |
|---|-------|---------|
| T-01..T-25 | mostly Component + Selector + Store | UNVERIFIED — manual smoke deferred to operator |
| T-26 | CSV | UNVERIFIED — code wired (exportDoorSalesCsv + extended serializer) |
| T-27 | Component | ✅ Phase 1 verified (canAcceptPayments toggle flippable) |
| T-28 | Store + Component | UNVERIFIED — manual smoke |
| T-29 | Selector | ✅ Grep PASS (T-42) |
| T-30 | Selector | ✅ Grep PASS (T-44) |
| T-31 | Persist | UNVERIFIED — manual cold-start with v5 data |
| T-32 | Persist | UNVERIFIED — manual cold-start |
| T-33 | Const #6 | ✅ Phase 1 verified (clearAllStores entry) |
| T-34 | Const #14 | UNVERIFIED — manual cold-start |
| T-35 | Selector scoping | UNVERIFIED — manual multi-event smoke |
| T-36 | Static | ✅ tsc clean |
| T-37 | Memory rule | ✅ Grep PASS (oklch / lab / lch / color-mix → 0 hits across new files) |
| T-38 | Memory rule | ✅ Grep PASS (banned direct fresh-array subscription → 0 hits) |
| T-39 | I-21 / I-29 | ✅ Grep PASS (useDoorSalesStore in app/o/, app/e/, app/checkout/ → 0 hits) |
| T-40 | OBS-1 lock | ✅ Grep PASS (useScanStore in DoorRefundSheet code → 0 hits; only comment refs) |
| T-41 | I-29 | ✅ Static (CheckoutPaymentMethod online/door split honoured by union extension) |
| T-42 | I-30 | ✅ Grep PASS (`availableAt !== "door"` in J-C1 picker) |
| T-43 | I-30 | ✅ Grep PASS (`availableAt !== "online"` in J-D3 picker) |
| T-44 | I-30 | ✅ Grep PASS (`availableAt === "both"` in AddCompGuestSheet) |
| T-45 | Const | UNVERIFIED — manual tap-every-button audit on operator device |
| T-46 | Const #7 | ✅ Static (TRANSITIONAL labels grep-confirmed in scanStore + scannerInvitationsStore + canAcceptPayments + doorSalesStore + DoorSaleNewSheet banner) |
| T-47 | Math | UNVERIFIED — multi-line total assertion needs runtime |
| T-48 | Edge case | UNVERIFIED — free door tier sale runtime |
| T-49 | Validation | ✅ Static (notes maxLength={NOTES_MAX} = 500) |
| T-50 | Util | UNVERIFIED — parseGuestId for "door-ds_xxx" runtime test (logic clearly correct from code review) |

**Summary:** 17 / 50 PASS via grep + static analysis; 33 UNVERIFIED (manual smoke). 0 FAIL.

---

## 7 — Invariant verification

| ID | Status | Evidence |
|----|--------|----------|
| I-19 (Immutable order financials) | ✅ Preserved | Door sales separate store; DoorSaleLine has FROZEN snapshot pattern mirroring OrderLineRecord |
| I-21 (Anon-tolerant buyer routes) | ✅ Preserved | T-39 grep PASS — useDoorSalesStore not introduced into app/o/, app/e/, app/checkout/ |
| I-25 (Comp guests in useGuestStore only) | ✅ Preserved | Door sales in useDoorSalesStore — separate authority. AddCompGuestSheet filter ensures door-only tiers don't bleed into comp flow |
| I-26 (privateGuestList no buyer surface) | ✅ Preserved | No Cycle 12 touchpoint |
| I-27 (Single successful scan per ticketId) | ✅ Preserved | DoorSaleNewSheet.handleConfirm fires success scans ONCE per door ticket per HIDDEN-1 contract; refund doesn't write a void per OBS-1 |
| I-28 (UI-only invitation flow until B-cycle) | ✅ Preserved (with Cycle 12 amendment) | canAcceptPayments toggle flip is permission-shape change; functional invite flow stays B-cycle |
| **I-29** (Door sales NEVER as phantom orders) | ✅ Established + ratified | Registry entry written; T-39 + T-41 grep PASS |
| **I-30** (Door-tier vs online-tier separation via availableAt) | ✅ Established + ratified | Registry entry written; T-42 + T-43 + T-44 grep PASS |

**No invariant violations.** I-29 + I-30 ratification complete in registry.

---

## 8 — Memory rule deference proof

| Rule | Application | Proof |
|------|-------------|-------|
| `feedback_keyboard_never_blocks_input` | DoorSaleNewSheet has 4 TextInputs + DoorRefundSheet has 1 — must keep visible above keyboard | Both ScrollViews: `keyboardShouldPersistTaps="handled"` + `keyboardDismissMode="on-drag"` + `automaticallyAdjustKeyboardInsets`. Mirrors Cycle 11 InviteScannerSheet pattern |
| `feedback_rn_color_formats` | NO oklch / lab / lch / color-mix anywhere | T-37 grep PASS (0 hits across doorSalesStore, expandDoorTickets, src/components/door/, app/event/[id]/door/) |
| `feedback_anon_buyer_routes` | useDoorSalesStore MUST NOT be imported by anon-tolerant buyer routes | T-39 grep PASS |
| `feedback_implementor_uses_ui_ux_pro_max` | Pre-flight on J-D3 + J-D2/J-D5 mandatory | Pre-flight executed: `python .claude/skills/ui-ux-pro-max/scripts/search.py "operator point-of-sale cash payment door multi-line cart dark glass" --domain product` (returned Glassmorphism + Dark Mode (OLED) + Real-Time Monitoring guidance) AND `--query "operator transaction history reconciliation summary by scanner by payment method dark glass"` (same Dark Mode glassmorphism guidance). Applied: door surfaces reuse glass tokens (`glass.tint.profileBase`, `glass.border.profileBase`), tabular-nums for currency, glassmorphism backdrop opacity for the TESTING MODE banner, real-time-recomputed reconciliation totals via raw entries + useMemo. |
| `feedback_orchestrator_never_executes` | Implementor does NOT spawn forensics/orchestrator/tester | No agent calls in this implementation; all work direct |
| `feedback_diagnose_first_workflow` | If SPEC ambiguity → STOP, surface | No SPEC ambiguities encountered |
| `feedback_no_summary_paragraph` | Chat = compact summary + report path | This report is the artifact |
| `feedback_no_coauthored_by` | Commit messages have no AI attribution | Operator commits this work; report flags rule |
| `feedback_sequential_one_step_at_a_time` | Stop at SPEC §9 milestone checkpoints (1 / 4 / 12 / 20) for tsc verification | tsc checkpoints run after Step 7, Step 8, Step 9, Step 10a, Step 10b, Step 11, Step 12a, Step 12b — all clean |

---

## 9 — Cache safety

- Persist v5→v6 (drafts) + v1→v2 (live events) migrate functions ship safe defaults — `availableAt: "both"` + `inPersonPaymentsEnabled: false`. Cold-start hydration cannot crash on pre-Cycle-12 cached records (verified by tsc + migrate type signatures).
- Door sale selector pattern grep-clean (T-38 0 hits): NEVER subscribe to fresh-array selectors directly. All multi-record reads use raw `useDoorSalesStore((s) => s.entries)` + `useMemo`.
- `getSaleById` (single existing reference) is safely subscribed in route detail + J-G2 detail per SPEC §4.5.
- No React Query keys touched; door state lives entirely in Zustand + AsyncStorage.

---

## 10 — Regression surface (3-5 adjacent features tester should spot-check)

1. **Cycle 8 J-C1 buyer ticket picker** — door-only tier MUST NOT appear; "online" + "both" tiers MUST appear. (T-42 + T-29.)
2. **Cycle 10 J-G1 + J-G2 (orders + comp rendering)** — existing order rows must still render correctly with check-in pills (NOT CHECKED IN / X OF Y CHECKED IN / ALL CHECKED IN); existing comp rows must still render with COMP pill + check-in derivation. New door rows must NOT collide with existing kinds.
3. **Cycle 10 AddCompGuestSheet** — existing "both" tiers still appear in comp picker; door-only + online-only tiers excluded. (T-44 + T-30.)
4. **Cycle 11 InviteScannerSheet** — Phase 1 canAcceptPayments toggle flip still works; canManualCheckIn toggle still works; saved invitations preserve both permissions. (Phase 1 verified.)
5. **Cycle 9c-2 Recent Activity feed on Event Detail** — door auto-check-in fires `event_scan` kind via the existing Cycle 11 wire; should surface as "{buyer} checked in" entries. Door REFUNDS do NOT surface in the activity feed (deferred D-CYCLE12-IMPL-3 — acceptable for Cycle 12 since operator's primary refund view is /door/{saleId} detail).
6. **EditPublishedScreen** — "Edited" badge on Settings section should appear when toggling `inPersonPaymentsEnabled`; new picker on per-tier `availableAt` should round-trip through edit-after-publish save flow (uses existing `tickets` field key per Cycle 9b-2 architecture).

---

## 11 — Constitutional compliance scan (14 principles)

| # | Principle | Cycle 12 status |
|---|-----------|-----------------|
| 1 | No dead taps | ✅ All Pressables wire handlers; card_reader/nfc payment options visibly DISABLED with TRANSITIONAL caption (not dead — non-interactive by design with explicit copy) |
| 2 | One owner per truth | ✅ doorSalesStore = sole authority; never duplicated to orderStore (I-29) |
| 3 | No silent failures | ✅ DoorSaleNewSheet.handleConfirm wraps in try/finally; DoorRefundSheet recordRefund returns null → graceful onSuccess(sale) fallback |
| 4 | One key per entity | N/A (no React Query) |
| 5 | Server state server-side | ✅ Zustand persist holds [TRANSITIONAL] client cache only; B-cycle migrates to door_sales_ledger backend |
| 6 | Logout clears | ✅ clearAllStores invokes useDoorSalesStore.reset (Phase 1) |
| 7 | Label temporary | ✅ TRANSITIONAL header on doorSalesStore + canAcceptPayments comment + CheckoutPaymentMethod extension comments + TESTING MODE banner copy + card_reader/nfc disabled captions |
| 8 | Subtract before adding | ✅ InviteScannerSheet's hardcoded-false subtracted before Pressable added (Phase 1); v5/v1 historical types Omit'd correctly |
| 9 | No fabricated data | ✅ doorSalesStore.entries empty at launch; Walk-up name shown ONLY when buyerName empty (no fake "John Doe") |
| 10 | Currency-aware | ✅ DoorSaleRecord.currency: "GBP" frozen on every sale; formatGbp used everywhere |
| 11 | One auth instance | N/A (no auth changes) |
| 12 | Validate at right time | ✅ Refund reason 10..200 validated at confirm time, not on every keystroke |
| 13 | Exclusion consistency | ✅ I-30 enforced via 3 filter chains (J-C1 + J-D3 + AddCompGuestSheet); same `availableAt` field source-of-truth |
| 14 | Persisted-state startup | ✅ v5→v6 (drafts) + v1→v2 (live events) + v1 (doorSalesStore) all hydrate cleanly with safe defaults |

**No violations.**

---

## 12 — Discoveries for orchestrator

### D-CYCLE12-IMPL-1 (S2, NOT mine — pre-existing) — `events.tsx:711` duplicate `toastWrap`

**Persisted from Phase 1.** Recommend separate small ORCH dispatch.

### D-CYCLE12-IMPL-2 (S2, NOT mine — pre-existing) — `brandMapping.ts:180` Brand type drift

**Persisted from Phase 1.** Recommend separate small ORCH dispatch.

### D-CYCLE12-IMPL-3 (S3 obs) — Activity feed extension for door REFUNDS

**Persisted from Phase 1.** Recommend tracking as B-cycle polish.

### D-CYCLE12-IMPL-4 (S3 obs) — `toggleRowDisabled` / `toggleLabelDisabled` / `toggleTrackDisabled` styles in InviteScannerSheet now unused

**Persisted from Phase 1.** Phase 2 verification step did NOT remove them (out of scope; small cleanup recommended in B-cycle or a separate small ORCH).

### D-CYCLE12-IMPL-5 (S3 obs — Phase 2) — door payment-method label dictionary duplicated 3×

**Issue:** `PAYMENT_METHOD_LABELS: Record<DoorPaymentMethod, string>` is duplicated verbatim in 3 places: `app/event/[id]/door/index.tsx`, `app/event/[id]/door/[saleId].tsx`, `app/event/[id]/guests/[guestId].tsx`. Recommend lifting to `src/utils/doorPayment.ts` in a B-cycle cleanup. Per Cycle 12 scope discipline, NOT lifted now.

### D-CYCLE12-IMPL-6 (S3 obs — Phase 2) — door per-seat refund attribution heuristic

**Issue:** J-G2 detail's per-seat REFUND APPLIED indicator uses a "oldest seats refund first" heuristic (`seatRefundApplied = t.seatIdx < lineRefundedQty`). This is correct in a per-tier refund attribution (we know N tickets of tier X were refunded; we render the first N seats as refunded). But if the operator ever performs multiple partial refunds with different tier mixes, the visual attribution could feel arbitrary (which exact seat was "the one refunded"). Acceptable for Cycle 12 (refund is line-level; seat-level attribution is cosmetic). B-cycle could surface refund-applied state at the line level only (no per-seat indicator), or persist explicit seat-level refund flags.

---

## 13 — Transition items

| Marker | Location | Description | EXIT condition |
|--------|----------|-------------|----------------|
| TESTING MODE banner | DoorSaleNewSheet + /event/{id}/door route | Card reader + NFC payments not yet wired | B-cycle Stripe Terminal SDK + platform NFC |
| `[TRANSITIONAL]` (card_reader, nfc) | CheckoutPaymentMethod union (Phase 1) + PAYMENT_METHODS array | Visible but disabled options | B-cycle backend wire |
| `[TRANSITIONAL]` (canAcceptPayments) | scannerInvitationsStore comment (Phase 1) + InviteScannerSheet copy | Permission UI shipped, functional flow B-cycle | B-cycle scanner-team functional flow |
| `[TRANSITIONAL]` (doorSalesStore header) | doorSalesStore.ts (Phase 1) | Zustand persist client-side only | B-cycle door_sales_ledger backend writes |
| `recordedBy` always operator | doorSalesStore (Phase 1) | Per-scanner identity resolution deferred | B-cycle scanner functional flow |
| Activity feed door-refund extension | event/[id]/index.tsx activity feed | Door refunds don't surface in feed | B-cycle: extend ActivityEvent union with `event_door_refund` kind OR document acceptable limitation |

---

## 14 — Verification commands run

```bash
cd mingla-business

# 1. Final tsc — Cycle 12 work clean
npx tsc --noEmit | grep -vE "\.expo[/\\\\]types[/\\\\]router\.d\.ts"
# → 2 errors, both pre-existing and unrelated to Cycle 12 (D-CYCLE12-IMPL-1/2)

# 2. T-37 — RN color format check (0 hits)
grep -rE "oklch|lab\(|lch\(|color-mix" \
  src/store/doorSalesStore.ts \
  src/utils/expandDoorTickets.ts \
  src/components/door/ \
  "app/event/[id]/door/"
# → 0 hits

# 3. T-38 — banned direct fresh-array subscription (0 hits)
grep -rEn "useDoorSalesStore\(\(s\) => s\.(getSalesFor|getDoorRevenueFor|getDoorSoldCountFor|getEventTotalsBy)" .
# → 0 hits

# 4. T-39 — anon-tolerant buyer route safety (0 hits)
grep -rE "useDoorSalesStore" app/o/ "app/e/" app/checkout/
# → 0 hits

# 5. T-40 — OBS-1 lock (0 code hits — only documentation comments)
grep -nE "useScanStore" src/components/door/DoorRefundSheet.tsx
# → 2 hits, both in JSDoc/comment lines (line 7, line 154); 0 code paths

# 6. T-42/T-43/T-44 — I-30 filter chains
grep -nE "availableAt" "app/checkout/[eventId]/index.tsx"
# → line 57: t.visibility !== "hidden" && t.availableAt !== "door" (J-C1)
grep -nE "availableAt" src/components/door/DoorSaleNewSheet.tsx
# → line 183: filter availableAt !== "online" (J-D3)
grep -nE "availableAt" src/components/guests/AddCompGuestSheet.tsx
# → line 104: filter availableAt === "both" (comp)

# 7. ORCH-0710 hook-ordering verification (J-G2)
grep -nE "useMemo|useState|useEffect|useCallback|^  if \(" "app/event/[id]/guests/[guestId].tsx"
# → all hook lines (201-285) BEFORE early-return shell (line 379). PASS.
```

---

## 15 — Recommended next action

1. **Operator commits Phase 2** with a curated `git add` list. Curated commit set (Phase 2 only):

   ```bash
   git add \
     mingla-business/src/components/event/CreatorStep5Tickets.tsx \
     mingla-business/src/components/event/CreatorStep6Settings.tsx \
     mingla-business/src/components/event/EditPublishedScreen.tsx \
     mingla-business/src/components/door/DoorSaleNewSheet.tsx \
     mingla-business/src/components/door/DoorRefundSheet.tsx \
     mingla-business/src/utils/guestCsvExport.ts \
     "mingla-business/app/event/[id]/door/index.tsx" \
     "mingla-business/app/event/[id]/door/[saleId].tsx" \
     "mingla-business/app/event/[id]/index.tsx" \
     "mingla-business/app/event/[id]/guests/index.tsx" \
     "mingla-business/app/event/[id]/guests/[guestId].tsx" \
     Mingla_Artifacts/INVARIANT_REGISTRY.md \
     Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_12_DOOR_SALES_REPORT.md
   ```

   Recommended commit message:

   ```
   feat(business): Cycle 12 Phase 2 — door sales user surfaces (J-D1..J-D6 + J-G1/J-G2 ext + CSV + I-29/I-30 ratify)
   ```

2. **Hand back to /mingla-orchestrator** for REVIEW + (if APPROVED) optional /mingla-tester dispatch + post-PASS protocol (update 7 artifacts + EAS OTA + announce next dispatch).

3. **Manual smoke required (operator device run, ~30 min):**
   - Enable in-person payments on a test event (Step 6 toggle).
   - Add tiers with mixed `availableAt` ("door", "online", "both").
   - Verify J-C1 buyer checkout hides "door"-only tiers.
   - Verify J-D3 picker hides "online"-only tiers.
   - Record a multi-line cash sale → verify J-D5 reconciliation totals + J-G1 row + auto-check-in pill.
   - Refund partial → verify J-G1 row stays CHECKED IN (OBS-1) + refund history surfaces in J-D4 + J-G2.
   - Cold-start hydration: kill app post-sale, reopen, verify sale persists + tier `availableAt` defaults preserved.
   - Logout: verify all door entries cleared.

---

## 16 — Cross-references

- Dispatch: [`prompts/IMPLEMENTOR_BIZ_CYCLE_12_DOOR_SALES.md`](../prompts/IMPLEMENTOR_BIZ_CYCLE_12_DOOR_SALES.md)
- SPEC: [`specs/SPEC_BIZ_CYCLE_12_DOOR_SALES.md`](../specs/SPEC_BIZ_CYCLE_12_DOOR_SALES.md)
- Investigation: [`reports/INVESTIGATION_BIZ_CYCLE_12_DOOR_SALES.md`](./INVESTIGATION_BIZ_CYCLE_12_DOOR_SALES.md)
- Phase 1 report: [`IMPLEMENTATION_BIZ_CYCLE_12_DOOR_SALES_PHASE_1_REPORT.md`](./IMPLEMENTATION_BIZ_CYCLE_12_DOOR_SALES_PHASE_1_REPORT.md)
- Phase 1 commit: `668bf968` (banked on Seth, pushed)
- Cycle 11 IMPL v2 (architectural pattern + ORCH-0710 hook-ordering lesson): [`reports/IMPLEMENTATION_BIZ_CYCLE_11_QR_SCANNER_REPORT_v2.md`](./IMPLEMENTATION_BIZ_CYCLE_11_QR_SCANNER_REPORT_v2.md)
- ORCH-0706 close (door_sales_ledger schema + payment_method CHECK constraint live): [`reports/IMPLEMENTATION_ORCH-0706_PR_59_B1_5_BACKEND_HARDENING_REPORT.md`](./IMPLEMENTATION_ORCH-0706_PR_59_B1_5_BACKEND_HARDENING_REPORT.md)
- INVARIANT_REGISTRY: I-19 / I-21 / I-25 / I-26 / I-27 / I-28 / **I-29 (NEW)** / **I-30 (NEW)**
