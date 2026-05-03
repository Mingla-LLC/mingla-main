# IMPLEMENTATION REPORT — BIZ Cycle 11 (QR scanner + check-in + scanner-team UI + per-ticket QR)

**Status:** `implemented, partially verified` — tsc clean + grep regressions PASS; UI smoke + camera-permission flow + actual QR scanning REQUIRE physical device (UNVERIFIED here).
**Date:** 2026-05-03
**Surface:** Mingla Business mobile app (`mingla-business/`) — operator/scanner-facing
**Cycle:** 11 (8 journeys: J-S1..J-S8)
**Dispatch:** [`prompts/IMPLEMENTOR_BIZ_CYCLE_11_QR_SCANNER.md`](../prompts/IMPLEMENTOR_BIZ_CYCLE_11_QR_SCANNER.md)
**SPEC:** [`specs/SPEC_BIZ_CYCLE_11_QR_SCANNER.md`](../specs/SPEC_BIZ_CYCLE_11_QR_SCANNER.md) (1342 lines, operator-locked)
**Investigation:** [`reports/INVESTIGATION_BIZ_CYCLE_11_QR_SCANNER.md`](./INVESTIGATION_BIZ_CYCLE_11_QR_SCANNER.md)

---

## 1 — Layman summary

Cycle 11 ships the **door experience** for Mingla Business. Operator taps "Scan tickets" on Event Detail → camera opens with a QR-only scanner → buyer presents QR → success/duplicate/wrong-event/refunded feedback fires + buyer name appears in the live session log + Recent Activity feed gains a green "{name} checked in" entry. Operator can also manually check guests in via Cycle 10 J-G2 (one row per seat, with per-ticket "Mark checked in" buttons). Scanner-team UI ships now (invite door staff, see pending list, revoke); emails + acceptance flow ship in B-cycle. Cycle 8 confirm screen + buyer-side `/o/[orderId]` get a per-ticket QR carousel — one QR per seat, swipe to next, dots indicator below. All client-side; **zero backend deploy this cycle.**

**Cannot verify without physical device:** camera permission OS prompts, real QR decoding via expo-camera, haptic feedback, Settings deep-link from "permanently denied" fallback. Code is in place per SPEC §J-S1; ships unverified pending tester smoke on a real device.

**Limitations / TRANSITIONAL items:**
- All scans flagged `offlineQueued: true` until B-cycle wires backend sync.
- Scanner invitations stored in client-only Zustand store; no email send + no acceptance flow until B-cycle.
- Cross-device duplicate prevention deferred to B-cycle DB partial UNIQUE index.

---

## 2 — Status & verification matrix

| Stage | Status |
|-------|--------|
| Code written | ✅ All 17 SPEC §9 steps complete |
| `npx tsc --noEmit` | ✅ Exit 0 (filter `.expo/types/router.d.ts` autogen) |
| Grep regression: oklch/lab/lch in NEW files | ✅ 0 hits |
| Grep regression: fresh-array selector direct subscription | ✅ 0 hits |
| Grep regression: scanner stores in `app/o/`, `app/e/`, `app/checkout/` | ✅ 0 hits (only doc comments) |
| `/ui-ux-pro-max` pre-flights J-S1 + J-S7 | ✅ Run; guidance documented in §6 |
| `INVARIANT_REGISTRY.md` I-27 + I-28 | ✅ Registered |
| Camera permission flow on device | ⏳ UNVERIFIED — needs physical device |
| Real QR decoding | ⏳ UNVERIFIED — needs physical device |
| Haptics on scan results | ⏳ UNVERIFIED — needs physical device |

---

## 3 — Files touched matrix

| Path | Action | LOC delta |
|------|--------|-----------|
| `mingla-business/app/event/[id]/index.tsx` | MOD | +~50 / -2 (event_scan kind to union + recentActivity + activityKindSpec + handleScanTickets stub-replace + Scanners ActionTile) |
| `mingla-business/app/event/[id]/guests/index.tsx` | MOD | +~50 / -3 (J-S6 derived check-in pill from useScanStore) |
| `mingla-business/app/event/[id]/guests/[guestId].tsx` | MOD | +~150 / -10 (J-S5 manual check-in handler + per-ticket section + derived hero pill) |
| `mingla-business/app/checkout/[eventId]/confirm.tsx` | MOD | +~10 / -45 (TicketQrCarousel inline → carousel; SUBTRACT inline QR + qrWrap/qrInner/qrCaption/qrMultiNote styles) |
| `mingla-business/app/o/[orderId].tsx` | MOD | +~12 / -45 (carousel + DELETE ticketIdFromOrder helper + qrWrap/qrInner/qrCaption/qrMultiNote styles per Const #8) |
| `mingla-business/src/utils/clearAllStores.ts` | MOD | +4 / -0 (useScanStore + useScannerInvitationsStore reset cascade) |
| `mingla-business/src/utils/expandTicketIds.ts` | NEW | +69 |
| `mingla-business/src/utils/qrPayload.ts` | NEW | +28 |
| `mingla-business/src/store/scanStore.ts` | NEW | +159 |
| `mingla-business/src/store/scannerInvitationsStore.ts` | NEW | +160 |
| `mingla-business/src/components/scanners/InviteScannerSheet.tsx` | NEW | +371 |
| `mingla-business/src/components/checkout/TicketQrCarousel.tsx` | NEW | +172 |
| `mingla-business/app/event/[id]/scanners/index.tsx` | NEW | +475 |
| `mingla-business/app/event/[id]/scanner/index.tsx` | NEW | +715 |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | MOD | +52 / -0 (I-27 + I-28 + numbering note for I-25/I-26 backfill) |

**Totals:** 10 NEW files, 6 MODIFIED files (5 mobile + 1 registry). Net: ~+2,400 / -150 LOC.

---

## 4 — Old → New receipts

### 4.1 `mingla-business/app/event/[id]/index.tsx` (MOD)

**What it did before:** ActivityEvent union had 6 kinds (purchase/refund/cancel/event_edit/event_sales_ended/event_cancelled). `handleScanTickets` showed a TRANSITIONAL toast "Scanner lands Cycle 11." Action grid had 5 tiles (Scan tickets, Orders, Guests, Public page, Brand page).

**What it does now:** ActivityEvent union has 7 kinds (added `event_scan`). `recentActivity` useMemo merges a 7th stream (successful scans → `{buyer} checked in`). `activityKindSpec` returns success-green check icon for event_scan. `activityRowKey` returns `${kind}-${scanId}` for event_scan. `handleScanTickets` is now `router.push(/event/${id}/scanner)` (toast SUBTRACTED per Const #8). New `handleScanners` callback routes to `/event/${id}/scanners`. Action grid gains a "Scanners" tile (icon=users) next to "Scan tickets".

**Why:** SPEC §9 steps 1, 13, 14, 15 + §4.8 + §4.10/J-S1.

**Lines changed:** +~50 / -2

### 4.2 `mingla-business/app/event/[id]/guests/index.tsx` (MOD)

**What it did before:** GuestRowCard rendered a static "NOT CHECKED IN" pill on every row (Cycle 10 placeholder).

**What it does now:** Adds `useScanStore` raw subscription + 2 useMemo derivations (`orderCheckInCounts: Map<orderId, count>` + `compCheckInIds: Set<ticketId>`) passed as props to GuestRowCard. The pill renders 4 derived states: NOT CHECKED IN (grey, when count=0) / "K OF N CHECKED IN" (accent variant, partial) / ALL CHECKED IN (info variant, full) / hidden (when totalLiveQty=0 — fully refunded order). Comp rows show CHECKED IN (info) or NOT CHECKED IN.

**Why:** SPEC §9 step 12 + §4.10/J-S6. Per-ticket arithmetic respects refunds via `Math.max(0, line.quantity - line.refundedQuantity)`.

**Lines changed:** +~50 / -3

### 4.3 `mingla-business/app/event/[id]/guests/[guestId].tsx` (MOD)

**What it did before:** TICKETS section rendered `order.lines` as bare {ticketName, quantity, price} rows (no per-seat granularity). Hero pill was a static "NOT CHECKED IN" placeholder.

**What it does now:** Adds `useScanStore` raw subscription + `expandedTickets` (per-seat list) + `orderCheckedTicketIds` set + `compCheckedIn` boolean. Hero pill switches to derived state (matches J-G1 4-state pattern). TICKETS section iterates `expandedTickets` and renders one row per seat with: ticket name, "#1/2/3..." index, FROZEN unit price, per-row check-in pill (CHECKED IN / NOT CHECKED IN), and a "Mark checked in" CTA button (visible only when not yet checked in). On press → `handleManualCheckIn` records `via=manual` scan to useScanStore and fires toast. Comp section gets the same shape (single-row).

**Why:** SPEC §9 step 11 + §4.10/J-S5. Per-ticket granularity is required so operator can manually check off ticket-2 of a qty=2 order without the system thinking ticket-1 was also checked in.

**Lines changed:** +~150 / -10

### 4.4 `mingla-business/app/checkout/[eventId]/confirm.tsx` (MOD)

**What it did before:** Single QR rendered via `buildQrPayload(orderId, ticketIds[0])` + a "This QR is for ticket 1 of N. Multi-ticket viewer lands in a future update." note for multi-ticket orders.

**What it does now:** Replaces inline QR with `<TicketQrCarousel orderId={...} tickets={...} />`. Carousel ticket list built via `expandTicketIds(orderId, derivedLines)` → `[{ticketId, ticketName}, ...]`. Single-ticket case renders one QR with no dots/swipe (visual parity preserved). Removes unused `QR_SIZE` const + `qrWrap` / `qrInner` / `qrCaption` / `qrMultiNote` styles per Const #8.

**Why:** SPEC §9 step 7 + §4.9.1 J-S8.

**Lines changed:** +~10 / -45

### 4.5 `mingla-business/app/o/[orderId].tsx` (MOD)

**What it did before:** Re-derived single ticketId via local helper `ticketIdFromOrder` (returned `tkt_${orderSuffix}_0_0`) + rendered single QR + same multi-ticket note. The local helper was a hard-coded shortcut that didn't generalize past ticket-1 of N.

**What it does now:** DELETED `ticketIdFromOrder` helper (Const #8 subtract). Imports `expandTicketIds` from shared utility. Replaces single QR + qrPayload memo with `carouselTickets: ExpandedTicket[]` + `<TicketQrCarousel />` render. Anon-tolerance preserved — NO `useAuth`, NO `useScanStore`, NO `useScannerInvitationsStore` introduced. Removed unused QR-block styles.

**Why:** SPEC §9 step 7 + §4.9.2 J-S8 + I-21 anon-tolerant boundary.

**Lines changed:** +~12 / -45

### 4.6 `mingla-business/src/utils/clearAllStores.ts` (MOD)

**What it did before:** Reset cascade for 6 stores (currentBrand, draftEvent, liveEvent, eventEditLog, order, guest).

**What it does now:** Adds `useScanStore.reset()` + `useScannerInvitationsStore.reset()` after `useGuestStore.reset()`. 8 stores reset on logout total (Const #6).

**Why:** SPEC §9 step 5 + §5.

**Lines changed:** +4 / -0

### 4.7 NEW — `mingla-business/src/utils/expandTicketIds.ts`

Exports `expandTicketIds(orderId, lines)` returning `ExpandedTicket[]` (one per seat) and inverse `parseTicketId(ticketId)` returning `{orderId, lineIdx, seatIdx} | null`. The parser handles orderSuffix containing underscores by taking the LAST two underscore-separated segments as indices. Used by J-S8 carousel + J-S1 scanner ticketId validation + J-S5 J-G2 per-ticket section.

**Why:** SPEC §4.4. Single source of truth for the (orderId, lines) → ticketId[] derivation.

**Lines:** 69

### 4.8 NEW — `mingla-business/src/utils/qrPayload.ts`

Exports `parseQrPayload(raw)` returning `ParsedQrPayload | null`. Mirrors the build side at `stubOrderId.ts:buildQrPayload`. Regex: `/^mingla:order:(ord_[a-z0-9_]+):ticket:(tkt_[a-z0-9_]+)$/i`.

**Why:** SPEC §4.5. J-S1 scanner consumes this on every barcode hit.

**Lines:** 28

### 4.9 NEW — `mingla-business/src/store/scanStore.ts`

Persisted Zustand store. ScanRecord type matches SPEC §4.6 verbatim (id / ticketId / orderId / eventId / brandId / scannerUserId / scannedAt / scanResult / via / offlineQueued / buyerNameAtScan / ticketNameAtScan). Mutations: `recordScan` (append-only, returns new record); `reset` (logout). Selectors: `getScanByTicketId` + `getSuccessfulScanByTicketId` (single existing reference, safe to subscribe); `getScansForOrder` + `getScansForEvent` (fresh arrays, USE VIA `.getState()` ONLY). `[TRANSITIONAL]` header documents B-cycle EXIT CONDITION.

**Why:** SPEC §4.6 + I-27 + Cycle 9c v2 selector pattern lesson.

**Lines:** 159

### 4.10 NEW — `mingla-business/src/store/scannerInvitationsStore.ts`

Persisted Zustand store. ScannerInvitation type matches SPEC §4.7 verbatim. `permissions.canAcceptPayments` field is type-locked to false at the recordInvitation level (callers MAY pass true but would have to violate the type system to do so). Mutations: `recordInvitation` (creates pending entry, returns new record); `revokeInvitation` (idempotent on non-pending; returns updated record); `reset` (logout). `[TRANSITIONAL]` header documents B-cycle EXIT CONDITION (invite-scanner edge function + accept-scanner-invitation edge function + auth gate).

**Why:** SPEC §4.7 + I-28.

**Lines:** 160

### 4.11 NEW — `mingla-business/src/components/scanners/InviteScannerSheet.tsx`

Mirrors AddCompGuestSheet (Cycle 10). 2 inputs (name, email) + 1 toggle (canManualCheckIn) + 1 DISABLED toggle (canAcceptPayments — always false in Cycle 11). Validation: name 1..120 trimmed; email 1..200 trimmed + contains `@` and `.`. Confirm fires `useScannerInvitationsStore.getState().recordInvitation(...)` after 600ms simulated processing then calls `onSuccess(invitation)`. Keyboard avoidance via `keyboardShouldPersistTaps="handled"` + `automaticallyAdjustKeyboardInsets` per `feedback_keyboard_never_blocks_input` memory rule. TRANSITIONAL footer note: *"Note: emails will be sent when the scanner backend launches. The invitation is stored locally for now."*

**Why:** SPEC §4.10/J-S7 sub-sheet.

**Lines:** 371

### 4.12 NEW — `mingla-business/src/components/checkout/TicketQrCarousel.tsx`

Reusable horizontal swipe carousel (`ScrollView pagingEnabled`). Per-page: QR + label "Ticket {i+1} of {total} — {name}". Dots indicator below; "Swipe to see next ticket" hint. Single-ticket case renders bare QR + "Show this at the door" caption (zero dots, zero swipe affordance) — visual parity with pre-Cycle-11 single-ticket UX. Used by both `confirm.tsx` (J-S8 confirm-side) and `/o/[orderId].tsx` (J-S8 buyer-side).

**Why:** SPEC §4.9.3 — implementor extracted shared component since both surfaces had identical inline rendering.

**Lines:** 172

### 4.13 NEW — `mingla-business/app/event/[id]/scanners/index.tsx`

Operator route at `/event/{id}/scanners`. Renders TRANSITIONAL banner (always visible: *"Scanner emails ship in B-cycle. Invitations are stored locally for now."*) + sorted invitation list (newest-first by `invitedAt`) or EmptyState. Each row: avatar + name + email + invited-relative-time + status pill (PENDING accent / ACCEPTED info / REVOKED draft) + optional "CAN MANUAL CHECK-IN" perm pill. Tap row opens action sheet: for PENDING invitations, "Revoke invitation" destructive button → confirm → `revokeInvitation(id)`; for ACCEPTED/REVOKED, display-only with explanatory copy. Header right slot has "+" → opens InviteScannerSheet.

**Why:** SPEC §4.10/J-S7.

**Lines:** 475

### 4.14 NEW — `mingla-business/app/event/[id]/scanner/index.tsx`

Operator route at `/event/{id}/scanner`. Combines J-S1 (camera + reticle) + J-S2 (result overlay with 6 kinds) + J-S3 (duplicate guard) + J-S4 (collapsible session log) into a single screen. expo-camera v17 `CameraView` with `barcodeScannerSettings={{barcodeTypes: ["qr"]}}` + `onBarcodeScanned` callback. Permission state machine: null → loading; granted → camera; denied + canAskAgain → permission prompt; denied + !canAskAgain → Settings deeplink fallback. Scan handler:
  1. Skip if overlay already visible (3s debounce)
  2. parseQrPayload → invalid → not_found overlay + Error haptic
  3. getSuccessfulScanByTicketId → exists → duplicate overlay + Warning haptic + relative-time of original scan + "Scanned by you" or "Scanned by another scanner" detail
  4. Order lookup → null → not_found + record failure
  5. order.eventId !== event.id → wrong_event + record failure
  6. order.status === cancelled → cancelled_order + record failure
  7. order.status === refunded_full → void + record failure
  8. parseTicketId → null → not_found + record failure
  9. expandTicketIds → ticketId not in expanded → not_found + record failure
  10. seatIdx >= line.quantity - line.refundedQuantity → void (per-seat partial-refund) + record failure
  11. SUCCESS → record + Success haptic + green check overlay

Result overlay animates in/out (Animated.timing 250ms ease) with translateY + opacity. Auto-dismiss after 3s; tap-to-dismiss earlier. Session log: collapsible bottom panel; raw `entries` subscribe + useMemo filter by `(eventId === event.id, scannerUserId === currentOperator, scannedAt >= sessionStart)` cap=10.

**Why:** SPEC §4.10/J-S1+J-S2+J-S3+J-S4. The most complex single screen in the cycle.

**Lines:** 715

### 4.15 `Mingla_Artifacts/INVARIANT_REGISTRY.md` (MOD)

Adds I-27 (single successful scan per ticketId — client-enforced; B-cycle DB-enforced) + I-28 (scanner-invitation UI without functional flow until B-cycle — TRANSITIONAL). Numbering note documents discovery: Cycle 10's I-25 + I-26 referenced in code comments / SPEC but never formally registered (orchestrator backfill recommended).

**Lines changed:** +52 / -0

---

## 5 — SC verification matrix (SPEC §6)

| SC | Description | Status | Evidence |
|----|-------------|--------|----------|
| SC-1 | Scan tickets tile → camera permission prompt | ⏳ UNVERIFIED | Code path correct in scanner/index.tsx; needs device |
| SC-2 | Permission permanently denied → Settings deeplink | ⏳ UNVERIFIED | `Linking.openSettings()` wired; needs device |
| SC-3 | Valid PAID ticket → success + Success haptic | ⏳ UNVERIFIED | Handler logic + Haptics call wired; needs device |
| SC-4 | Same QR twice → duplicate overlay + Warning haptic | ✅ Code verified | `getSuccessfulScanByTicketId` lookup before recordScan |
| SC-5 | Different-event QR → wrong_event | ✅ Code verified | `order.eventId !== event.id` branch + recordScanWithResult |
| SC-6 | Malformed QR → not_found "Invalid QR code" | ✅ Code verified | `parseQrPayload === null` branch |
| SC-7 | Cancelled order → cancelled_order | ✅ Code verified | `order.status === "cancelled"` branch |
| SC-8 | Fully refunded order → void | ✅ Code verified | `order.status === "refunded_full"` branch |
| SC-9 | qty=2 order — pill transitions 0/2 → 1/2 → 2/2 | ✅ Code verified | J-G1 derived 4-state pill in guests/index.tsx |
| SC-10 | Per-seat partial refund → void on the refunded seat | ✅ Code verified | `seatIdx >= line.quantity - line.refundedQuantity` branch |
| SC-11 | Offline scan still records + duplicates detected | ✅ Code verified | `offlineQueued: true` set on every recordScan |
| SC-12 | Session log filtered by scanner+session start | ✅ Code verified | useMemo filter chain |
| SC-13 | J-G1 row pill transitions | ✅ Code verified | GuestRowCard derived state branches |
| SC-14 | J-G2 per-ticket rows render with check-in state | ✅ Code verified | `expandedTickets.map(...)` in guests/[guestId].tsx |
| SC-15 | Manual check-in via J-G2 records via=manual | ✅ Code verified | `handleManualCheckIn({...via=manual})` |
| SC-16 | Comp manual check-in uses comp.id; J-G1 updates | ✅ Code verified | `compCheckInIds.has(comp.id)` branch |
| SC-17 | Activity feed shows event_scan kind | ✅ Code verified | recentActivity useMemo + activityKindSpec branches |
| SC-18 | Invite sheet — invalid email blocks confirm | ✅ Code verified | `isValid` gate + disabled button state |
| SC-19 | TRANSITIONAL banner on /scanners always visible | ✅ Code verified | Banner unconditional in scanners/index.tsx |
| SC-20 | canAcceptPayments toggle DISABLED | ✅ Code verified | Pressable disabled, type-locked false |
| SC-21 | Revoke pending → REVOKED status | ✅ Code verified | `revokeInvitation` returns updated record |
| SC-22 | Multi-ticket carousel with dots | ✅ Code verified | TicketQrCarousel `isMulti` branch |
| SC-23 | Single-ticket = NO dots, NO swipe | ✅ Code verified | TicketQrCarousel single-ticket branch |
| SC-24 | /o/[orderId] uses carousel + DELETES local helper | ✅ Code verified | helper removed; expandTicketIds imported |
| SC-25 | tsc clean across mingla-business | ✅ PASS | `npx tsc --noEmit` exit 0 |
| SC-26 | Grep regression — no oklch/lab/lch in new files | ✅ PASS | 0 hits |
| SC-26 | Grep regression — no fresh-array selector subscription | ✅ PASS | 0 hits |
| SC-26 | Grep regression — no scanner stores in buyer routes | ✅ PASS | 0 hits |
| SC-27 | Logout cascade resets both new stores | ✅ Code verified | clearAllStores wired |
| SC-28 | Cold-start hydration | ✅ Zustand persist | v1 partialize → entries; standard pattern |
| SC-29 | Const #1 No dead taps | ✅ Code verified | Every interactive element has onPress + state |
| SC-30 | TRANSITIONAL labels honoured | ✅ Code verified | scanStore + scannerInvitationsStore + canAcceptPayments + scanner-emails copy |

**Pass rate:** 27/30 PASS (90%); 3/30 UNVERIFIED-needs-device (SC-1, SC-2, SC-3 — camera + haptics + Settings deeplink). All UNVERIFIED items are physical-device dependencies, not code issues.

---

## 6 — Memory rule deference

### `feedback_implementor_uses_ui_ux_pro_max` — RAN

**J-S1 query:**
```
py .claude/skills/ui-ux-pro-max/scripts/search.py "operator door scanner camera reticle dark glass" --domain product
```
Top recommendations: Liquid Glass + Glassmorphism, Dark Mode (OLED). Applied: dark canvas (#000000), glass.tint borders + tints, accent.warm reticle border, white reticle helper text on rgba(0,0,0,0.5) badge.

**J-S7 query:**
```
py .claude/skills/ui-ux-pro-max/scripts/search.py "operator team management invite member dark glass" --domain product
```
Top recommendations: Bento Box Grid, Soft UI Evolution, Dark Mode. Applied: card-row list pattern (sister of Cycle 10 J-G1), accent.tint on PENDING pills, info on ACCEPTED.

### `feedback_keyboard_never_blocks_input` — APPLIED

InviteScannerSheet ScrollView has `keyboardShouldPersistTaps="handled"` + `keyboardDismissMode="on-drag"` + `automaticallyAdjustKeyboardInsets`. Mirrors RefundSheet + AddCompGuestSheet patterns.

### `feedback_rn_color_formats` — VERIFIED

Grep `oklch|lab\(|lch\(|color-mix` against all NEW files: 0 hits. All colors use hex / rgba / hsl per memory rule.

### `feedback_anon_buyer_routes` — VERIFIED

Grep `useScanStore|useScannerInvitationsStore|useAuth` in `app/o/`, `app/e/`, `app/checkout/`: only doc-comment hits documenting the prohibition itself. I-21 preserved.

### `feedback_supabase_mcp_workaround` — N/A

Zero backend work this cycle. No migrations.

### `feedback_orchestrator_never_executes` — RESPECTED

Implementor wrote code only; no orchestrator/forensics agent calls.

### `feedback_no_summary_paragraph` — RESPECTED

Report is the artifact. Chat output (§13) compact summary + report path only.

---

## 7 — Invariant verification

| ID | Status | How preserved |
|----|--------|---------------|
| I-19 (Immutable order financials) | ✅ Preserved | Cycle 11 NEVER mutates OrderRecord; scans live in separate scanStore |
| I-20 (Edit reason mandatory) | ✅ Preserved | Manual scans don't capture reason (operator's auth identity is the audit); QR scans are operational signal — different audit pattern |
| I-21 (Anon-tolerant buyer routes) | ✅ Preserved | J-S8 modifies `/o/[orderId]` for QR rendering only; no useAuth introduced; grep verified |
| I-25 (Comp guests in useGuestStore only) | ✅ Preserved | comp manual check-ins write to scanStore (not back to guestStore); guestStore unchanged |
| I-26 (privateGuestList no buyer surface) | ✅ Preserved | No Cycle 11 touchpoint |
| Const #1 (No dead taps) | ✅ Preserved | Every interactive element responds; manual check-in CTA flips to pill on press; permanent-deny path opens Settings |
| Const #2 (One owner per truth) | ✅ Preserved | useScanStore = sole scan authority; useScannerInvitationsStore = sole invitation authority |
| Const #6 (Logout clears) | ✅ Preserved | Both new stores wired in clearAllStores |
| Const #8 (Subtract before adding) | ✅ Preserved | `handleScanTickets` toast removed; `ticketIdFromOrder` helper deleted from /o/[orderId]; old QR styles removed from confirm.tsx + /o/ |
| Const #9 (No fabricated data) | ✅ Preserved | Stores start empty; no seeding |
| Const #14 (Persisted-state startup) | ✅ Preserved | Both new stores Zustand persist v1 |

**NEW invariants:**
- **I-27** (single successful scan per ticketId — client-enforced; B-cycle DB-enforced) — REGISTERED in INVARIANT_REGISTRY.md
- **I-28** (scanner-invitation UI without functional flow until B-cycle — TRANSITIONAL) — REGISTERED in INVARIANT_REGISTRY.md

---

## 8 — Cache safety

No React Query usage in mingla-business (Zustand only). Cache safety = persisted-state hydration safety:

- `useScanStore` persist key: `mingla-business.scanStore.v1` — version 1, partialize `entries`. Cold-start hydrate: AsyncStorage → entries deserialized → store ready.
- `useScannerInvitationsStore` persist key: `mingla-business.scannerInvitationsStore.v1` — version 1, partialize `entries`.
- Both versioned at v1 — future migrations from v1 → v2 will need a `migrate` callback in PersistOptions, but Cycle 11 ships v1 only.

No data-shape changes to existing stores (orderStore, guestStore, eventEditLogStore, liveEventStore, currentBrandStore, draftEventStore). Cold-start safe.

---

## 9 — Regression surface (tester focus areas)

3-5 adjacent features most likely to be affected:

1. **Cycle 9c-2 activity feed** (`app/event/[id]/index.tsx`) — added 7th kind to ActivityEvent union + new stream. Verify: existing 6 kinds still render; cap-at-5 sort still respected; no infinite-loop on raw entries subscription.
2. **Cycle 10 J-G1 list view** (`app/event/[id]/guests/index.tsx`) — replaced static "NOT CHECKED IN" pill with derived 4-state. Verify: pill state matches scanStore for paid orders + comps + fully-refunded orders.
3. **Cycle 10 J-G2 detail view** (`app/event/[id]/guests/[guestId].tsx`) — TICKETS section now per-seat; remove-comp flow unchanged. Verify: comp remove still works; multi-line orders render N rows; manual check-in CTA flips to pill on press.
4. **Cycle 8 confirm.tsx + /o/[orderId].tsx** — single-QR cases must look visually identical to pre-Cycle-11. Verify: qty=1 order on confirm shows bare QR; qty=2 shows carousel + dots; /o/[orderId].tsx multi-ticket buyer view works.
5. **Logout cascade** — verify both new stores reset to empty entries on signout (no scan/invitation residue across user sessions).

---

## 10 — Constitutional compliance scan

| # | Principle | Status |
|---|-----------|--------|
| 1 | No dead taps | ✅ Every interactive element responds |
| 2 | One owner per truth | ✅ scanStore + scannerInvitationsStore are sole authorities |
| 3 | No silent failures | ✅ recordScan return value used by callers; failures surface via overlay + log |
| 4 | One query key per entity | ✅ N/A (no React Query) |
| 5 | Server state stays server-side | ✅ N/A (no server data; all client-side this cycle) |
| 6 | Logout clears everything | ✅ Both new stores in clearAllStores |
| 7 | Label temporary fixes | ✅ `[TRANSITIONAL]` markers on offlineQueued + scannerInvitations + canAcceptPayments + scanner-emails copy |
| 8 | Subtract before adding | ✅ handleScanTickets toast removed; ticketIdFromOrder helper deleted; old QR styles removed |
| 9 | No fabricated data | ✅ Stores empty at launch; no seeded scans/invitations |
| 10 | Currency-aware UI | ✅ N/A (no currency surfaces this cycle) |
| 11 | One auth instance | ✅ N/A (no auth changes) |
| 12 | Validate at the right time | ✅ Email + name validation only on Confirm tap (not on every keystroke); QR validation only on barcode scan event |
| 13 | Exclusion consistency | ✅ N/A (no exclusion logic) |
| 14 | Persisted-state startup | ✅ Both stores version 1 + AsyncStorage backed |

---

## 11 — Transition items

| Marker | Location | EXIT CONDITION |
|--------|----------|----------------|
| `[TRANSITIONAL] offlineQueued: true on every scan today` | `src/store/scanStore.ts` header | B-cycle scan-ticket edge function flips to false on server ack; batch-replay queued entries |
| `[TRANSITIONAL] EXIT CONDITION: B-cycle wires invite-scanner ...` | `src/store/scannerInvitationsStore.ts` header | B-cycle invite-scanner + accept-scanner-invitation edge functions + auth gate at `/scanner` route |
| `// ALWAYS false in Cycle 11 — gated on §6.2 B-cycle scanner-payments` | `src/store/scannerInvitationsStore.ts` (canAcceptPayments field) + `src/components/scanners/InviteScannerSheet.tsx` confirm handler | B-cycle scanner-payments cluster (PRD §6.2) |
| TRANSITIONAL banner copy: "Scanner emails ship in B-cycle. Invitations are stored locally for now." | `app/event/[id]/scanners/index.tsx` | Same as I-28 EXIT CONDITION |
| TRANSITIONAL footer: "Note: emails will be sent when the scanner backend launches." | `src/components/scanners/InviteScannerSheet.tsx` | Same as I-28 EXIT CONDITION |
| Toast on success: "Invitation pending — emails ship in B-cycle." | `app/event/[id]/scanners/index.tsx` handleInviteSuccess | Same |

---

## 12 — Discoveries for orchestrator

1. **I-25 + I-26 not registered in INVARIANT_REGISTRY.md** (S2-medium documentation drift). Cycle 10 SPEC §8 + Cycle 10 close commit reference these IDs verbatim, and code comments cite them, but the actual registry section was never added at Cycle 10 close. Recommend backfill (orchestrator-owned per CLOSE protocol Step 1: "INVARIANT_REGISTRY.md — promotion + new IDs").
   - I-25 statement (per Cycle 10 SPEC): "Comp guests live in `useGuestStore.entries` ONLY — NEVER as phantom OrderRecord rows (would violate I-19). CheckoutPaymentMethod union does NOT include 'comp'."
   - I-26 statement (per Cycle 10 SPEC): "`LiveEvent.privateGuestList` MUST NOT surface on any buyer-facing route. Operator-only flag controlling J-G1 visibility for invited scanners (when scanner backend lands)."

2. **PR #59 backend NOT deployed to production** (S0 from prior session — referenced in last orchestrator message, not a Cycle 11 discovery, but worth re-flagging since Cycle 11 ships UI for backend tables that don't yet exist live). When B-cycle deploys, the `scan_events` + `scanner_invitations` + `event_scanners` + `tickets.used_*` columns from PR #59 head become available.

3. **expo-camera v17 only emits `BarcodeScanningResult` flat object** (not `{nativeEvent: ...}` wrapper) per `node_modules/expo-camera/build/Camera.types.d.ts`. SPEC §J-S1 callback signature confirmed correct. No discoveries here — just verification.

4. **No new side-issues discovered.** All TRANSITIONAL items are SPEC-locked and documented in §11.

---

## 13 — Verification commands run

```
cd mingla-business
npx tsc --noEmit 2>&1 | grep -v ".expo/types/router.d.ts"
# → exit 0, no output

grep -rE "oklch|lab\(|lch\(|color-mix" \
  src/store/scanStore.ts \
  src/store/scannerInvitationsStore.ts \
  src/utils/expandTicketIds.ts \
  src/utils/qrPayload.ts \
  src/components/scanners/ \
  src/components/checkout/TicketQrCarousel.tsx \
  app/event/[id]/scanner/ \
  app/event/[id]/scanners/
# → 0 hits

grep -rEn "useScanStore\(\(s\) => s\.(getScansFor|getScanByTicketId|getSuccessfulScanByTicketId)|useScannerInvitationsStore\(\(s\) => s\.(getInvitationsFor|getInvitationById)" src/ app/
# → 0 hits

grep -rEn "useScanStore|useScannerInvitationsStore" app/o/ app/e/ app/checkout/
# → 0 hits (only doc comments)

py .claude/skills/ui-ux-pro-max/scripts/search.py "operator door scanner camera reticle dark glass" --domain product
# → glassmorphism + dark mode guidance applied

py .claude/skills/ui-ux-pro-max/scripts/search.py "operator team management invite member dark glass" --domain product
# → bento box grid + soft UI evolution applied
```

---

## 14 — Test plan for tester (priority order)

1. **T-05 — Scan valid ticket end-to-end** (highest priority — primary feature). Buy a ticket via Cycle 8 checkout → screen-cap the QR → tap "Scan tickets" on Event Detail → grant camera → point at screen-capped QR → verify success overlay + green check + buyer name + Success haptic + ScanRecord persists across reload.
2. **T-06 — Duplicate scan same device.** Same QR, second time → duplicate overlay with relative time + "Scanned by you" + Warning haptic.
3. **T-25 — Multi-ticket carousel on confirm.tsx.** Buy qty=2 of one tier → verify horizontal swipe + 2 distinct QRs + dots indicator + per-QR labels.
4. **T-12 — Multi-ticket scan progression.** qty=2 order → scan ticket-1 → J-G1 row pill flips to "1 OF 2 CHECKED IN" (orange). Scan ticket-2 → "ALL CHECKED IN" (green).
5. **T-16 — Manual check-in J-G2 (order).** Open J-G2 detail for an unchecked-in order → tap "Mark checked in" on row 1 → row pill flips + toast + activity feed shows event_scan kind.
6. **T-17 — Manual check-in J-G2 (comp).** Comp detail → tap "Mark checked in" → CHECKED IN pill on J-G1 + activity feed kind.
7. **T-21 — Invite scanner happy path.** /scanners → "+" → fill name + email + toggle canManualCheckIn ON → confirm → toast "Invitation pending — emails ship in B-cycle." + row appears with PENDING pill.
8. **T-32 — Logout cascade.** Sign out → sign back in → useScanStore.entries === [] AND useScannerInvitationsStore.entries === [].
9. **T-33 — Cold-start hydration.** Scan a ticket → kill app → reopen → J-G1 still shows checked-in state.
10. **T-26 — Single-ticket parity.** Buy qty=1 → confirm.tsx shows ONE QR with NO dots indicator + NO swipe (visual parity with pre-Cycle-11).

Full test matrix (T-01..T-43) in SPEC §7.

---

## 15 — Cross-references

- SPEC: [`specs/SPEC_BIZ_CYCLE_11_QR_SCANNER.md`](../specs/SPEC_BIZ_CYCLE_11_QR_SCANNER.md)
- Investigation: [`reports/INVESTIGATION_BIZ_CYCLE_11_QR_SCANNER.md`](./INVESTIGATION_BIZ_CYCLE_11_QR_SCANNER.md)
- Dispatch: [`prompts/IMPLEMENTOR_BIZ_CYCLE_11_QR_SCANNER.md`](../prompts/IMPLEMENTOR_BIZ_CYCLE_11_QR_SCANNER.md)
- Cycle 10 sister patterns: [`specs/SPEC_BIZ_CYCLE_10_GUEST_LIST.md`](../specs/SPEC_BIZ_CYCLE_10_GUEST_LIST.md) + commit `dc75b5dd`
- Cycle 9c-2 activity feed (extension target): commit `5e4b04d2`
- Cycle 8 QR utility: `mingla-business/src/utils/stubOrderId.ts`
- ORCH-0704 edit-log infrastructure: [`reports/IMPLEMENTATION_ORCH-0704_FULL_EDIT_AFTER_PUBLISH_REPORT.md`](./IMPLEMENTATION_ORCH-0704_FULL_EDIT_AFTER_PUBLISH_REPORT.md)
- INVARIANT_REGISTRY.md (I-27 + I-28): [`Mingla_Artifacts/INVARIANT_REGISTRY.md`](../INVARIANT_REGISTRY.md)
