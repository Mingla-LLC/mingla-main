# INVESTIGATION — BIZ Cycle 13 (End-of-Night Reconciliation Report)

**Mode:** INVESTIGATE (no SPEC dispatched yet — operator decisions surface back via §6 first)
**Date:** 2026-05-04
**Surface:** Mingla Business mobile app (`mingla-business/`) — operator-side cross-source reconciliation
**Dispatch:** [`prompts/FORENSICS_BIZ_CYCLE_13_END_OF_NIGHT_RECONCILIATION.md`](../prompts/FORENSICS_BIZ_CYCLE_13_END_OF_NIGHT_RECONCILIATION.md)
**Canonical epic:** [`github/epics/cycle-13.md`](../github/epics/cycle-13.md) — 3 journeys (J-R1 + J-R2 + J-R3), ~24h estimated
**Confidence:** **H** overall · H per thread (every data source read, every selector verified, blast radius mapped)

---

## 1 — Plain-English summary (5 lines max)

After an event ends, organisers manually cross-reference 4 stores (orders + door sales + comp guests + scans) to know "did the night make money? did everyone get in?". Cycle 13 ships ONE screen that joins all 4 sources, surfaces tickets-sold + revenue + scans + discrepancies + settlement-stub, and exports the reconciled night. Recommended: **single ~24h cycle, CSV-only export, ADVISORY-only discrepancies, new `app/event/[id]/reconciliation.tsx` route auto-suggested from Past-status events**, gated `finance_manager+` (rank 30) per `MIN_RANK.VIEW_RECONCILIATION` (NEW). PDF defers to B-cycle email-attachment via Resend; Cycle 12 J-D5 door-side card stays untouched; the new screen is the cross-source SUPERSET.

---

## 2 — Investigation manifest (every file read in trace order)

### 2.1 Anchor / scope
| # | File | Reason |
|---|------|--------|
| 1 | [`Mingla_Artifacts/github/epics/cycle-13.md`](../github/epics/cycle-13.md) | Canonical Cycle 13 scope per `reference_cycle_roadmap_authoritative_source` memory rule. |
| 2 | [`Mingla_Artifacts/prompts/FORENSICS_BIZ_CYCLE_13_END_OF_NIGHT_RECONCILIATION.md`](../prompts/FORENSICS_BIZ_CYCLE_13_END_OF_NIGHT_RECONCILIATION.md) | Dispatch — 3 thread structure + cross-cutting concerns + hard constraints. |

### 2.2 Data sources (Cycle 9c + 10 + 11 + 12)
| # | File | Reason |
|---|------|--------|
| 3 | `mingla-business/src/store/orderStore.ts` | OrderRecord shape — `lines` + `refunds` + `paymentMethod` + `status` + selectors `getSoldCountForEvent` / `getRevenueForEvent` / `getSoldCountByTier`. |
| 4 | `mingla-business/src/store/doorSalesStore.ts` | DoorSaleRecord shape — `lines` + `refunds` + `paymentMethod` (cash/card_reader/nfc/manual) + `recordedBy` (per-scanner) + selectors `getDoorRevenueForEvent` / `getDoorSoldCountForEvent`. |
| 5 | `mingla-business/src/store/guestStore.ts` | CompGuestEntry shape — comp tickets + `addedAt` / `addedBy`; one comp = one ticket. |
| 6 | `mingla-business/src/store/scanStore.ts` | ScanRecord shape — `scanResult` (success/duplicate/wrong_event/not_found/void/cancelled_order) + `via` (qr/manual) + `scannerUserId` + auto-check-in scans for door + manual-check-in scans for comps. |
| 7 | `mingla-business/src/store/liveEventStore.ts` | `LiveEventStatus`, `endedAt`, `cancelledAt`, `endsAt` (event end-time field). |
| 8 | `mingla-business/src/utils/expandTicketIds.ts` | Online ticket-ID format — `tkt_<orderSuffix>_<lineIdx>_<seatIdx>` for scan-vs-sale validation. |
| 9 | `mingla-business/src/utils/expandDoorTickets.ts` | Door ticket-ID format — `dt_<saleSuffix>_<lineIdx>_<seatIdx>` (deliberately distinct prefix per HIDDEN-2). |

### 2.3 Existing reconciliation surfaces (Cycle 12 partial coverage)
| # | File | Reason |
|---|------|--------|
| 10 | `mingla-business/app/event/[id]/door/index.tsx` | J-D5 door-side reconciliation card (cash/card_reader/nfc/manual + refunded + NET, by-scanner expand, Export CSV). The visual + structural pattern Cycle 13 SUPERSETS. |
| 11 | `mingla-business/src/utils/guestCsvExport.ts` | CSV serializer — `serializeGuestsToCsv` (3-kind union: order/comp/door) + `exportDoorSalesCsv` + `exportGuestsCsv`. Native = `Share.share({ message })` (TRANSITIONAL D-CYCLE10-IMPL-1); Web = Blob anchor-download. |
| 12 | `mingla-business/app/event/[id]/index.tsx` | Event Detail — `deriveLiveStatus(event)` lifecycle derivation (line 191) + 8-stream activity feed (line 476). |
| 13 | `mingla-business/src/components/event/EventDetailKpiCard.tsx` | Existing `REVENUE` / `PAYOUT` KPI card pattern; informs Cycle 13 hero shape. |

### 2.4 Permissions plumbing (Cycle 13a + 13b prerequisite)
| # | File | Reason |
|---|------|--------|
| 14 | `mingla-business/src/utils/permissionGates.ts` | `MIN_RANK` constants — REFUND_DOOR_SALE / REFUND_ORDER both `finance_manager` (30). NO `VIEW_RECONCILIATION` yet — Cycle 13 establishes. |
| 15 | `mingla-business/src/hooks/useCurrentBrandRole.ts` | Rank resolution chain (DB → stub-fallback). Cycle 13 reuses verbatim. |

### 2.5 Sibling routes (Cycle 13 reuses route shape)
| # | File | Reason |
|---|------|--------|
| 16 | `mingla-business/app/event/[id]/door/index.tsx` | TopBar + ScrollView + glass card + Pill primitive composition (mirror for J-R1). |

### 2.6 Implementation report cross-references
| # | File | Reason |
|---|------|--------|
| 17 | [`reports/IMPLEMENTATION_BIZ_CYCLE_12_DOOR_SALES_REPORT.md`](IMPLEMENTATION_BIZ_CYCLE_12_DOOR_SALES_REPORT.md) | I-29 + I-30 ratification + OBS-1 lock + HIDDEN-1 contract (door sale auto-fires N scan records). |
| 18 | [`reports/IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT_v3.md`](IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT_v3.md) | Selector pattern rule (raw entries + useMemo, never fresh-array subscriptions). |
| 19 | [`reports/IMPLEMENTATION_BIZ_CYCLE_10_GUEST_LIST_REPORT.md`](IMPLEMENTATION_BIZ_CYCLE_10_GUEST_LIST_REPORT.md) | I-25 (comp guests in `useGuestStore` only) + native CSV degradation D-CYCLE10-IMPL-1. |
| 20 | [`reports/IMPLEMENTATION_BIZ_CYCLE_11_QR_SCANNER_REPORT_v2.md`](IMPLEMENTATION_BIZ_CYCLE_11_QR_SCANNER_REPORT_v2.md) | ORCH-0710 hook ordering rule + I-27 single-scan-per-ticket. |
| 21 | [`reports/IMPLEMENTATION_BIZ_CYCLE_13B_PERMISSIONS_DEPTH_REPORT.md`](IMPLEMENTATION_BIZ_CYCLE_13B_PERMISSIONS_DEPTH_REPORT.md) | Q5 audit_log brand-admin RLS — DEFERRED for Cycle 13 (B-cycle territory). |

### 2.7 Static checks
| # | File | Reason |
|---|------|--------|
| 22 | `mingla-business/package.json` | Verify `expo-print` / `expo-sharing` / `expo-file-system` / `react-native-html-to-pdf` availability. **Result: NONE installed.** PDF feasibility implication for Thread 3. |
| 23 | Grep `mingla-business` for `reconciliation\|reconcile\|end-of-night\|endOfNight` | **Result: 4 hits** — all in Cycle 12 J-D5 surfaces (door route + DoorSaleNewSheet + utilities). NO existing route at `app/event/[id]/reconciliation*`. |
| 24 | Grep `mingla-business` for `no-show\|noShow\|no_show\|unaccounted\|discrepan` | **Result: 0 hits.** Cycle 13 establishes the discrepancy detection vocabulary. |

---

## 3 — Per-thread investigation

### 3.1 Thread 1 — J-R1 reconciliation summary screen 🔵

#### 3.1.1 Five-truth-layer cross-check

| Layer | Finding |
|-------|---------|
| **Docs** | `cycle-13.md` § Notes: "After an event ends, organisers need a single screen showing: total tickets sold (online vs door), total revenue (split by payment method), refund total, scanner activity (scans / dupes / no-shows), settlement status." `BUSINESS_PRD §6.2 + §7` calls reconciliation "critical for trust." |
| **Schema** | `LiveEvent.endedAt` (string\|null) — operator manually called End sales. `LiveEvent.cancelledAt` (string\|null) — operator cancelled. `LiveEvent.endsAt` (string\|null) — original event end-time set in wizard. `LiveEventStatus = "live" \| "cancelled" \| "ended"` — but the persisted `status` field ONLY toggles to `"cancelled"` (Cycle 9b-1 cancel flow); `"ended"` is reserved for future use. |
| **Code** | `deriveLiveStatus(event)` in `app/event/[id]/index.tsx:191-203` returns `"live" \| "upcoming" \| "past"` based on: `status==="cancelled"` → `past`; `endedAt!==null` → `past`; `now > eventDate + 24h` → `past`; in 4h-before-to-24h-after window → `live`; else `upcoming`. **This is the canonical "event ended" predicate.** `event.status` field never flips to `"ended"` in client code (verified by grep — only set in cancel handler). |
| **Runtime** | At runtime, the only way an event reaches `past` is one of: (a) operator taps "End ticket sales" → `endedAt` set; (b) operator cancels → `status: "cancelled" + cancelledAt` set; (c) 24h passes after `event.date`. All three handled by `deriveLiveStatus`. |
| **Data** | Local persisted Zustand state — 4 stores (`orderStore.v1` / `doorSalesStore.v1` / `guestStore.v1` / `scanStore.v1`). All entries are local only until B-cycle wires backend reads. |

#### 3.1.2 Cross-store data shape map (the critical join)

For a single `eventId`, the reconciliation surface needs:

```ts
// ---- Tickets sold (live = qty - refundedQty per line; cancelled orders excluded) ----
onlineLiveTickets   = orderStore.entries
  .filter(o => o.eventId === eventId && (o.status === "paid" || o.status === "refunded_partial"))
  .flatMap(o => o.lines)
  .reduce((sum, l) => sum + max(0, l.quantity - l.refundedQuantity), 0);

doorLiveTickets     = doorSalesStore.entries
  .filter(s => s.eventId === eventId)
  .flatMap(s => s.lines)
  .reduce((sum, l) => sum + max(0, l.quantity - l.refundedQuantity), 0);

compTickets         = guestStore.entries
  .filter(g => g.eventId === eventId)
  .length;  // 1 comp = 1 ticket per Cycle 10 design

totalLiveTickets    = onlineLiveTickets + doorLiveTickets + compTickets;

// ---- Revenue (live amount = total - refunded; cancelled orders contribute 0) ----
onlineRevenue       = orderStore.entries
  .filter(o => o.eventId === eventId && (o.status === "paid" || o.status === "refunded_partial"))
  .reduce((sum, o) => sum + max(0, o.totalGbpAtPurchase - o.refundedAmountGbp), 0);

doorRevenue         = doorSalesStore.entries
  .filter(s => s.eventId === eventId)
  .reduce((sum, s) => sum + max(0, s.totalGbpAtSale - s.refundedAmountGbp), 0);

grossRevenue        = onlineRevenue + doorRevenue;
// (comps contribute 0 — by design, comps are zero-priced).

// ---- Refunds (gross out + count) ----
onlineRefundedTotal = orderStore.entries
  .filter(o => o.eventId === eventId)
  .flatMap(o => o.refunds)
  .reduce((sum, r) => sum + r.amountGbp, 0);

doorRefundedTotal   = doorSalesStore.entries
  .filter(s => s.eventId === eventId)
  .flatMap(s => s.refunds)
  .reduce((sum, r) => sum + r.amountGbp, 0);

totalRefunded       = onlineRefundedTotal + doorRefundedTotal;

// ---- Per-method revenue (LIVE — net of refunds) ----
// Online methods: card | apple_pay | google_pay | free
// Door methods:   cash | card_reader | nfc | manual
// Refund split: per-line attribution exists in OrderRecord.lines[i].refundedAmountGbp
//   → revenuePerMethod = sum_of (totalGbpAtPurchase - refundedAmountGbp) per order grouped by paymentMethod
revenueByMethod = group by paymentMethod, sum max(0, total - refunded);

// ---- Scans ----
eventSuccessScans   = scanStore.entries
  .filter(s => s.eventId === eventId && s.scanResult === "success");

scanDups            = scanStore.entries
  .filter(s => s.eventId === eventId && s.scanResult === "duplicate").length;

scanWrongEvent      = scanStore.entries
  .filter(s => s.eventId === eventId && s.scanResult === "wrong_event").length;

scanNotFound        = scanStore.entries
  .filter(s => s.eventId === eventId && s.scanResult === "not_found").length;

scanVoid            = scanStore.entries
  .filter(s => s.eventId === eventId && s.scanResult === "void").length;

scanCancelled       = scanStore.entries
  .filter(s => s.eventId === eventId && s.scanResult === "cancelled_order").length;

// HIDDEN-1: door sales auto-fire success scans for each ticket at sale time
//   (per DoorSaleNewSheet.handleConfirm + Cycle 12 contract).
// Comp manual check-ins fire success scans with synthetic ticketId = comp.id.
// So eventSuccessScans naturally includes all 3 sources (online QR + door auto + comp manual).

// ---- "Checked-in" derivation (unique tickets actually scanned-success once) ----
// Per I-27 single-scan-per-ticket, each successful scan = one unique ticket.
// scanStore.recordScan does NOT enforce uniqueness — Cycle 11 client-side dup
// detection lives in scanner.tsx via getSuccessfulScanByTicketId. So in
// practice eventSuccessScans.length === unique-tickets-scanned IF the scanner
// flow is followed; but for safety, dedupe by ticketId:
uniqueScannedTickets = new Set(eventSuccessScans.map(s => s.ticketId)).size;

// ---- Per-scanner activity ----
scansByScanner = group eventSuccessScans by scannerUserId, count;

// ---- Discrepancy / unscanned ----
unscanned = totalLiveTickets - uniqueScannedTickets;
// Interpretation depends on event status:
//   live      → "X waiting" (still counting in)
//   past      → "X no-shows" (event ended; never showed)
```

**Selector rule:** every multi-record read MUST use raw `entries` + `useMemo` per Cycle 9c v2 + Cycle 12 lesson (banned: direct subscription to `getSalesForEvent` / `getOrdersForEvent` / `getCompEntriesForEvent` / `getScansForEvent` — they return fresh arrays and break `useSyncExternalStore` Object.is).

#### 3.1.3 Architectural options (route placement)

| Option | Tradeoffs |
|--------|-----------|
| **A. Inline-on-Event-Detail** (Past-status branch only) | Cleanest — operator already lands on Event Detail when checking on an ended event. But the Event Detail screen is already heavy (hero + 7-tile action grid + KPI card + ticket types + activity feed); adding ~300 LOC of reconciliation content makes a long scroll. Fragile vs `Status==="past"` switching mid-scroll if operator ends sales while viewing. |
| **B. New route `app/event/[id]/reconciliation.tsx`** (recommended) | Mirrors Cycle 12 J-D5 door route pattern. Linked from Event Detail via a "View end-of-night report" CTA that auto-renders for `past` events. Bounded scope; testable in isolation; clean URL surface for B-cycle deep-link from email. |
| **C. Auto-modal-on-event-end** | Triggers a modal the FIRST time operator opens Event Detail post-`endedAt`. Heavyweight UX; modals on data-rich screens feel awkward. Reject. |

**Recommendation: B. New route.** Rationale:
1. Existing precedent: Cycle 12 J-D5 already established the "domain-specific summary on a sub-route" pattern (`app/event/[id]/door/index.tsx`).
2. Hot-swap on lifecycle change (live → past while viewing) is naturally handled by route navigation, not conditional rendering inside an already-busy screen.
3. Audit-friendly: the URL `app/event/[id]/reconciliation` becomes a citeable artifact for accountant-handoff workflows + B-cycle email-attachment deep-link.
4. Scales to B-cycle additions (audit_log timeline, multi-day events) without bloating Event Detail.
5. Confidence: H.

#### 3.1.4 Auto-render trigger (lifecycle hook)

Two sub-questions:

**Q1: When does the "View end-of-night report" CTA appear on Event Detail?**
- Option α: ONLY on `status==="past"` events (auto-suggest at end-of-night).
- Option β: ALWAYS visible (live + upcoming + past) — operator can always view a partial reconciliation.

**Recommendation: β (always visible, gated by permission).** Live-status reconciliation is genuinely useful for ops mid-event ("how many in so far?"). Past-status enriches with refunds/cancellations + final totals. Restricting to past creates surprise UX ("where's the report? oh it appears 24h after?"). The screen handles all states gracefully (live = "X scanned of Y sold so far"). H confidence.

**Q2: Should the route auto-detect "ended" and surface a banner?**
- The reconciliation route reads `event.status` + `endedAt` + `cancelledAt` + `event.date` and adapts the headline copy:
  - `live` → "Live · X waiting"
  - `past`/`endedAt` → "Ticket sales ended · final reconciliation"
  - `past`/`cancelledAt` → "Event cancelled · refund/payout audit"
  - `upcoming` → "Pre-event · door sales running"

#### 3.1.5 Section breakdown (proposed UI shape)

```
RECONCILIATION (route) — Cycle 13 J-R1

┌────────────────────────────────────────────────────────────────┐
│ Chrome — back chev + "Reconciliation" title + Export icon       │
│                                                                 │
│ HEADLINE BANNER                                                 │
│   adaptive copy per status (live / past / cancelled / upcoming) │
│   subline: event name + date                                    │
│                                                                 │
│ ━━━━━━━━━━━━━━━━━━━ TICKETS ━━━━━━━━━━━━━━━━━━━                │
│   Online sold:       N  (£R)                                    │
│   Door sold:         N  (£R)                                    │
│   Comps:             N                                          │
│   ─────────────────                                             │
│   TOTAL LIVE:        N  ←── big number                          │
│                                                                 │
│ ━━━━━━━━━━━━━━━━━━━ REVENUE ━━━━━━━━━━━━━━━━━━━                │
│   Card (online):           £xx.xx                               │
│   Apple Pay:               £xx.xx                               │
│   Google Pay:              £xx.xx                               │
│   Cash (door):             £xx.xx                               │
│   Card reader (door):      £0.00 (B-cycle)                      │
│   NFC tap (door):          £0.00 (B-cycle)                      │
│   Manual (door):           £xx.xx                               │
│   Free + Comp:             0 paid · N count                     │
│   ─────────────────                                             │
│   GROSS:                   £xx.xx                               │
│   Refunded:               −£xx.xx (online + door split below)   │
│   ─────────────────                                             │
│   NET:                     £xx.xx ←── big                       │
│   Stripe fee (4% stub):   −£xx.xx                               │
│   PAYOUT (estimated):      £xx.xx                               │
│                                                                 │
│ ━━━━━━━━━━━━━━━━━━━ SCANS ━━━━━━━━━━━━━━━━━━━                  │
│   Scanned in:              N of M  (XX% checked in)             │
│   Unscanned:               N  ←── reframed as "no-shows" if past│
│   Duplicate scans:         N                                    │
│   Wrong event scans:       N                                    │
│   Not-found scans:         N                                    │
│   Voided scans:            N                                    │
│   By scanner ▸             expandable per Cycle 12 J-D5 pattern │
│                                                                 │
│ ━━━━━━━━━━━━━━━━━━━ DISCREPANCIES (advisory) ━━━━━━━━━━━━━━━━━ │
│   ⚠️  Auto-check-in mismatch: 2 door tickets recorded, 0 scans  │
│       (only renders if non-zero — silent when clean)            │
│   ⚠️  Method totals don't reconcile: £x.xx unattributed          │
│                                                                 │
│ ━━━━━━━━━━━━━━━━━━━ EXPORT ━━━━━━━━━━━━━━━━━━━                 │
│   [ Export reconciliation CSV ] ←── primary CTA                 │
│   [ Email PDF report ]          ←── DISABLED · "B-cycle"        │
└────────────────────────────────────────────────────────────────┘
```

**Operator decision needed (Thread 1):**
1. Route placement: **B (new route at `app/event/[id]/reconciliation.tsx`)** confirm? Cleanest match to Cycle 12 precedent.
2. Auto-render trigger: **β (always visible for permission-rank, copy adapts per status)** confirm?
3. Permission gate: NEW `MIN_RANK.VIEW_RECONCILIATION = finance_manager (30)` — confirm rank choice? Alternatives: `event_manager (40)` (more permissive but reconciliation is finance-flavoured) or `brand_admin (50)` (locked-down — only operator + admins).
4. Settlement-stub copy: PAYOUT uses existing 4% Stripe-fee stub from Event Detail KPI card. Keep TRANSITIONAL marker, EXIT = B-cycle Stripe API integration. Confirm acceptable?

**Blast radius (Thread 1):**
- 1 NEW route file (`app/event/[id]/reconciliation.tsx`) — ~600-700 LOC mirrored from `door/index.tsx`
- 1 MOD `app/event/[id]/index.tsx` — add CTA tile + handler (5-10 LOC)
- 1 MOD `src/utils/permissionGates.ts` — add `VIEW_RECONCILIATION` constant (1 line)
- 1 NEW utility `src/utils/reconciliation.ts` — pure aggregator joining 4 stores (~150 LOC; keeps screen reads-only)
- ZERO mutations to existing stores
- ZERO migrations
- ZERO new dependencies

---

### 3.2 Thread 2 — J-R2 discrepancy flag detection logic 🔵

#### 3.2.1 Discrepancy taxonomy (4 candidate types)

| # | Discrepancy | Detect | Severity | Block? |
|---|-------------|--------|----------|--------|
| **D1** | **Auto-check-in mismatch** (HIDDEN-1 contract violation) | For each `DoorSaleRecord`, expand `expandDoorTickets(saleId, lines)`. Then verify `scanStore.entries.find(s => s.ticketId === expandedId && s.scanResult === "success")` exists for each expected door ticketId. If any door ticket has no success scan → contract violation. | ADVISORY (warm-orange) | NO |
| **D2** | **Per-method total ≠ grand total** | Sum `revenueByMethod` and compare to `grossRevenue`. Should always be equal; if not, store-state corruption. | ADVISORY (warm-orange) | NO |
| **D3** | **Refund row exists but parent.status !== refunded_*** | For each OrderRecord with `refunds.length > 0`, status must be `refunded_full` or `refunded_partial`. Same check for DoorSaleRecord. Should always hold (recordRefund flips status atomically); failsafe only. | ADVISORY (warm-orange) | NO |
| **D4** | **Unscanned tickets** (live tickets minus scanned tickets) | `unscanned = totalLiveTickets - uniqueScannedTickets`. | INFORMATIONAL (NOT a discrepancy — reframed as "no-shows" on past events) | NO |

**Recommendation: ADVISORY-ONLY for ALL discrepancies.** Rationale:
- Operator can always export the reconciliation CSV as-is (auditor decides what to do).
- Cycle 13 has no "close event" lifecycle action that could be blocked (no current concept of "books closed").
- B-cycle backend writes will be the structural fix for HIDDEN-1 / sum integrity (server-side enforcement); Cycle 13's client-side detection is a tripwire, not a brake.
- Confidence: H.

**Interpretation note (D4 / unscanned):**
- On `live` status: surface as "X waiting" with neutral grey (operator hasn't admitted everyone yet).
- On `past` status: surface as "X no-shows" with quiet grey (they didn't come — not a "discrepancy", just a fact).
- NEVER as warm-orange — no-shows are reality, not data corruption.

#### 3.2.2 Discrepancy section visual treatment

```
DISCREPANCIES (only renders if non-zero)
  ⚠️  2 door tickets sold but never scanned in
       Likely cause: auto-check-in fired pre-recordSale (HIDDEN-1 contract violation)
       Recommended action: Manual verify with door scanner; B-cycle backend will reconcile.

  ⚠️  £0.50 unattributed across payment methods
       Sum-by-method (£100.00) doesn't equal grand revenue (£100.50).
       Likely cause: rounding in stub Stripe-fee derivation (verify in B-cycle).

(silent when clean — no false-positive UI noise)
```

**Operator decision needed (Thread 2):**
1. Discrepancy types: **D1 + D2 + D3 ADVISORY-only; D4 informational not discrepancy** confirm?
2. Visual severity: warm-orange (`accent.warm`) for D1/D2/D3 — reuse existing TRANSITIONAL palette? Confirm?
3. "No-shows" terminology on past events: confirm acceptable, OR prefer "Unscanned" (more neutral)?

**Blast radius (Thread 2):**
- D1 / D2 / D3 detection logic lives inside the `src/utils/reconciliation.ts` aggregator (no new files)
- Render section conditional on non-zero count
- Discrepancy strings hard-coded English (no i18n needed Cycle 13)
- Confidence: H.

---

### 3.3 Thread 3 — J-R3 export (PDF / CSV) 🟡

#### 3.3.1 Current state — CSV infrastructure ALREADY shipped

`mingla-business/src/utils/guestCsvExport.ts` exposes:
- `serializeGuestsToCsv(rows: ExportGuestRow[]) → string` — RFC 4180-quoted CSV. 11-column shape: `Kind, Name, Email, Phone, Ticket type, Quantity, Status, Payment method, Order/Sale ID, Date, Notes`. 3-kind union: `order \| comp \| door`.
- `exportGuestsCsv(args)` — full guest-list export for J-G6.
- `exportDoorSalesCsv(args)` — door-only export for Cycle 12 J-D5.
- Web path: `Blob` + anchor-download (works).
- Native path: `Share.share({ message: csv })` — TRANSITIONAL D-CYCLE10-IMPL-1 (text-content share, no file artifact, requires `expo-sharing` + `expo-file-system` for file-share UX).

**For Cycle 13:** the existing 3-kind serializer covers ALL 3 ticket sources (online + door + comp). A new one-shot helper `exportReconciliationCsv(args)` can wrap it with:
1. Aggregate row union: order rows + door rows + comp rows for `eventId`
2. Filename: `{event-slug}-reconciliation-{YYYY-MM-DD}.csv`
3. (Optional) Header row prefix block: 5-row summary stanza ABOVE the per-row data — `# Tickets sold / # Revenue / # Refunded / # Net / # Scans` — for accountant-friendly at-a-glance read.

#### 3.3.2 Current state — PDF infrastructure NOT shipped

**`expo-print` is NOT in `mingla-business/package.json`.** Verified via direct read:
```json
"expo-camera": "~17.0.10",
// ... no expo-print, no expo-sharing, no expo-file-system, no react-native-html-to-pdf
```

**3 architectural options:**

| Option | Wall | Tradeoffs |
|--------|------|-----------|
| **α. DEFER PDF to B-cycle** (recommended) | 0h | Cycle 13 ships CSV-only. PDF lands when B-cycle wires Resend email-attachment route — operator taps "Email reconciliation" → backend renders HTML → renders PDF → emails to operator. Accountant-friendly workflow + no native dep. |
| **β. ADD `expo-print` to package.json** | +1h | New native dep → requires `eas build` (NOT OTA). PDF generation works offline via WebView render. Quality varies by platform. Adds ~3MB to bundle. |
| **γ. HTML-to-Share (no real PDF)** | 0.5h | Use `Share.share({ message: htmlString })` and let the receiving app interpret. iOS Mail / Notes accept rich HTML; Android share sheet accepts depending on receiving app. NOT a true PDF artifact. Cosmetic only. |

**Recommendation: α (DEFER PDF to B-cycle).** Rationale:
1. Operator's PRIMARY end-of-night export need = accountant handoff. Accountants want CSV (Excel-importable) over PDF (locked-down).
2. PDF for "share with the team" is better served by B-cycle email-attachment-via-Resend (one tap → in inbox).
3. Adding `expo-print` requires `eas build` not just OTA — ships ~1 day later than OTA-able CSV-only.
4. CSV via existing `Share.share` text-content path works on iOS + Android today (degraded but functional).
5. Confidence: H.

#### 3.3.3 Compliance / accountant-friendly column shape

Existing `serializeGuestsToCsv` 11-column shape is suitable for Cycle 13 with one extension:

**Refund attribution columns (NEW):** today's CSV serializer renders `Status` = `Refunded` / `Refunded (partial)` etc. but does NOT split refund amount into a separate column. For accountant import, recommend ADDING:
- `Gross paid` (column 12) — `o.totalGbpAtPurchase` for online; `s.totalGbpAtSale` for door; `0` for comp
- `Refunded amount` (column 13) — `o.refundedAmountGbp` / `s.refundedAmountGbp` / `0`
- `Net` (column 14) — `gross - refunded`

These are derivable from existing OrderRecord / DoorSaleRecord fields; serializer extension is ~12 LOC.

**Operator decision needed (Thread 3):**
1. PDF strategy: **α (DEFER to B-cycle email-attachment)** confirm?
2. Refund columns: extend serializer with `Gross / Refunded / Net` columns? OR keep current shape + add a 5-row summary stanza at top of CSV file? OR both?
3. Filename convention: `{event-slug}-reconciliation-{YYYY-MM-DD}.csv` confirm? (Mirrors `{slug}-door-sales-{date}.csv` from Cycle 12 + `{slug}-guest-list-{date}.csv` from Cycle 10.)

**Blast radius (Thread 3):**
- 1 MOD `src/utils/guestCsvExport.ts` — add `exportReconciliationCsv` wrapper + extend `serializeGuestsToCsv` with optional summary-stanza prefix + 3 NEW columns (~50 LOC)
- ZERO new files
- ZERO new dependencies
- TRANSITIONAL native CSV degradation persists (D-CYCLE10-IMPL-1 unresolved — same constraint Cycle 10 + 12 ship under)
- Confidence: H.

---

## 4 — Cross-store data shape map (consolidated)

| Source | Selector pattern | Field projection | Filter condition |
|--------|------------------|------------------|------------------|
| `useOrderStore` | raw `entries` + `useMemo` | `.lines[].quantity - .lines[].refundedQuantity` (live-tickets); `.totalGbpAtPurchase - .refundedAmountGbp` (live-revenue); `.refunds` (refund stream); `.paymentMethod` (per-method group); `.lastSeenEventUpdatedAt` (NOT used by Cycle 13) | `o.eventId === eventId && (o.status === "paid" \|\| o.status === "refunded_partial")` (cancelled excluded — they refunded fully, contribute 0) |
| `useDoorSalesStore` | raw `entries` + `useMemo` | Same shape via `lines[].quantity - .refundedQuantity` + `totalGbpAtSale - refundedAmountGbp`; `paymentMethod` (cash/card_reader/nfc/manual); `recordedBy` (per-scanner) | `s.eventId === eventId` (NO status filter — door sales never reach `cancelled`; refunded sales still contribute live tickets per OBS-1 lock) |
| `useGuestStore` | raw `entries` + `useMemo` | Each comp = 1 ticket, £0 revenue, attributed `addedBy` | `g.eventId === eventId` |
| `useScanStore` | raw `entries` + `useMemo` | `.scanResult === "success"` for check-ins; group by `scannerUserId`; counts per result | `s.eventId === eventId` |

**Selector rule recap (Cycle 9c v2 lesson + Cycle 12 enforcement):**
> ALL multi-record reads MUST use raw `entries` + `useMemo` to derive. NEVER subscribe to fresh-array selectors like `getOrdersForEvent` / `getSalesForEvent` / `getCompEntriesForEvent` / `getScansForEvent` directly — they return new array references on every call and break `useSyncExternalStore` Object.is snapshot caching, causing infinite re-render loops.

---

## 5 — Discrepancy formula spec (consolidated)

```ts
// All values derived from raw selectors + useMemo per §4 above.

interface ReconciliationSummary {
  // ---- Headline ----
  status: "live" | "past" | "cancelled" | "upcoming";
  headlineCopy: string;            // adapts per status

  // ---- Tickets ----
  onlineLiveTickets: number;
  doorLiveTickets: number;
  compTickets: number;
  totalLiveTickets: number;        // = sum of above

  // ---- Revenue (live = total - refunded) ----
  onlineRevenue: number;
  doorRevenue: number;
  grossRevenue: number;            // = online + door
  totalRefunded: number;
  netRevenue: number;              // = gross - 0 (gross is already net of refunds; field reused for header copy)
  payoutEstimate: number;          // [TRANSITIONAL] = grossRevenue × 0.96 (4% Stripe stub)
  revenueByMethod: Record<PaymentMethod, number>;  // 8 keys: online×4 + door×4

  // ---- Scans ----
  uniqueScannedTickets: number;
  scanDups: number;
  scanWrongEvent: number;
  scanNotFound: number;
  scanVoid: number;
  scanCancelled: number;
  scansByScanner: Record<string, number>;

  // ---- Discrepancies (D1-D3 only; D4 = "unscanned/no-shows" surfaced as informational) ----
  d1_autoCheckInMismatch: number;  // door tickets without matching success scan — should always be 0 if HIDDEN-1 holds
  d2_methodSumMismatch: number;    // grossRevenue - sum(revenueByMethod) — should always be 0
  d3_refundStatusMismatch: number; // count of orders/sales with refunds but status not refunded_* — should always be 0
  unscannedTickets: number;        // = totalLiveTickets - uniqueScannedTickets (informational, not discrepancy)
}
```

**Severity matrix:**

| Discrepancy | Severity (UI) | Block? | Reason |
|-------------|---------------|--------|--------|
| D1 auto-check-in mismatch | warm-orange (`accent.warm`) | NO | Operator can investigate via scanner activity log + door sales detail; not blocking |
| D2 method sum mismatch | warm-orange | NO | Should be impossible client-side; if seen, indicates client-state corruption |
| D3 refund status mismatch | warm-orange | NO | Same — should be impossible per `recordRefund` atomicity; failsafe only |
| D4 unscanned (= no-shows on past) | grey (informational) | NO | Reality of attendance, not a data integrity issue |

**No discrepancy of any class blocks any flow.** Cycle 13 is reads-only; ADVISORY-only.

---

## 6 — Operator decisions queued (lock before SPEC dispatch)

| # | Decision | Recommendation | Alternatives |
|---|----------|----------------|--------------|
| **D-13-1** | Route placement | **B. New route `app/event/[id]/reconciliation.tsx`** | A. Inline on Event Detail past-status / C. Auto-modal |
| **D-13-2** | Auto-render trigger | **β. Always visible (permission-gated), copy adapts per status** | α. Past-status only |
| **D-13-3** | Permission gate | **NEW `MIN_RANK.VIEW_RECONCILIATION = finance_manager (30)`** | event_manager (40) / brand_admin (50) |
| **D-13-4** | Discrepancy classes | **D1 + D2 + D3 ADVISORY-only; D4 informational** | Block on D1 / different taxonomy |
| **D-13-5** | Discrepancy visual severity | **Warm-orange (`accent.warm`) for D1/D2/D3** | Red / yellow / banner-style |
| **D-13-6** | "Unscanned" terminology on past | **"No-shows"** (matches operator vocabulary) | "Unscanned" (technical, neutral) |
| **D-13-7** | PDF strategy | **α. DEFER to B-cycle email-attachment-via-Resend** | β. Add `expo-print` dep / γ. HTML-to-Share |
| **D-13-8** | Refund attribution columns | **Extend CSV with `Gross / Refunded / Net` columns + 5-row summary stanza prefix** | Keep current shape / summary only / columns only |
| **D-13-9** | Filename convention | **`{event-slug}-reconciliation-{YYYY-MM-DD}.csv`** | Different format |
| **D-13-10** | Settlement-stub copy | **Reuse existing 4% Stripe-fee stub from Event Detail KPI card; mark TRANSITIONAL** | Hide payout entirely / show "B-cycle pending" |
| **D-13-11** | Audit log integration | **DEFER entirely (Cycle 13b RLS gate exists but no client writers yet)** | Include even though writers stubbed |

---

## 7 — Decomposition recommendation

**Single Cycle 13 (~24h) per epic file.** Split would be premature:

**Why single is right:**
1. Tight scope per thread — no compound dependencies (Thread 1 depends on §4 data shape, Thread 2 depends on §5 formula derived from §4, Thread 3 depends on aggregator from Thread 1).
2. PDF deferral (D-13-7 α) keeps wall under estimate (~20h vs 24h budget — leaves margin).
3. ZERO new dependencies, ZERO migrations, ZERO mutations to existing stores.
4. New surface ≈ 1 route file (~700 LOC) + 1 utility (~150 LOC) + minor extensions to permissionGates + guestCsvExport (~60 LOC combined). 4 files modified, 2 NEW.

**If decomposed (NOT recommended):**
- 13-now (Threads 1 + 2, ~16h): J-R1 + J-R2 ship; J-R3 punted.
- 13-polish (Thread 3, ~8h): J-R3 CSV + summary stanza ship.
- Cost: 2 dispatches × full pipeline + 2 commits + 2 OTA pushes vs single. Not worth the overhead for ~24h work.

---

## 8 — Confidence levels

| Thread | Confidence | Reasoning |
|--------|-----------|-----------|
| Thread 1 (J-R1 screen) | **H** | All 4 data sources read; selector pattern verified against Cycle 9c v2 + Cycle 12 enforcement; route precedent (`door/index.tsx`) directly transferable; permissions plumbing reused verbatim from Cycle 13a/13b. |
| Thread 2 (J-R2 discrepancy) | **H** | Formula derived from canonical store fields; HIDDEN-1 + I-19 + I-27 invariants honor the algebra; no edge case found that requires runtime data. ADVISORY-only resolves the block-vs-advisory question with low risk. |
| Thread 3 (J-R3 export) | **H** | Existing CSV infrastructure proven Cycle 10 + 12; PDF feasibility verified directly from `package.json` (no `expo-print` shipped); B-cycle email-attachment path documented in pre-existing TRANSITIONAL discoveries. |
| **Overall** | **H** | All architecture decisions reversible (route can be inlined later if needed); store-agnostic data layer means B-cycle backend swap is mechanical (TRANSITIONAL marker + EXIT condition documented). |

---

## 9 — Forensics discoveries (D-CYCLE13-RECON-FOR-N)

### D-CYCLE13-RECON-FOR-1 (S3 obs) — `useScanStore.recordScan` doesn't enforce I-27 single-scan-per-ticket at store level

**Issue:** Cycle 11 SPEC §4.6 + I-27 require "each ticketId scanned exactly once at scanResult==='success'". Today the rule is enforced ONLY at the scanner UI layer (via `getSuccessfulScanByTicketId` dup-guard in `app/event/[id]/scanner/index.tsx`). The store itself happily appends multiple `success` records for the same `ticketId`. If a future code path bypasses the scanner UI (e.g., a B-cycle replay-on-reconnect job, or operator-side bulk-import), the dedupe is silently violated.

**Cycle 13 implication:** the reconciliation surface must dedupe by `ticketId` defensively (use `new Set(eventSuccessScans.map(s => s.ticketId)).size`, NOT `eventSuccessScans.length`). This is already noted in §3.1.2 as `uniqueScannedTickets`.

**Recommendation:** B-cycle SPEC for `scan-ticket` edge function MUST add a partial UNIQUE constraint on `(scan_events.ticket_id) WHERE scan_result='success'` to enforce I-27 server-side. A client-side `useScanStore.recordScan` guard would also help for offline-queue safety. Out of Cycle 13 scope; register for B-cycle backlog.

### D-CYCLE13-RECON-FOR-2 (S3 obs) — `LiveEventStatus = "ended"` enum value is unused

**Issue:** `liveEventStore.ts:54` declares `LiveEventStatus = "live" \| "cancelled" \| "ended"` but client code only ever sets `"live"` (publish) or `"cancelled"` (Cycle 9b-1 cancel flow). The `"ended"` value is dead. Cycle 9b-1 used `endedAt: ISO` (separate timestamp field) instead.

**Cycle 13 implication:** the lifecycle predicate MUST use `deriveLiveStatus(event)` (which checks `endedAt !== null`), NOT `event.status === "ended"`. This matches what `app/event/[id]/index.tsx:191-203` already does. Reconciliation route reuses verbatim.

**Recommendation:** B-cycle SPEC for events table can choose to either (a) drop `"ended"` from the enum, or (b) atomically flip `status: "ended"` whenever `endedAt` is set (so server-side queries can simple-filter on status). Out of Cycle 13 scope.

### D-CYCLE13-RECON-FOR-3 (S3 obs) — `EventDetailKpiCard` payout is hard-coded `revenueGbp × 0.96`

**Issue:** `app/event/[id]/index.tsx:416` computes `payoutGbp = Math.round(revenueGbp * 96) / 100` — hard-coded 4% Stripe-fee retention. Door sales (cash / NFC / manual) don't have Stripe fees, so applying 4% to ALL revenue overstates the fee for door-heavy events.

**Cycle 13 implication:** the reconciliation surface should split `payoutEstimate`:
- Online → `onlineRevenue × 0.96` (Stripe fee applies)
- Door → `doorRevenue × 1.0` (no Stripe fee for cash; card_reader/NFC will have separate fee schedules from B-cycle Stripe Terminal)
Avoids the over-deduction bug in the current Event Detail KPI surface.

**Recommendation:** Cycle 13 ships the corrected split inside the reconciliation route. Event Detail KPI card stays as-is (it's a quick-glance number, not the audit source-of-truth). Mark a note in the IMPL report that Event Detail KPI is intentionally simplified vs reconciliation route's exact split. Could be backlogged as a separate small ORCH (D-CYCLE13-RECON-FOR-3-FIX) to align Event Detail KPI to the corrected formula.

### D-CYCLE13-RECON-FOR-4 (S3 obs) — Cycle 12 J-D5 door-only reconciliation card now has a SUPERSET; consider link/copy reconciliation

**Issue:** Cycle 12 J-D5 door-only reconciliation lives at `app/event/[id]/door/index.tsx` top of route. Cycle 13 J-R1 SUPERSETS it (cross-source view). After Cycle 13 ships, operator has TWO reconciliation surfaces: the door-only one (still useful for door-only context) AND the new cross-source one. This is NOT a duplication problem (different scopes, different uses) but the door route should add a "View full reconciliation report" CTA at the top for navigation continuity.

**Recommendation:** Add a small CTA on `app/event/[id]/door/index.tsx` after Cycle 13 ships, linking to `/event/{id}/reconciliation`. ~5 LOC. Could fold into Cycle 13 SPEC §9 implementation steps OR ship as a polish follow-up. Operator preference.

### D-CYCLE13-RECON-FOR-5 (S3 obs — note for SPEC writer) — `/ui-ux-pro-max` pre-flight required

Per `feedback_implementor_uses_ui_ux_pro_max` memory rule, the J-R1 reconciliation summary screen is a substantive new visible UI surface. The SPEC writer (forensics SPEC mode dispatch OR implementor's pre-flight) MUST run `/ui-ux-pro-max` with query "operator finance reconciliation summary multi-source dashboard dark glass" before component code is written. Existing kit primitives (GlassCard / Pill / KpiTile / IconChrome / EmptyState) cover the ground; pre-flight will surface Glassmorphism + Dark Mode (OLED) + Real-Time Monitoring guidance per Cycle 12 precedent.

---

## 10 — Cross-references

- Canonical epic: [`Mingla_Artifacts/github/epics/cycle-13.md`](../github/epics/cycle-13.md)
- Dispatch: [`prompts/FORENSICS_BIZ_CYCLE_13_END_OF_NIGHT_RECONCILIATION.md`](../prompts/FORENSICS_BIZ_CYCLE_13_END_OF_NIGHT_RECONCILIATION.md)
- Cycle 12 close (door-side reconciliation J-D5 partial coverage): [`reports/IMPLEMENTATION_BIZ_CYCLE_12_DOOR_SALES_REPORT.md`](IMPLEMENTATION_BIZ_CYCLE_12_DOOR_SALES_REPORT.md)
- Cycle 9c v3 (orderStore + activity feed): [`reports/IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT_v3.md`](IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT_v3.md)
- Cycle 10 (guestStore + CSV export TRANSITIONAL): [`reports/IMPLEMENTATION_BIZ_CYCLE_10_GUEST_LIST_REPORT.md`](IMPLEMENTATION_BIZ_CYCLE_10_GUEST_LIST_REPORT.md)
- Cycle 11 v2 (scanStore + ORCH-0710): [`reports/IMPLEMENTATION_BIZ_CYCLE_11_QR_SCANNER_REPORT_v2.md`](IMPLEMENTATION_BIZ_CYCLE_11_QR_SCANNER_REPORT_v2.md)
- Cycle 13a (rank gate prerequisite — `MIN_RANK` + `useCurrentBrandRole`): [`reports/IMPLEMENTATION_BIZ_CYCLE_13A_PERMISSIONS_FOUNDATIONS_REPORT.md`](IMPLEMENTATION_BIZ_CYCLE_13A_PERMISSIONS_FOUNDATIONS_REPORT.md)
- Cycle 13b (audit_log RLS — DEFERRED): [`reports/IMPLEMENTATION_BIZ_CYCLE_13B_PERMISSIONS_DEPTH_REPORT.md`](IMPLEMENTATION_BIZ_CYCLE_13B_PERMISSIONS_DEPTH_REPORT.md)
- Memory rules honored: `reference_cycle_roadmap_authoritative_source` · `feedback_forensic_thoroughness` · `feedback_orchestrator_never_executes` · `feedback_no_summary_paragraph` · `feedback_diagnose_first_workflow` · `feedback_implementor_uses_ui_ux_pro_max` (flagged §9 D-CYCLE13-RECON-FOR-5 for SPEC handoff)
