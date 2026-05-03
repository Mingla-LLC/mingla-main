# INVESTIGATION — BIZ Cycle 11 (QR scanner + check-in) scope-finding

**Mode:** INVESTIGATE
**Cycle:** 11 (Mingla Business mobile app — operator/scanner-facing)
**Dispatch:** [`prompts/FORENSICS_BIZ_CYCLE_11_QR_SCANNER.md`](../prompts/FORENSICS_BIZ_CYCLE_11_QR_SCANNER.md)
**Confidence:** HIGH (every layer verified against actual code + PR #59 schema + package.json)
**Date:** 2026-05-02

---

## 1 — Layman summary

PRD §6 lists 28 features across §6.1 (14 scanner basics) and §6.2 (~14 scanner-payment items). Of those, **8 are buildable in Cycle 11** — pure mobile UI on top of existing `useOrderStore` data + a small new `useScanStore` (Zustand persisted) + a single new operator route. **6 features in §6.1 are gated on B-cycle backend** (scanner-invitation flow + per-scanner permission limits + multi-scanner concurrency tracking) — defer entirely. **All ~14 features in §6.2 (scanner payments)** are gated on B-cycle Stripe integration — defer entirely.

Recommended Cycle 11 slice = **5 operator journeys (J-S1..J-S5)** + 1 Cycle-10-rewire (live check-in column data). Estimated implementor wall: ~12–16 hours. Same architectural pattern as Cycle 10 (client-only state, B-cycle reconciliation later).

**Two real findings worth surfacing:**
1. **QR codes today encode only ONE ticket per order** (ticket `_0_0`), even when buyers buy qty=2+. This is a Cycle 8 design gap. Cycle 11 must decide: treat the QR as a count (each scan = one attendee in) OR fix Cycle 8 to render N QRs in a separate polish dispatch. Recommendation locked: **count semantics in Cycle 11, separate Cycle-8-polish dispatch fixes the QR multiplicity later** (D-CYCLE11-FOR-1).
2. **Comp guests have no QR codes** (created in Cycle 10 without going through checkout). They can only check in via manual lookup, not scanning. Treat as known limitation; no spec change in Cycle 11 (D-CYCLE11-FOR-2).

---

## 2 — PRD §6 verbatim

From `Mingla_Artifacts/BUSINESS_PRD.md`:

### §6.1 Ticket Scanners (14 features)

> - Add ticket scanners to an event
> - Invite scanner users
> - Assign scanner permissions
> - Scanner-only access mode
> - Restrict scanner access to specific events
> - Scan tickets at the door
> - Validate ticket QR codes
> - Prevent duplicate scans
> - Show successful scan state
> - Show failed scan state
> - Manual ticket lookup
> - Manual check-in
> - Offline scanning support
> - Scanner activity log
> - Track scans by scanner
> - View total scans by scanner

### §6.2 Scanner Payments (13 features)

> - Allow ticket scanners to accept payments
> - Enable or disable payment access per scanner
> - Accept in-person payments at the door
> - Accept card payments at the door
> - Accept phone NFC payments at the door
> - Record cash payments at the door
> - Create in-person orders
> - Issue tickets after in-person payment
> - Send in-person receipts
> - Track door revenue
> - Reconcile scanner sales
> - View scanner payment report
> - View scanner payout/reconciliation report

(§6.0 + §6.1 + §6.2 = 28 features total. §6.1 numbered 1–16, §6.2 numbered 17–29 below for cross-reference.)

---

## 3 — Per-feature classification (Q-11-3 answer)

### §6.1 Ticket Scanners

| # | Feature | Class | Source / Gate |
|---|---------|-------|---------------|
| 1 | Add ticket scanners to an event | 🔴 RED-S | Gated B-cycle — needs `event_scanners` writes via edge function |
| 2 | Invite scanner users | 🔴 RED-S | Gated B-cycle — needs `scanner_invitations` writes + email send |
| 3 | Assign scanner permissions | 🔴 RED-S | Gated B-cycle — operator-as-scanner v1 sidesteps for Cycle 11 |
| 4 | Scanner-only access mode | 🔴 RED-S | Gated B-cycle — depends on #1–#3 |
| 5 | Restrict scanner access to specific events | 🔴 RED-S | Gated B-cycle — depends on #1–#3 |
| 6 | **Scan tickets at the door** | 🟢 GREEN | `expo-camera` v17 (`CameraView` + `barcodeScannerSettings`) — already installed |
| 7 | **Validate ticket QR codes** | 🟢 GREEN | Parse `mingla:order:{orderId}:ticket:{ticketId}` payload + lookup `useOrderStore` + check status |
| 8 | **Prevent duplicate scans** | 🟡 YELLOW | New `useScanStore.entries` keyed by ticketId — if already-scanned, return "Already used" |
| 9 | **Show successful scan state** | 🟢 GREEN | Pure UI — green check + buyer name + ticket type + haptic success |
| 10 | **Show failed scan state** | 🟢 GREEN | Pure UI — red x + reason ("Already used", "Wrong event", "Not found", "Cancelled order") + haptic warning |
| 11 | **Manual ticket lookup** | 🟢 GREEN | Extend Cycle 10 J-G2 detail with a "Mark checked in" CTA — no new screen |
| 12 | **Manual check-in** | 🟢 GREEN | Same as #11 — `useScanStore.recordScan(...)` from J-G2 |
| 13 | **Offline scanning support** | 🟡 YELLOW | New `useScanStore` is the truth source today; `offlineQueued: boolean` flag stays true until B-cycle wires sync. Operator can scan in airplane mode; queue persists. |
| 14 | **Scanner activity log** | 🟢 GREEN | Per-session log derived from `useScanStore.entries` filtered by current scanner session start time |
| 15 | Track scans by scanner | 🔴 RED-S | Multi-scanner concurrency requires backend (today's operator-as-scanner v1 only logs one user) |
| 16 | View total scans by scanner | 🔴 RED-S | Same gate as #15 |

### §6.2 Scanner Payments

| # | Feature | Class |
|---|---------|-------|
| 17–29 | All scanner-payment features | 🔴 RED-B (gated entirely on B-cycle Stripe integration + door_sales_ledger writes) |

**Summary:**
- 🟢 GREEN: 7 features (#6, #7, #9, #10, #11, #12, #14)
- 🟡 YELLOW: 2 features (#8 duplicate prevention, #13 offline support)
- 🔴 RED-S (scanner-invitation gate): 6 features
- 🔴 RED-B (Stripe gate): 13 features

**Buildable in Cycle 11: 9 features. Deferred: 19 features.**

---

## 4 — Recommended Cycle 11 slice + rationale

**Slice:** All 9 GREEN/YELLOW features ship in Cycle 11. RED-S (scanner-invitation flow) defers to B-cycle. RED-B (scanner payments) defers to B-cycle entirely.

**Rationale:**
- **Coherence:** Operator gets a complete scan-and-check-in experience. Door staff (= operator on phone for v1) can validate tickets, mark check-ins, see today's scans, and fall back to manual lookup when QR fails.
- **Hard deferrals are clean:** Scanner-invitation flow is one feature cluster (RED-S). Scanner-payments are another (RED-B). Both have distinct B-cycle dispatches; neither bleeds into Cycle 11 scope by accident.
- **Cycle 10 unblocking:** The "NOT CHECKED IN" placeholder pill on J-G1 + J-G2 (Cycle 10) rewires to live data — ZERO Cycle 10 file restructure, just a render-source swap.
- **D-9c-V3-3 closure:** Activity feed gains a 7th kind (`event_scan`) — operators see "Tunde checked in" rows in Recent Activity card alongside purchases / refunds / cancels / event_edits / sales-ended / event-cancelled.
- **No backend dep:** Cycle 11 ships entirely client-side. No edge function deploy, no migration, no Stripe Connect work.

**Estimated implementor wall:** ~12–16 hours. New persisted Zustand store (`useScanStore`), 1 new screen (J-S1+S2 combined), 2 small wires (J-S5 column + J-G2 manual-check-in CTA), 1 inline session-log surface (J-S3+S4 combined).

---

## 5 — Journey breakdown (Q-11-10 answer)

| Journey | Title | Surface | PRD §6.1 features covered |
|---------|-------|---------|---------------------------|
| **J-S1** | Camera permission + scanner camera | New screen `app/event/[id]/scanner/index.tsx` | #6 |
| **J-S2** | Scan result feedback | Inline overlay on J-S1 (success / failed states with haptic) | #7, #9, #10 |
| **J-S3** | Duplicate-scan guard | Logic layer in J-S1 + visual cue ("Already checked in at {time}") | #8 |
| **J-S4** | Session activity log | Bottom-sheet or inline list on J-S1 — recent scans this session | #14 |
| **J-S5** | Manual check-in CTA | Extends Cycle 10 J-G2 detail with "Mark checked in" button | #11, #12 |
| **J-S6** | Cycle 10 column rewire | Rewires J-G1 + J-G2 placeholder pill to live `useScanStore` data | (Cycle 10 placeholder fulfillment) |

**Note:** J-S1+S2+S3+S4 collapse into a single screen with multiple visual states — they're separated for traceability but ship as one route.

**Routing:**
- Scanner route: `/event/{id}/scanner` (operator-only, inside protected hierarchy)
- Entry: `app/event/[id]/index.tsx:259` `handleScanTickets` callback (currently emits toast `"Scanner lands Cycle 11."`) → `router.push(\`/event/${id}/scanner\`)`. Subtract the toast (Const #8).

---

## 6 — Data sourcing strategy per journey (Q-11-9 answer)

| Journey | Primary data source | New state | Reads from |
|---------|---------------------|-----------|------------|
| J-S1 | Camera feed via `expo-camera` `CameraView` + `barcodeScannerSettings` | Camera permission (cached) | — |
| J-S2 | QR payload parse → `useOrderStore.getOrderById(orderId)` lookup | — | Order status + lines + buyer info |
| J-S3 | `useScanStore.getScanByTicketId(ticketId)` | New: ScanRecord per ticketId | — |
| J-S4 | `useScanStore.entries.filter(s => s.scannerUserId === currentOperator && s.scannedAt > sessionStart)` | sessionStart timestamp (local component state) | — |
| J-S5 | `useScanStore.recordScan(...)` mutation called from Cycle 10 J-G2 | Same store | Order/comp record |
| J-S6 | `useScanStore.getScansForOrder(orderId)` (or grouped via raw entries + useMemo) | — | Cycle 10 J-G1 + J-G2 read here |

**Stable-reference rule (memory rule):**
- All `useScanStore` reads MUST use raw-entries + `useMemo` selector pattern (mirrors Cycle 10 `useGuestStore` + Cycle 9c v2 `useOrderStore`)
- `getScanByTicketId(id)` returns single existing ref → safe to subscribe directly
- `getScansForOrder(orderId)` returns fresh array → use only via `.getState()` OR raw entries + useMemo

**ScanRecord shape (proposed for SPEC):**

```ts
interface ScanRecord {
  id: string;              // sc_<base36-ts>_<base36-rand4>
  ticketId: string;        // tkt_<orderSuffix>_<lineIdx>_<seatIdx> — primary lookup key
  orderId: string;         // ord_xxxxx — derived from ticketId at scan time
  eventId: string;         // for cross-event filter
  brandId: string;         // denormalized for brand-scoped queries
  scannerUserId: string;   // operator account_id (auth.users.id)
  scannedAt: string;       // ISO 8601
  scanResult: "success" | "duplicate" | "wrong_event" | "not_found" | "void" | "cancelled_order";
  offlineQueued: boolean;  // true until B-cycle wires backend sync
  // Display-cache for speed (optional — recoverable from order lookup)
  buyerNameAtScan: string;
  ticketNameAtScan: string;
}
```

---

## 7 — Q-11-1 — QR payload format

**Confirmed by tracing:**

QR payload format (verbatim from `mingla-business/src/utils/stubOrderId.ts:48`):
```
mingla:order:{orderId}:ticket:{ticketId}
```

Where:
- `orderId` = `ord_<base36-timestamp>_<base36-rand>` (e.g., `ord_lvl1xq8_a4k2`)
- `ticketId` = `tkt_{orderSuffix}_{lineIdx}_{seatIdx}` (e.g., `tkt_lvl1xq8_a4k2_0_0`)

**Cycle 11 parser (regex):**
```ts
const QR_REGEX = /^mingla:order:(ord_[a-z0-9_]+):ticket:(tkt_[a-z0-9_]+)$/i;
```

**CRITICAL FINDING — multi-ticket order behavior:**

`mingla-business/app/checkout/[eventId]/confirm.tsx:211` renders the QR code with:
```ts
return buildQrPayload(result.orderId, result.ticketIds[0]);
```

`mingla-business/app/o/[orderId].tsx:147–151` (buyer surface) re-derives the FIRST ticket only:
```ts
const ticketIdFromOrder = (orderId: string): string => {
  const orderSuffix = orderId.startsWith("ord_") ? orderId.slice(4) : orderId;
  return `tkt_${orderSuffix}_0_0`;
};
```

**Effect:** A buyer who buys qty=2 sees ONE QR encoded with `tkt_xxxxx_0_0`. They show the same QR to door staff for both attendees.

**OrderRecord does NOT persist `ticketIds[]`** — they're ephemeral in `OrderResult` returned by checkout (verified via grep; orderStore has no ticketIds field in OrderRecord or OrderLineRecord).

**Cycle 11 implication:** Two paths:
- **A:** Cycle 8 surfaces fix to render N QRs (separate polish dispatch — D-CYCLE11-FOR-1)
- **B (RECOMMENDED):** Cycle 11 treats each scan of the same QR as a "count" (incremental check-in). Order with qty=2 needs 2 scans of the same QR to be fully checked in. Single ScanRecord per scan event; check-in count derived from `scans.filter(s => s.orderId === X).length`.

**Cycle 11 SPEC must lock B.** Multi-attendee orders fully check in via repeated scans. Display "1 of 2 checked in" / "2 of 2 checked in" on Cycle 10 J-G1 column. The Cycle 8 polish (true per-ticket QRs) is a separate dispatch.

---

## 8 — Q-11-2 — Camera + scanner library

**Verified via `mingla-business/package.json`:**

| Package | Version | Status |
|---------|---------|--------|
| `expo-camera` | `~17.0.10` | ✅ INSTALLED — provides `CameraView` with `barcodeScannerSettings` for QR |
| `expo-haptics` | `~15.0.8` | ✅ INSTALLED — `Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success/Warning)` |
| `react-native-qrcode-svg` | `^6.3.21` | ✅ INSTALLED — generation only (Cycle 8 uses); not needed for scan reading |

**No new dependencies required.** Cycle 11 SPEC uses `CameraView` from `expo-camera` with:
```ts
<CameraView
  barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
  onBarcodeScanned={handleScanned}
/>
```

Camera permission flow via `Camera.useCameraPermissions()` hook (provided by `expo-camera`). First launch: prompt; if denied: fallback screen with "Open Settings" button via `Linking.openSettings()`.

---

## 9 — Q-11-4 — Scanner identity (Operator-as-scanner v1)

**Recommendation:** **Operator-as-scanner v1.**

Every authenticated operator can scan. The current operator's `auth.user.id` IS the scanner identity. No invitation flow, no permission gating, no role checks.

**Rationale:**
- Mirrors Cycle 10's "buyer-as-attendee" shortcut — defers a backend-gated identity model until the backend exists
- §6.1 features #1–#5 all depend on `event_scanners` + `scanner_invitations` tables which need backend RPCs that don't exist
- Ship the door-ops UX now; layer in scanner-team management when B-cycle wires invitations

**Forward path:** When B-cycle adds scanner-team RPCs, add a "scanner role" check at the route layer. The `useScanStore` shape doesn't need to change — only the auth check at scanner route entry.

---

## 10 — Q-11-5 — Offline scanning support (Hopeful queue B)

**Recommendation:** **Option B — hopeful queue.**

Scans recorded to `useScanStore.entries` immediately at scan time. `offlineQueued: boolean` set to `true` until B-cycle wires backend sync. Today: client store IS the truth; offline scanning works identically to online.

**Rationale:**
- Real door-ops UX: festivals/clubs have unreliable connectivity; scan-failure-on-no-network is unacceptable
- Cycle 11 client-store-authoritative model degrades cleanly when B-cycle adds backend sync (just flip `offlineQueued: false` after server ack)
- Mirrors Cycle 10's pattern (`useGuestStore` is client-side until B-cycle migrates)

**Limit:** Without backend sync, two devices scanning the same QR will BOTH show "success" — no cross-device duplicate prevention. Cycle 11 ships single-device duplicate prevention only. This is an acceptable v1 limitation given operator-as-scanner v1 (only one device active per event in practice).

---

## 11 — Q-11-6 — Duplicate scan prevention

**Recommendation:** Single-device duplicate detection via `useScanStore.getScanByTicketId(ticketId)` lookup before recording new scan.

**Logic flow:**
1. QR scanned → parse payload → extract ticketId
2. `useScanStore.getState().getScanByTicketId(ticketId)` returns existing ScanRecord or null
3. If existing AND `scanResult === "success"` AND `orderRecord.lines.totalQty <= scansForThisOrder.length` → return "Already checked in at {time}" with the original scanner's name
4. Else → record new scan + return success

For multi-ticket orders (qty > 1), allow N scans of the same QR until all tickets are checked in, then start rejecting. Display "X of N checked in" on the result card.

---

## 12 — Q-11-7 — Manual ticket lookup fallback

**Recommendation:** Extend Cycle 10 J-G2 detail with a "Mark checked in" CTA on order rows.

When operator can't scan a buyer's QR (phone died, screen broken, no signal), they:
1. Open Cycle 10 J-G1 guest list
2. Search by name/email/phone (J-G3)
3. Tap the matching row → J-G2 detail
4. Tap **"Mark checked in"** button (NEW for Cycle 11)
5. Confirms → calls `useScanStore.recordScan(...)` with `scanResult: "success"` and a flag indicating manual entry (not QR-scanned)

**ScanRecord extension (subsumed in §6 ScanRecord shape):** add optional field `via: "qr" | "manual"` (default "qr"). Manual scans differentiated for audit but identical for check-in count.

**No new screen.** Just a CTA button on Cycle 10's existing J-G2 surface — small ~10-line addition.

---

## 13 — Q-11-8 — Activity feed integration

**Recommendation:** **A — every successful scan logs as `event_scan` kind via `useEventEditLogStore.recordEdit({severity: "additive", ...})`.**

**Why additive (not material):**
- Operational signal — the operator knows scans are happening; buyers shouldn't get a notification per check-in (they just walk through the door)
- Activity feed shows the scan; no buyer-side propagation
- Severity classification fits cleanly into existing `EditSeverity` union (`additive | material | destructive`)

**Cycle 9c-2 ActivityEvent extension required:**

The discriminated union in `app/event/[id]/index.tsx` (Cycle 9c-2) currently has 6 kinds: purchase / refund / cancel / event_edit / event_sales_ended / event_cancelled. Cycle 11 adds a 7th:

```ts
| {
    kind: "event_scan";
    scanId: string;
    buyerName: string;
    ticketName: string;
    summary: string; // e.g., "{name} checked in"
    at: string;
  }
```

`activityKindSpec` extends with the new kind: icon `qr` or `check`, color success-green, badge `rgba(34, 197, 94, 0.18)` (same as purchase but distinct icon). Cap at 5 newest still applies.

**Source:** `useScanStore.entries.filter(s => s.eventId === eventId && s.scanResult === "success")` mapped to `event_scan` kind in `recentActivity` useMemo.

---

## 14 — Q-11-9 — Cycle 10 check-in column rewire

**Recommendation:** Multi-ticket count semantics.

Replace Cycle 10's static `<NOT CHECKED IN>` pill with derived display:
- For order rows: count scans for `useOrderStore.getOrderById(orderId).lines.totalQty` vs `scansForOrder.length`
  - 0 scans → grey "NOT CHECKED IN" pill (current placeholder)
  - 1 scan, totalQty 1 → green "CHECKED IN" pill with timestamp
  - K of N scans (K < N) → accent-orange "K of N CHECKED IN" pill
  - K = N (fully scanned) → green "ALL CHECKED IN" pill with timestamp
- For comp rows: comp guests have no QR codes → render "—" (grey, dim) or "NOT APPLICABLE" — comp check-in flows through manual J-G2 CTA only (D-CYCLE11-FOR-2)

**File touch:** `app/event/[id]/guests/index.tsx` (J-G1 row component) + `app/event/[id]/guests/[guestId].tsx` (J-G2 detail). Tighten the `<NOT CHECKED IN>` render branch to switch on derived state. ~30 LOC across both files.

---

## 15 — Q-11-11 — Entry point + camera permission

**Verified at `mingla-business/app/event/[id]/index.tsx`:**

Line 259 — current toast stub:
```ts
const handleScanTickets = useCallback((): void => {
  showToast("Scanner lands Cycle 11.");
}, [showToast]);
```

Line 541 — ActionTile wired to it:
```tsx
<ActionTile
  icon="qr"
  label="Scan tickets"
  primary
  onPress={handleScanTickets}
/>
```

**Cycle 11 replacement:** Subtract toast (Const #8), navigate to scanner route:
```ts
const handleScanTickets = useCallback((): void => {
  if (id !== null) {
    router.push(`/event/${id}/scanner` as never);
  }
}, [router, id]);
```

**Permission flow on scanner route:**
1. `useCameraPermissions()` hook from `expo-camera`
2. If `permission === null` (loading): render `ActivityIndicator`
3. If `permission?.granted === false` AND can-ask: render permission prompt with "Allow camera" button → `requestPermission()`
4. If permission denied permanently: fallback screen with "Open Settings" button → `Linking.openSettings()`
5. If `permission?.granted === true`: mount `<CameraView>` with QR scanner settings

---

## 16 — Q-11-12 — Scope-creep risks

| Risk | Confidence | Mitigation |
|------|-----------|------------|
| **§6.2 scanner-payments cluster sneaks in** | **HIGH** | Hard line in spec §"Non-goals". Door-sales feature requires Stripe Connect + door_sales_ledger writes — both gated on B-cycle. Even partial implementation (e.g., "cash-only door-sales tracking") cascades into Stripe-Connect-status checks. SPEC must reject explicitly. |
| **Scanner-invitation flow cluster sneaks in** | **HIGH** | Hard line. Operator-as-scanner v1 is the entire mitigation. SPEC says: route uses `useAuth()` + assumes any authenticated operator can scan; no role check, no scanner_invitations table reads/writes. |
| **Per-scanner permission gating** | **MEDIUM** | Same hard line as scanner-invitation. Defer ALL permission work to B-cycle when scanner_invitations exist. |
| **"Multi-scanner concurrency"** (PRD §6.1 #15-#16) | **MEDIUM** | Single-device duplicate prevention only. Multi-device cross-sync requires backend. Document as v1 limitation. |
| **Cycle 8 multi-ticket QR fix** | **MEDIUM** | TEMPTING to "fix while we're here." HARD LINE: Cycle 11 implements count semantics on existing single-QR; D-CYCLE11-FOR-1 is the separate dispatch for true per-ticket QRs. |
| **Comp-guest QR generation** | **LOW** | Comps don't have ticket IDs (no checkout flow). Manual check-in via J-G2 CTA is the only path. Don't add QR generation to `useGuestStore` in Cycle 11. (D-CYCLE11-FOR-2) |
| **Scanner-side admin / config** | **LOW** | Avoid building admin UI for "view scanner stats". Defer to B-cycle. |
| **ML Kit / advanced barcode parsing** | **LOW** | `expo-camera` v17's QR scanning is sufficient for `mingla:` prefixed payloads. Don't switch to react-native-vision-camera or ML Kit. |

---

## 17 — Schema check (Cycle 11 reads + writes)

**PR #59 schema (head ref `836ce108…`) provides:**

| Table / Column | Status | Cycle 11 use |
|----------------|--------|--------------|
| `scan_events` (ticket_id, event_id, scanner_user_id, scan_result enum, scanned_at, client_offline, synced_at) | ✅ Schema READY | NOT used in Cycle 11 (B-cycle wires writes via edge function) |
| `scan_events.scan_result` CHECK enum: `('success', 'duplicate', 'not_found', 'wrong_event', 'void')` | ✅ Schema READY | Cycle 11's `useScanStore.scanResult` SHOULD mirror this enum exactly (forward compat for B-cycle migration). Note: PR #59 enum lacks `cancelled_order` — Cycle 11 SPEC adds it client-side; B-cycle SPEC may need to extend the CHECK constraint. (D-CYCLE11-FOR-3 — schema extension needed for B-cycle) |
| `tickets.status` CHECK enum: `('valid', 'used', 'void', 'transferred', 'refunded')` | ✅ Schema READY | NOT used (orderStore.OrderRecord has its own status enum; no per-ticket status field in client) |
| `tickets.used_at` + `used_by_scanner_id` | ✅ Schema READY | Mirrors `useScanStore` ScanRecord.scannedAt + scannerUserId — B-cycle migration straightforward |
| `tickets.qr_code` UNIQUE INDEX | ✅ Schema READY | Cycle 11 uses ticketId from QR payload as primary key (matches qr_code semantics) |
| `event_scanners` table | ✅ Schema READY | NOT used (operator-as-scanner v1 sidesteps) |
| `scanner_invitations` table | ✅ Schema READY | NOT used (B-cycle owns) |
| `biz_scan_events_block_mutate` trigger | ✅ Live (post-ORCH-0706 hardening) | NOT used (no client-side scan_events writes; client-only state) |

**No schema work needed in Cycle 11.** Client-only state extension. Schema-vs-code reconciliation is a B-cycle concern.

---

## 18 — Discoveries for orchestrator

**D-CYCLE11-FOR-1 (S2, hidden-flaw)** — **Cycle 8 QR generation only encodes first ticket per order.** `app/checkout/[eventId]/confirm.tsx:211` renders QR via `buildQrPayload(result.orderId, result.ticketIds[0])` — only ticket index 0 is embedded. `app/o/[orderId].tsx:147–151` does the same. A buyer who buys qty=2 has 2 ticket IDs in `ticketIds[]` but only sees one QR. This is a real Cycle 8 design gap.

**Recommendation:** Cycle 11 SPEC locks count semantics (each scan of the same QR increments check-in count). Open a separate Cycle 8 polish dispatch ("QR carousel" — render N QRs in confirm.tsx + /o/[orderId].tsx, one per ticket, pagination/swipe between them). Estimated 1-2h implementor wall.

**D-CYCLE11-FOR-2 (S3, observation)** — **Comp guests cannot check in via QR scanner.** `useGuestStore.compEntries[]` (Cycle 10) doesn't generate ticket IDs. Comp guests have to be manually checked in via J-G2 detail's "Mark checked in" CTA (J-S5 in Cycle 11). Recommend: continue this pattern; do NOT generate fake QRs for comps in Cycle 11. Document as known limitation.

**D-CYCLE11-FOR-3 (S2, observation)** — **Schema CHECK constraint missing `cancelled_order` scan result.** PR #59's `scan_events.scan_result` enum is `('success', 'duplicate', 'not_found', 'wrong_event', 'void')`. But a Cycle 11 scenario also exists: scanned ticket belongs to a CANCELLED ORDER. The client-side `useScanStore.scanResult` adds `'cancelled_order'` to handle this. When B-cycle migrates, the schema CHECK constraint needs to extend to include this value (or alias to `'void'`). Recommend: future B-cycle dispatch alters the constraint OR the migration aliases.

**D-CYCLE11-FOR-4 (S3, observation)** — **OrderRecord does NOT persist `ticketIds[]`.** They're ephemeral in `OrderResult` returned by checkout. Cycle 11 scanner re-derives ticket IDs from orderId + line/seat indices using the deterministic `generateTicketId(orderId, lineIdx, seatIdx)` pattern. This works because IDs are deterministic — but if Cycle 8 ever changes to non-deterministic IDs (e.g., real UUIDs from B-cycle backend), the re-derivation breaks. Recommend: B-cycle adds `ticketIds: string[]` (or per-line `ticketIds: string[]`) to OrderRecord schema for forward safety.

**D-CYCLE11-FOR-5 (S3, observation)** — **Activity feed `ActivityEvent` discriminated union needs 7th kind.** Cycle 9c-2 has 6 kinds (purchase / refund / cancel / event_edit / event_sales_ended / event_cancelled). Cycle 11 SPEC adds `event_scan` kind. Same shape as `event_edit` (no buyer name; uses `summary` as primary line). Trivial extension.

---

## 19 — Open questions for operator steering

Before SPEC drafts, operator should confirm:

1. **Operator-as-scanner v1 confirmed?** (RECOMMEND yes — defer scanner-invitations to B-cycle)
2. **6-journey breakdown (J-S1..J-S6) confirmed?** (RECOMMEND yes)
3. **Hopeful-queue offline support confirmed?** (RECOMMEND yes — client-side authoritative, sync stub)
4. **Activity feed integration adds `event_scan` kind?** (RECOMMEND yes — severity additive)
5. **Comp check-in deferred to manual-only via J-G2 CTA?** (RECOMMEND yes — no QR generation for comps)
6. **Scanner-payments (§6.2) entirely OUT of Cycle 11?** (RECOMMEND yes — hard line; B-cycle owns)
7. **Scanner-invitation flow (§6.1 #1–5, #15–16) entirely OUT of Cycle 11?** (RECOMMEND yes — hard line; B-cycle owns)
8. **Multi-ticket QR semantics — count-based (each scan of same QR increments)?** (RECOMMEND yes; D-CYCLE11-FOR-1 is separate dispatch for true per-ticket QRs)
9. **Check-in column display: "K of N CHECKED IN" pill — accent color when partial, success when full?** (RECOMMEND yes for multi-ticket transparency)
10. **Single-device duplicate prevention only (no cross-device)?** (RECOMMEND yes — multi-device sync needs backend; document as v1 limitation)

If operator agrees with all 10 RECOMMEND defaults, spec writes can be a tight ~30–45 minute pass. Each "no" adds ~10–20 min of SPEC re-scope.

---

## 20 — Five-layer cross-check

| Layer | Question | Answer |
|-------|----------|--------|
| **Docs** | What does PRD §6 say should happen? | 28 features listed (§6.1 + §6.2). Door staff scan tickets, validate, prevent duplicates, log activity, accept payments. |
| **Schema** | What does PR #59 enforce? | `scan_events` + `tickets.used_*` + `event_scanners` + `scanner_invitations` + `door_sales_ledger` all schema-READY but unwired. Append-only trigger on scan_events. |
| **Code** | What does mingla-business do today? | Stub toast at `event/[id]/index.tsx:259` `handleScanTickets`. Cycle 8 generates QR with `mingla:order:X:ticket:Y` format encoding only first ticket. No scanner-side code exists. |
| **Runtime** | What happens when operator taps Scan tickets today? | Toast "Scanner lands Cycle 11." Clean stub. No silent state corruption. |
| **Data** | What's persisted client-side? | Zero scanner-related state. `useOrderStore.entries[].lines[].quantity` carries ticket count but no per-ticket-ID persistence. |

**No layer contradictions found.** All five layers align: schema ready, code stubbed, no silent state-leakage, no in-flight scan data to migrate. Cycle 11 is greenfield client-side on a backend-ready schema.

---

## 21 — Investigation manifest (files read, in order)

1. `Mingla_Artifacts/BUSINESS_PRD.md` §6 (full)
2. `Mingla_Artifacts/prompts/FORENSICS_BIZ_CYCLE_11_QR_SCANNER.md` (dispatch — 12 questions)
3. `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_10_GUEST_LIST_REPORT.md` (Cycle 10 placeholder column expectation)
4. `mingla-business/src/utils/stubOrderId.ts` (full — QR payload format + ticket ID generator)
5. `mingla-business/package.json` (deps check — expo-camera, expo-haptics, react-native-qrcode-svg)
6. `mingla-business/app/event/[id]/index.tsx:259` (handleScanTickets stub) + `:541` (ActionTile)
7. `mingla-business/app/checkout/[eventId]/payment.tsx:75–89` (ticketIds generation in OrderResult)
8. `mingla-business/app/checkout/[eventId]/buyer.tsx:231–239` (same pattern)
9. `mingla-business/app/checkout/[eventId]/confirm.tsx:210–216` (QR display — ticketIds[0] only)
10. `mingla-business/app/o/[orderId].tsx:147–152` + `:226` (buyer-side QR — same first-ticket pattern)
11. `mingla-business/src/store/orderStore.ts` (OrderRecord shape — no ticketIds persisted; verified via grep)
12. PR #59 schema (verified via prior session pull at ref `836ce108…`): `scan_events`, `tickets.qr_code/used_at/used_by_scanner_id`, `event_scanners`, `scanner_invitations`, `biz_scan_events_block_mutate`
13. Cycle 9c-2 activity feed shape (commit `5e4b04d2`) — `ActivityEvent` discriminated union for §13 extension proposal

---

## 22 — Confidence statement

**Confidence: HIGH.**

- QR payload format: verified verbatim in source (`stubOrderId.ts:48`); regex parser locked
- Camera library: verified installed in `package.json` at v17.0.10 (has barcodeScannerSettings)
- Per-feature classification: 28 PRD features classified with explicit gate citation
- Schema: cross-referenced PR #59 head ref against scanner needs; zero schema work required for Cycle 11
- Multi-ticket QR finding: traced through 5 files (payment.tsx + buyer.tsx + confirm.tsx + /o/[orderId].tsx + stubOrderId.ts); behavior unambiguous
- Architectural pattern: matches Cycle 10 template (client-side authoritative, B-cycle reconciliation, separate store for new entity)

The 10 operator-steering questions are scope choices, not unknowns. Operator confirms or tweaks; SPEC follows.

---

## 23 — Cross-references

- Dispatch: [`prompts/FORENSICS_BIZ_CYCLE_11_QR_SCANNER.md`](../prompts/FORENSICS_BIZ_CYCLE_11_QR_SCANNER.md)
- PRD source: `Mingla_Artifacts/BUSINESS_PRD.md` §6 + §6.1 + §6.2
- Cycle 10 close (Cycle 11 fulfills check-in column placeholder): commit `dc75b5dd`
- Cycle 9c v3 backlog (D-9c-V3-3 scan-in-feed): [`reports/IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT_v3.md`](IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT_v3.md) §8
- Cycle 9c-2 ActivityEvent shape (Cycle 11 extends): commit `5e4b04d2`
- ORCH-0704 edit-log infrastructure: [`reports/IMPLEMENTATION_ORCH-0704_FULL_EDIT_AFTER_PUBLISH_REPORT.md`](IMPLEMENTATION_ORCH-0704_FULL_EDIT_AFTER_PUBLISH_REPORT.md)
- PR #59 schema (informational only — Cycle 11 doesn't write to backend): head `836ce108054800aba1573d8bc30684f5728a86ce`
- Cycle 10 forensics pattern reference (mirrored shape): [`reports/INVESTIGATION_BIZ_CYCLE_10_GUEST_LIST.md`](INVESTIGATION_BIZ_CYCLE_10_GUEST_LIST.md)
- Memory rules referenced: `feedback_anon_buyer_routes`, `feedback_supabase_mcp_workaround`, `feedback_forensic_thoroughness`, `feedback_implementor_uses_ui_ux_pro_max`, `feedback_keyboard_never_blocks_input`, `feedback_rn_color_formats`
