# SPEC — BIZ Cycle 11 (QR scanner + check-in + scanner-team UI + per-ticket QR)

**Mode:** SPEC (forensics complete; operator-locked)
**Dispatch:** [`prompts/SPEC_BIZ_CYCLE_11_QR_SCANNER.md`](../prompts/SPEC_BIZ_CYCLE_11_QR_SCANNER.md)
**Investigation:** [`reports/INVESTIGATION_BIZ_CYCLE_11_QR_SCANNER.md`](../reports/INVESTIGATION_BIZ_CYCLE_11_QR_SCANNER.md)
**Surface:** Mingla Business mobile app (`mingla-business/`) — operator/scanner-facing
**Target:** production-ready. Not "good enough." Not "works on happy path." Production.
**Date:** 2026-05-02

---

## 1 — Layman summary

This spec turns the operator-locked Cycle 11 decisions into a binding contract. **8 journeys** (J-S1..J-S8) ship the door experience: camera + scanner + result feedback + duplicate guard + session log + manual check-in + Cycle 10 column rewire + scanner-team UI + per-ticket QR generation in Cycle 8 surfaces. All client-side; zero backend deploy; B-cycle reconciles later.

Two new persisted Zustand stores (`useScanStore` for scan ledger; `useScannerInvitationsStore` for scanner-team invites — TRANSITIONAL UI-only until B-cycle wires email + acceptance). One Cycle 8 surface fix (multi-ticket QR carousel). Two new invariants registered (I-27 single-scan-per-ticket; I-28 invitation-UI-without-flow-until-B-cycle). Forward backend handoff documented for B-cycle: scan-ticket edge function + scanner-invitation backend + offline sync.

---

## 2 — Operator-locked decisions (verbatim — DO NOT re-debate)

| # | Decision | Locked value |
|---|----------|--------------|
| 1 | **Scanner identity** | **Scanner-invitation UI shipped now + client-side store; backend writes deferred to B-cycle (TRANSITIONAL stubs)** |
| 2 | Journey count | **8 journeys** (J-S1..J-S8) |
| 3 | Offline scanning | **Hopeful queue** — `useScanStore.offlineQueued: true` until B-cycle sync |
| 4 | Activity feed | **Add `event_scan` kind** to ActivityEvent union; severity additive |
| 5 | Comp scanning | **Manual-only via J-G2 CTA** — no QR generation for comps |
| 6 | Scanner-payments (§6.2) | **Hard line OUT** — B-cycle owns |
| 7 | Scanner-invitations | **UI shipped now + client store (TRANSITIONAL)**; functional flow B-cycle |
| 8 | Multi-ticket QR | **Per-ticket QR in Cycle 8 surfaces (J-S8)** — N QRs in carousel, per-ticket boolean check-in |
| 9 | Check-in column display | **"K of N CHECKED IN" pill** derived from per-ticket boolean check-ins |
| 10 | Cross-device dup prevention | **Cycle 11 client-side single-device only**; B-cycle DB enforcement documented in §10 |

---

## 3 — Scope and non-goals

### 3.1 In-scope

- 2 new persisted Zustand stores: `useScanStore` + `useScannerInvitationsStore`
- 1 new operator route: `/event/{id}/scanner` (J-S1..S4 — single screen with overlay + session log)
- 1 new operator route: `/event/{id}/scanners` (J-S7 — scanner-team management)
- 1 new sheet component: `InviteScannerSheet`
- 1 new utility: `expandTicketIds`
- Cycle 8 surface modifications: `confirm.tsx` + `app/o/[orderId].tsx` render N QRs in horizontal carousel (J-S8)
- Cycle 10 J-G1 + J-G2 column/CTA rewires (J-S5 + J-S6) — derived check-in state from `useScanStore`
- Cycle 9c-2 ActivityEvent union extension — `event_scan` kind + render in `ActivityRow`
- 2 stub-replace wires: `handleScanTickets` callback in `app/event/[id]/index.tsx` + new ActionTile for "Scanners"
- Logout cascade extension: 2 new `.reset()` calls in `clearAllStores.ts`
- 2 new invariants registered: I-27 (single-scan-per-ticket) + I-28 (invitation-UI-without-flow)

### 3.2 Out-of-scope (explicit non-goals)

- ❌ Scanner-payments cluster (PRD §6.2 — door sales, NFC, card terminal, in-person orders) — entire B-cycle workstream
- ❌ Functional scanner-invitation flow (no email send, no acceptance route, no auth gate enforcement) — UI scaffolding + client store only
- ❌ Cross-device duplicate prevention — single-device only in Cycle 11
- ❌ Comp guest QR generation — comps stay manual-only
- ❌ Multi-scanner concurrency tracking (PRD §6.1 #15-16) — needs backend
- ❌ Scanner-side admin/config UI (per-scanner stats, payment reports) — defer to B-cycle
- ❌ ML Kit or react-native-vision-camera — `expo-camera` v17 sufficient
- ❌ Backend work: no migrations, no edge functions, no RLS, no service layer
- ❌ Auto-checkout via QR (e.g., scan = checkout if not yet purchased) — out of scope
- ❌ Scan event editing/deletion post-write — append-only convention

### 3.3 Assumptions

- `expo-camera` v17.0.10 is installed (verified) and provides `CameraView` + `barcodeScannerSettings` with `barcodeTypes: ["qr"]`
- `expo-haptics` v15.0.8 is installed (verified) — `Haptics.notificationAsync` with `Success/Warning/Error` types
- `react-native-qrcode-svg` v6.3.21 is installed (verified) — Cycle 8 QR generation continues; scanner READS via expo-camera, not this library
- Cycle 9c-2 activity feed (commit `5e4b04d2`) is shipped and live
- ORCH-0704 edit-log infrastructure (Cycle 9b-2) is live; `useEventEditLogStore.recordEdit` API stable
- Cycle 10 useGuestStore (commit `dc75b5dd`) is live; `comp.id` is `cg_`-prefixed and distinct from `tkt_` namespace
- Operator's `auth.user.id` is reachable via `useAuth()` from `src/context/AuthContext`
- `Sheet` primitive supports `snapPoint="full" | "half"` (verified Cycle 10 RefundSheet usage)

---

## 4 — Per-layer specification

### 4.1 Database — none

Cycle 11 ships entirely client-side. No new tables, columns, RLS, or migrations. PR #59 schema is READY for the future B-cycle handoff (see §10 Forward Backend Handoff). Implementor MUST NOT include any SQL.

### 4.2 Edge functions — none

No new edge functions. No deploys. Mobile-only.

### 4.3 Service layer — none

No new service files. All data access via Zustand stores.

### 4.4 New utility — `expandTicketIds`

**File:** `mingla-business/src/utils/expandTicketIds.ts` (NEW)

**Purpose:** Re-derive the full set of ticketIds for an order from `(orderId, lines[])`. Used by:
- J-S8 multi-QR carousel (one QR per expanded ticket)
- Cycle 11 scanner to validate decoded ticketId matches an existing order line + seat index
- J-S5 manual check-in CTA per-ticket section

**Contract (verbatim):**

```ts
import type { OrderLineRecord } from "../store/orderStore";
import { generateTicketId } from "./stubOrderId";

export interface ExpandedTicket {
  ticketId: string;             // tkt_<orderSuffix>_<lineIdx>_<seatIdx>
  lineIdx: number;
  seatIdx: number;
  ticketName: string;           // from line.ticketNameAtPurchase
  isFreeAtPurchase: boolean;
  unitPriceGbpAtPurchase: number;
}

export const expandTicketIds = (
  orderId: string,
  lines: OrderLineRecord[],
): ExpandedTicket[] => {
  const out: ExpandedTicket[] = [];
  lines.forEach((line, lineIdx) => {
    for (let seatIdx = 0; seatIdx < line.quantity; seatIdx += 1) {
      out.push({
        ticketId: generateTicketId(orderId, lineIdx, seatIdx),
        lineIdx,
        seatIdx,
        ticketName: line.ticketNameAtPurchase,
        isFreeAtPurchase: line.isFreeAtPurchase,
        unitPriceGbpAtPurchase: line.unitPriceGbpAtPurchase,
      });
    }
  });
  return out;
};

/**
 * Inverse — parse a ticketId string back into (orderId, lineIdx, seatIdx).
 * Returns null if the string is malformed.
 */
export const parseTicketId = (
  ticketId: string,
): { orderId: string; lineIdx: number; seatIdx: number } | null => {
  // Expected format: tkt_<orderSuffix>_<lineIdx>_<seatIdx>
  // orderSuffix is base36 chars + underscores, may itself contain underscores.
  // We rely on the LAST two underscore-separated segments being the indices.
  if (!ticketId.startsWith("tkt_")) return null;
  const remainder = ticketId.slice(4);
  const parts = remainder.split("_");
  if (parts.length < 3) return null;
  const seatIdxStr = parts[parts.length - 1];
  const lineIdxStr = parts[parts.length - 2];
  const seatIdx = Number.parseInt(seatIdxStr, 10);
  const lineIdx = Number.parseInt(lineIdxStr, 10);
  if (Number.isNaN(seatIdx) || Number.isNaN(lineIdx)) return null;
  if (seatIdx < 0 || lineIdx < 0) return null;
  // The orderSuffix is everything BEFORE the last two segments.
  const orderSuffix = parts.slice(0, -2).join("_");
  if (orderSuffix.length === 0) return null;
  return { orderId: `ord_${orderSuffix}`, lineIdx, seatIdx };
};
```

**Test cases (in §7 matrix):** parseTicketId on valid ticketId, malformed ticketId, ticketId with embedded underscores in orderSuffix.

### 4.5 New utility — `parseQrPayload`

**File:** `mingla-business/src/utils/qrPayload.ts` (NEW)

**Purpose:** Parse the QR payload string (`mingla:order:<orderId>:ticket:<ticketId>`) into structured data. Used by J-S1 scanner.

**Contract (verbatim):**

```ts
const QR_REGEX =
  /^mingla:order:(ord_[a-z0-9_]+):ticket:(tkt_[a-z0-9_]+)$/i;

export interface ParsedQrPayload {
  orderId: string;
  ticketId: string;
}

export const parseQrPayload = (raw: string): ParsedQrPayload | null => {
  const match = raw.trim().match(QR_REGEX);
  if (match === null) return null;
  return {
    orderId: match[1],
    ticketId: match[2],
  };
};
```

### 4.6 New Zustand store — `useScanStore`

**File:** `mingla-business/src/store/scanStore.ts` (NEW)

**Persist config:**
- Persist key: `mingla-business.scanStore.v1`
- Persist version: `1`
- Storage: `AsyncStorage` via `createJSONStorage(() => AsyncStorage)`
- Partialize: `(s) => ({ entries: s.entries })`

**Type definitions (verbatim):**

```ts
export type ScanResult =
  | "success"
  | "duplicate"
  | "wrong_event"
  | "not_found"
  | "void"
  | "cancelled_order";

export interface ScanRecord {
  /** sc_<base36-ts>_<base36-rand4> */
  id: string;
  /** tkt_<orderSuffix>_<lineIdx>_<seatIdx> OR cg_xxx (synthetic for manual comp check-in) */
  ticketId: string;
  /** ord_xxxxx — derived from ticketId for order scans; empty string for comp scans */
  orderId: string;
  /** For cross-event filtering. */
  eventId: string;
  /** Denormalized for brand-scoped queries. */
  brandId: string;
  /** Operator account_id (auth.users.id); audit. */
  scannerUserId: string;
  /** ISO 8601. */
  scannedAt: string;
  scanResult: ScanResult;
  /** "qr" = scanned via camera; "manual" = checked in via J-G2 CTA. */
  via: "qr" | "manual";
  /** True until B-cycle wires backend sync; today always true. */
  offlineQueued: boolean;
  /** Display cache (recoverable from order/comp lookup). */
  buyerNameAtScan: string;
  ticketNameAtScan: string;
}

export interface ScanStoreState {
  entries: ScanRecord[];
  // ---- Mutations ----
  /** Append-only. Returns the new ScanRecord (caller fires audit log). */
  recordScan: (entry: Omit<ScanRecord, "id" | "scannedAt">) => ScanRecord;
  /** Logout reset — wired via clearAllStores. */
  reset: () => void;
  // ---- Selectors (see selector rules) ----
  /** Single existing reference; safe to subscribe. Returns the LATEST scan (any result) for the ticketId. */
  getScanByTicketId: (ticketId: string) => ScanRecord | null;
  /** Successful scan only — used by J-S3 duplicate guard. */
  getSuccessfulScanByTicketId: (ticketId: string) => ScanRecord | null;
  /** Fresh array; USE VIA .getState() ONLY (never direct subscription). */
  getScansForOrder: (orderId: string) => ScanRecord[];
  getScansForEvent: (eventId: string) => ScanRecord[];
}
```

**ID generator:**

```ts
const generateScanId = (): string => {
  const ts36 = Date.now().toString(36);
  const rand4 = Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .padStart(4, "0");
  return `sc_${ts36}_${rand4}`;
};
```

**Mutation contract — `recordScan`:**

```ts
recordScan: (entry): ScanRecord => {
  const newEntry: ScanRecord = {
    ...entry,
    id: generateScanId(),
    scannedAt: new Date().toISOString(),
  };
  // Prepend so getScansForEvent returns newest-first naturally.
  set((s) => ({ entries: [newEntry, ...s.entries] }));
  // Caller fires audit log + activity feed entry — pure data store.
  return newEntry;
},
```

**Selector rules (memory rule from Cycle 9c v2):**
- `getScanByTicketId` + `getSuccessfulScanByTicketId` return single existing references → safe to subscribe directly OR via `.getState()`
- `getScansForOrder` + `getScansForEvent` return fresh filtered arrays → use ONLY via `.getState()` for one-shot lookups; for component reads of multiple scans, use raw-entries + `useMemo`:

```ts
const allScans = useScanStore((s) => s.entries);
const orderScans = useMemo(
  () => allScans.filter((e) => e.orderId === orderId && e.scanResult === "success"),
  [allScans, orderId],
);
```

**`[TRANSITIONAL]` header (verbatim required):**

```ts
/**
 * scanStore — persisted Zustand store for ticket scan events (Cycle 11).
 *
 * I-27: Each ticketId scanned exactly once at scanResult==="success". Cycle 11
 * enforces this client-side via getSuccessfulScanByTicketId. B-cycle DB
 * enforcement (scan_events.ticket_id partial UNIQUE index WHERE
 * scan_result='success' OR edge-function pre-insert check) MUST land before
 * multi-device door operations.
 *
 * [TRANSITIONAL] Client-side authoritative until B-cycle. offlineQueued: true
 * on every scan today (no backend sync). When B-cycle ships scan-ticket edge
 * function:
 *   - flip offlineQueued: false after server ack on each entry
 *   - on next sync after offline period, batch-replay queued entries
 *   - DB UNIQUE constraint deduplicates against existing server-side rows
 *
 * Per Cycle 11 SPEC §4.6.
 */
```

**Logout integration:** Add to `clearAllStores.ts`:

```ts
import { useScanStore } from "../store/scanStore";

// ... existing resets ...
useScanStore.getState().reset(); // NEW Cycle 11 — Constitution #6
```

### 4.7 New Zustand store — `useScannerInvitationsStore`

**File:** `mingla-business/src/store/scannerInvitationsStore.ts` (NEW)

**Persist config:**
- Persist key: `mingla-business.scannerInvitationsStore.v1`
- Persist version: `1`
- Storage: `AsyncStorage`
- Partialize: `(s) => ({ entries: s.entries })`

**Type definitions (verbatim):**

```ts
export type ScannerInvitationStatus = "pending" | "accepted" | "revoked";

export interface ScannerPermissions {
  /** Always true — scanners can always scan. */
  canScan: boolean;
  /** Operator-set — controls J-S5 manual check-in CTA visibility for this scanner. */
  canManualCheckIn: boolean;
  /** ALWAYS FALSE in Cycle 11 — gated on §6.2 B-cycle scanner-payments. */
  canAcceptPayments: boolean;
}

export interface ScannerInvitation {
  /** si_<base36-ts>_<base36-rand4> */
  id: string;
  eventId: string;
  brandId: string;
  inviteeEmail: string;
  inviteeName: string;
  permissions: ScannerPermissions;
  status: ScannerInvitationStatus;
  /** Operator account_id who sent the invitation. */
  invitedBy: string;
  /** ISO 8601. */
  invitedAt: string;
  /** null until B-cycle wires acceptance flow. */
  acceptedAt: string | null;
  /** null unless operator revoked. */
  revokedAt: string | null;
}

export interface ScannerInvitationsStoreState {
  entries: ScannerInvitation[];
  // ---- Mutations ----
  recordInvitation: (
    entry: Omit<
      ScannerInvitation,
      "id" | "invitedAt" | "status" | "acceptedAt" | "revokedAt"
    >,
  ) => ScannerInvitation;
  /** Sets status="revoked" + revokedAt. Returns updated record or null. */
  revokeInvitation: (id: string) => ScannerInvitation | null;
  /** Logout reset. */
  reset: () => void;
  // ---- Selectors ----
  getInvitationsForEvent: (eventId: string) => ScannerInvitation[];
  getInvitationById: (id: string) => ScannerInvitation | null;
}
```

**ID generator:** `si_<base36-ts>_<base36-rand4>` (mirrors useGuestStore + useScanStore).

**Mutation contracts:**

```ts
recordInvitation: (entry): ScannerInvitation => {
  const newEntry: ScannerInvitation = {
    ...entry,
    id: generateInviteId(),
    invitedAt: new Date().toISOString(),
    status: "pending",
    acceptedAt: null,
    revokedAt: null,
  };
  set((s) => ({ entries: [newEntry, ...s.entries] }));
  return newEntry;
},

revokeInvitation: (id): ScannerInvitation | null => {
  const existing = get().entries.find((e) => e.id === id);
  if (existing === undefined) return null;
  if (existing.status !== "pending") return existing; // idempotent on non-pending
  const updated: ScannerInvitation = {
    ...existing,
    status: "revoked",
    revokedAt: new Date().toISOString(),
  };
  set((s) => ({ entries: s.entries.map((e) => (e.id === id ? updated : e)) }));
  return updated;
},
```

**`[TRANSITIONAL]` header (verbatim required):**

```ts
/**
 * scannerInvitationsStore — persisted Zustand store for scanner-team invitations (Cycle 11).
 *
 * I-28: UI-ONLY in Cycle 11. recordInvitation creates a pending invitation
 * in client-side store; NO email is sent, NO acceptance flow exists, NO
 * auth gate is enforced. Operator sees pending invitations in their
 * scanner-team list with TRANSITIONAL "emails ship in B-cycle" copy.
 *
 * Const #1 No dead taps: operator's "Invite scanner" tap creates a visible
 * pending entry in the local store; the row's PENDING pill + TRANSITIONAL
 * subtext is honest state. NOT a dead tap.
 *
 * [TRANSITIONAL] EXIT CONDITION: B-cycle wires:
 *   - edge function `invite-scanner` (writes to scanner_invitations + sends Resend email)
 *   - edge function `accept-scanner-invitation` (writes to event_scanners on token-gated route)
 *   - `/event/[id]/scanner` route auth-gate checks event_scanners membership for non-operator users
 *
 * When backend lands, this store contracts to a cache (or removes entirely
 * if backend is sole authority).
 *
 * Per Cycle 11 SPEC §4.7.
 */
```

**Logout integration:** Add to `clearAllStores.ts`:

```ts
import { useScannerInvitationsStore } from "../store/scannerInvitationsStore";

// ... after useScanStore.reset() ...
useScannerInvitationsStore.getState().reset(); // NEW Cycle 11 — Constitution #6
```

### 4.8 ActivityEvent union extension (Cycle 9c-2 → +1 kind)

**File:** `mingla-business/app/event/[id]/index.tsx`

Cycle 9c-2's `ActivityEvent` discriminated union (currently 6 kinds) gains a 7th:

```ts
| {
    kind: "event_scan";
    scanId: string;
    ticketId: string;
    orderId: string;
    buyerName: string;
    ticketName: string;
    summary: string; // e.g., "Tunde checked in" or "Tunde · 1× General Admission"
    at: string;
  };
```

**`recentActivity` useMemo extension:**

After the existing 6-stream merge, add a 7th stream:

```ts
// Cycle 11 — successful scans only (failed scans don't surface to feed)
const allScanEntries = useScanStore((s) => s.entries);
// ... in the useMemo body, alongside existing streams ...
const eventScans = allScanEntries.filter(
  (s) => s.eventId === event.id && s.scanResult === "success",
);
for (const scan of eventScans) {
  events.push({
    kind: "event_scan",
    scanId: scan.id,
    ticketId: scan.ticketId,
    orderId: scan.orderId,
    buyerName: scan.buyerNameAtScan,
    ticketName: scan.ticketNameAtScan,
    summary: `${scan.buyerNameAtScan} checked in`,
    at: scan.scannedAt,
  });
}
```

**`activityKindSpec` extension:**

```ts
if (event.kind === "event_scan") {
  return {
    iconName: "check",                        // expo Icon name
    iconColor: "#34c759",                     // success green (matches purchase)
    badgeBg: "rgba(52, 199, 89, 0.18)",
    amountColor: null,
    amountSign: null,
  };
}
```

**`ActivityRow` rendering — kind branch:**

`event_scan` is event-level (no buyer-name primary line — buyer is the SUBJECT of the action, not the actor). Render with `summary` as the primary line + relative time. Same shape as `event_edit`:

```ts
const isOrderLevel =
  a.kind === "purchase" || a.kind === "refund" || a.kind === "cancel";
// event_edit / event_sales_ended / event_cancelled / event_scan are all event-level
```

**`activityRowKey` extension:**

```ts
if (a.kind === "event_scan") {
  return `${a.kind}-${a.scanId}`;
}
```

### 4.9 Cycle 8 surface modifications (J-S8 — per-ticket QR carousel)

#### 4.9.1 `mingla-business/app/checkout/[eventId]/confirm.tsx`

**Current state:** Single QR rendered via `buildQrPayload(result.orderId, result.ticketIds[0])` at line 211.

**New behavior:** Render N QRs in a horizontal swipe carousel.

**Specification:**

- Replace single `<QRCode>` element with a horizontal `ScrollView` (one page per QR) OR a `FlatList` with `pagingEnabled` + `horizontal`. Implementor's call; recommend `ScrollView` with `pagingEnabled` for simplicity.
- Each page renders:
  - The QR code (same `<QRCode>` size = 200, encoded with `buildQrPayload(orderId, ticket.ticketId)`)
  - Per-QR label below QR: **"Ticket {i+1} of {totalTickets} — {ticketName}"**
  - Optional: subtle helper text "Swipe to see next ticket" if `totalTickets > 1`
- Add a dots indicator beneath the carousel (one dot per QR, active dot highlighted):
  - Render only when `totalTickets > 1`; hidden for single-ticket orders
- Dots indicator shape: small pill row (8px circles, 4px gap, accent color when active, tertiary when inactive)
- The carousel REPLACES the existing single QR section; surrounding event details, ticket summary, wallet buttons stay unchanged
- Preserve existing `QR_SIZE = 200` constant
- Use `expandTicketIds(result.orderId, lineRecordsFromOrderResult)` to drive the carousel — but `OrderResult.ticketIds` is already `string[]`, so iterate that directly. Cross-reference with `useOrderStore.getOrderById(result.orderId).lines` for per-ticket display name.

**Single-ticket edge case:** If `result.ticketIds.length === 1`, render a single QR with NO dots indicator + NO swipe affordance — visually identical to today's surface. This preserves UX for the dominant single-ticket case.

**Implementor decision lock:** carousel UX = horizontal swipe (`ScrollView pagingEnabled`) NOT tabs strip NOT vertical stack. Reason: horizontal swipe is the dominant mobile pattern for cards (Wallet app, Apple Wallet passes); operators + buyers know it instinctively.

#### 4.9.2 `mingla-business/app/o/[orderId].tsx` (buyer-side detail)

**Current state:** Re-derives single ticketId via `ticketIdFromOrder(order.id)` returning `tkt_${orderSuffix}_0_0` at line 147–151.

**New behavior:** Re-derive ALL ticketIds and render the same N-QR carousel as confirm.tsx.

**Specification:**

- DELETE the local `ticketIdFromOrder` helper at lines 147–152
- Import + use `expandTicketIds` from `src/utils/expandTicketIds`
- Render carousel where the existing single QR sits (line 226 area):
  - Source: `expandTicketIds(order.id, order.lines)` returns `ExpandedTicket[]`
  - For each: render QR with `buildQrPayload(order.id, expanded.ticketId)` + label "Ticket {i+1} of {total} — {expanded.ticketName}"
  - Dots indicator below for multi-ticket
- Use the **same** carousel component shape as confirm.tsx — share the rendering inline (don't extract a primitive in this cycle)

**Anon-tolerance preserved:** I-21 unchanged. `/o/[orderId]` continues to read from `useOrderStore` only; no `useAuth` introduced.

#### 4.9.3 Optional shared component

Implementor MAY extract a `<TicketQrCarousel>` component to `mingla-business/src/components/checkout/TicketQrCarousel.tsx` if both `confirm.tsx` and `/o/[orderId].tsx` end up with identical inline rendering. NOT required if inline is cleaner. Document the choice in implementation report.

### 4.10 Six journeys (J-S1..J-S6 + J-S7 + J-S8 — full per-journey detail)

#### J-S1 — Camera permission + scanner camera

**File:** `mingla-business/app/event/[id]/scanner/index.tsx` (NEW)
**Route:** `/event/{id}/scanner`
**Wires from:** `app/event/[id]/index.tsx:259` `handleScanTickets` callback (current toast → `router.push(\`/event/${id}/scanner\`)`); SUBTRACT toast (Const #8).

**Layout (top to bottom):**

1. **TopBar** with `IconChrome icon="close"` (back) + title "Scan tickets" + right slot empty
2. **Permission gate states:**
   - `permission === null` (loading) → render `ActivityIndicator` centered
   - `permission?.granted === false && permission.canAskAgain === true` → permission prompt screen (illustrated with `expo Icon` `qr` size 64, copy: *"Camera access needed to scan tickets at the door."* + button "Allow camera access" → `requestPermission()`)
   - `permission?.granted === false && permission.canAskAgain === false` → permanently-denied fallback (same illustration, copy: *"Camera access blocked. Open settings to enable."* + button "Open Settings" → `Linking.openSettings()`)
   - `permission?.granted === true` → mount camera (continue below)
3. **Camera viewport:**
   - `<CameraView style={{flex:1}} barcodeScannerSettings={{barcodeTypes: ["qr"]}} onBarcodeScanned={handleScanned} />`
   - Centered overlay: square reticle (240×240px) with rounded corners (8px) and accent-colored border
   - Helper copy below reticle: *"Point camera at ticket QR code"*
4. **Scan result overlay** (J-S2 — modal slides up from bottom on every scan, see §J-S2)
5. **Session activity log** (J-S4 — collapsible bottom section, see §J-S4) — initially collapsed; tap "Recent scans (N)" header to expand

**Handler — `handleScanned`:**

```ts
const handleScanned = useCallback((event: BarcodeScanningResult): void => {
  if (resultOverlayVisible) return; // guard: don't double-fire while overlay is up
  const parsed = parseQrPayload(event.data);
  if (parsed === null) {
    showResult({ kind: "not_found", message: "Invalid QR code" });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    return;
  }
  // J-S3 duplicate guard
  const existing = useScanStore.getState().getSuccessfulScanByTicketId(parsed.ticketId);
  if (existing !== null) {
    showResult({
      kind: "duplicate",
      message: `Already checked in ${formatRelativeTime(existing.scannedAt)}`,
      detail: `Scanned by ${existing.scannerUserId === currentOperator ? "you" : "another scanner"}`,
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    return;
  }
  // Look up order
  const order = useOrderStore.getState().getOrderById(parsed.orderId);
  if (order === null) {
    showResult({ kind: "not_found", message: "Ticket not found" });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    recordScanWithResult(parsed, "not_found");
    return;
  }
  if (order.eventId !== event.id) {
    showResult({ kind: "wrong_event", message: "Different event" });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    recordScanWithResult(parsed, "wrong_event");
    return;
  }
  if (order.status === "cancelled") {
    showResult({ kind: "cancelled_order", message: "Order cancelled" });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    recordScanWithResult(parsed, "cancelled_order");
    return;
  }
  if (order.status === "refunded_full") {
    showResult({ kind: "void", message: "Ticket refunded" });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    recordScanWithResult(parsed, "void");
    return;
  }
  // Validate the ticketId actually maps to a real seat in this order
  const parsedTicket = parseTicketId(parsed.ticketId);
  if (parsedTicket === null) {
    showResult({ kind: "not_found", message: "Invalid ticket ID format" });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    recordScanWithResult(parsed, "not_found");
    return;
  }
  const expandedTickets = expandTicketIds(parsed.orderId, order.lines);
  const validTicket = expandedTickets.find((t) => t.ticketId === parsed.ticketId);
  if (validTicket === undefined) {
    showResult({ kind: "not_found", message: "Ticket not in this order" });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    recordScanWithResult(parsed, "not_found");
    return;
  }
  // Check for partial-refund of this specific line
  const line = order.lines[validTicket.lineIdx];
  // (line.quantity - line.refundedQuantity) is "live" tickets in this line.
  // If the seat index >= live count, this ticket was refunded.
  if (validTicket.seatIdx >= line.quantity - line.refundedQuantity) {
    showResult({ kind: "void", message: "Ticket refunded" });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    recordScanWithResult(parsed, "void");
    return;
  }
  // SUCCESS PATH
  const buyerName = order.buyer.name.trim().length > 0 ? order.buyer.name : "Anonymous";
  const newScan = useScanStore.getState().recordScan({
    ticketId: parsed.ticketId,
    orderId: parsed.orderId,
    eventId: event.id,
    brandId: order.brandId,
    scannerUserId: currentOperator,
    scanResult: "success",
    via: "qr",
    offlineQueued: true,
    buyerNameAtScan: buyerName,
    ticketNameAtScan: validTicket.ticketName,
  });
  // Audit log entry — caller-side per Cycle 9c v2 require-cycle pattern.
  // orderId NOT set on recordEdit — keeps the entry visible in event_scan
  // path (we write our own ActivityEvent from the scan store).
  showResult({
    kind: "success",
    message: `${buyerName} checked in`,
    detail: validTicket.ticketName,
  });
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}, [event, resultOverlayVisible, currentOperator, /* etc. */]);
```

**`recordScanWithResult` helper** for failure paths:

```ts
const recordScanWithResult = (
  parsed: ParsedQrPayload,
  result: ScanResult,
): void => {
  // Also record failures for audit; caller chooses whether to surface to activity feed (only success surfaces)
  useScanStore.getState().recordScan({
    ticketId: parsed.ticketId,
    orderId: parsed.orderId,
    eventId: event.id,
    brandId: event.brandId,
    scannerUserId: currentOperator,
    scanResult: result,
    via: "qr",
    offlineQueued: true,
    buyerNameAtScan: "",
    ticketNameAtScan: "",
  });
};
```

**States:**

| State | Render |
|-------|--------|
| Permission loading | `<ActivityIndicator />` centered |
| Permission denied (canAskAgain) | Permission prompt + "Allow camera access" CTA |
| Permission permanently denied | Settings fallback + "Open Settings" CTA |
| Permission granted (idle) | CameraView + reticle overlay + helper copy |
| Permission granted + result overlay shown | CameraView dimmed + result overlay (J-S2) |

**Memory rule `feedback_implementor_uses_ui_ux_pro_max`:** Pre-flight design step REQUIRED — new visual surface. Run `/ui-ux-pro-max` query: `python3 .claude/skills/ui-ux-pro-max/scripts/search.py "operator door scanner camera reticle dark glass" --domain product`

**Memory rule `feedback_keyboard_never_blocks_input`:** N/A — no text inputs on scanner screen.

**Accessibility:**
- Camera viewport: `accessibilityLabel="QR scanner camera viewport"`
- Allow camera button: `accessibilityLabel="Allow camera access for scanning"` `accessibilityRole="button"`
- Settings button: `accessibilityLabel="Open device settings to enable camera"`

#### J-S2 — Scan result feedback overlay

**Inline on J-S1 — modal/sheet slides up from scanner viewport on every scan.**

**Component:** Inline sheet using `<Sheet>` primitive OR custom absolute-positioned overlay (implementor's call; recommend custom overlay for snap behavior).

**Result kinds + states:**

| `kind` | Icon | Color | Message | Detail | Haptic |
|--------|------|-------|---------|--------|--------|
| `success` | `check` | `#34c759` (success green) | `{buyer name} checked in` | `{ticket name}` | `Success` |
| `duplicate` | `flag` | `accent.warm` | `Already checked in {relative time}` | `Scanned by you` OR `another scanner` | `Warning` |
| `wrong_event` | `close` | `semantic.error` | `Different event` | (none) | `Error` |
| `not_found` | `close` | `semantic.error` | `Ticket not found` | OR `Invalid QR code` | `Error` |
| `void` | `close` | `semantic.error` | `Ticket refunded` | (none) | `Error` |
| `cancelled_order` | `close` | `semantic.error` | `Order cancelled` | (none) | `Error` |

**Layout:**
- 64×64 icon badge (rounded square, kind-specific bg tint at 0.18 alpha)
- Primary line: bold message (16pt, primary text color)
- Secondary line: detail (13pt, secondary text color) — hidden if undefined
- Auto-dismiss after **3 seconds** (configurable: `RESULT_OVERLAY_DURATION_MS = 3000`)
- Tap-to-dismiss: tapping anywhere on the overlay clears it immediately
- During overlay: `resultOverlayVisible = true` blocks new scans (prevents accidental re-scan in 3s window)

**Animation:** Slide up from bottom on appear (`Animated.timing` 250ms ease-out); fade out 250ms on dismiss.

**Styles:**
- Position absolute, bottom 60% of screen (above home indicator + leaving room for camera at top)
- Background: glass.tint.profileBase (~80% opacity over dimmed camera)
- Border: glass.border.profileBase
- Border radius: radiusTokens.lg (16px)
- Padding: spacing.lg (24px)

#### J-S3 — Duplicate scan guard (logic only)

**No separate UI** — handled inline in `handleScanned` per J-S1 spec. The `duplicate` overlay state (J-S2) is the user-facing surface.

**Behavior verification:**
- Same QR scanned twice → first scan: success overlay (J-S2 success state). Second scan: duplicate overlay (J-S2 duplicate state) with "Already checked in {relative time}" + "Scanned by you" subtext (since same scanner_user_id matches).
- Different scanner scanning same QR (only relevant cross-device — out of scope for Cycle 11): Cycle 11 single-device only.

**Test cases:** T-03 (same QR twice on same device), T-04 (verify timestamp matches first scan).

#### J-S4 — Session activity log

**Inline at bottom of J-S1 — collapsible bottom section.**

**Layout:**
- Collapsed state: header bar at the bottom of the screen with "Recent scans (N)" label + chevron-up icon. Tap to expand.
- Expanded state: scrollable list of scan rows, newest-first, max ~10 visible. "Show all" CTA at bottom expands to full session list (modal sheet).

**Source:**

```ts
const sessionStart = useRef(new Date().toISOString()); // set on mount
const allScans = useScanStore((s) => s.entries);
const sessionScans = useMemo(
  () =>
    allScans
      .filter(
        (s) =>
          s.eventId === eventId &&
          s.scannerUserId === currentOperator &&
          s.scannedAt >= sessionStart.current,
      )
      .slice(0, 10), // top 10 most recent
  [allScans, eventId, currentOperator],
);
```

**Row component:**
- Left: small icon based on `scanResult` (check / flag / close)
- Middle: `{buyerNameAtScan}` (bold, primary) · `{ticketNameAtScan}` (secondary)
- Right: relative time + tiny result badge (PAID / DUPE / VOID etc.)

**Empty state (expanded but no scans yet):** *"No scans yet. Point the camera at a ticket QR code."*

**"Show all" sheet:** Reuses same row component; renders ALL session scans (no slice limit) with newest-first order. Standard `Sheet` primitive at `snapPoint="full"`.

#### J-S5 — Manual check-in CTA on Cycle 10 J-G2

**File:** `mingla-business/app/event/[id]/guests/[guestId].tsx` (MOD — extends Cycle 10 surface)

**Modifications:**

1. **For order kind (existing TICKETS section):** Replace the single-list ticket render with a per-ticket section. For each `ExpandedTicket` from `expandTicketIds(order.id, order.lines)`:
   - Row: ticket name + qty/price + per-ticket check-in state pill (`<Pill variant="info">CHECKED IN</Pill>` if `useScanStore.getSuccessfulScanByTicketId(ticket.ticketId) !== null`, else `<Pill variant="draft">NOT CHECKED IN</Pill>`)
   - **NEW** "Mark checked in" button — visible only when not yet checked in. On press → records via `useScanStore.recordScan({...via:"manual"})` + audit log entry + toast "{buyerName} checked in"

2. **For comp kind (existing ADDED BY section):** Add per-comp check-in state below the existing card:
   - State pill: same shape — `CHECKED IN` (green) or `NOT CHECKED IN` (grey)
   - **NEW** "Mark checked in" button — same logic, but uses `comp.id` as the synthetic ticketId

**Manual check-in handler (verbatim shape):**

```ts
const handleManualCheckIn = useCallback((args: {
  ticketId: string;     // tkt_xxx for orders, comp.id for comps
  orderId: string;       // ord_xxx for orders, empty string for comps
  buyerName: string;
  ticketName: string;
}): void => {
  if (event === null) return;
  const newScan = useScanStore.getState().recordScan({
    ticketId: args.ticketId,
    orderId: args.orderId,
    eventId: event.id,
    brandId: event.brandId,
    scannerUserId: currentOperator,
    scanResult: "success",
    via: "manual",
    offlineQueued: true,
    buyerNameAtScan: args.buyerName,
    ticketNameAtScan: args.ticketName,
  });
  // No reason captured for manual check-in — operator's audit identity (scannerUserId) suffices
  showToast(`${args.buyerName} checked in`);
}, [event, currentOperator, showToast]);
```

**Note on audit log:** Manual check-ins do NOT need to fire `useEventEditLogStore.recordEdit` separately — they surface to activity feed via the same `event_scan` ActivityEvent extension that handles QR scans. The activity feed picks them up directly from `useScanStore.entries` (per §4.8).

**Visual hierarchy:** "Mark checked in" button uses `variant="primary"` size `sm` — high-affordance because it's the active CTA when ticket isn't yet checked in. After check-in, the button is replaced by the green pill.

**Const #1 No dead taps:** every manual check-in button responds; auto-toggles to pill state after press.

#### J-S6 — Cycle 10 J-G1 column rewire

**File:** `mingla-business/app/event/[id]/guests/index.tsx` (MOD — extends Cycle 10)

**Modifications:**

Replace the static `<NOT CHECKED IN>` placeholder pill in `GuestRowCard` with derived display.

**Source data (subscribe via raw entries + useMemo):**

```ts
const allScans = useScanStore((s) => s.entries);
const orderCheckInCounts = useMemo(() => {
  const map = new Map<string, number>();
  for (const scan of allScans) {
    if (scan.scanResult !== "success") continue;
    if (scan.via === "manual" && scan.orderId === "") continue; // skip comp scans
    map.set(scan.orderId, (map.get(scan.orderId) ?? 0) + 1);
  }
  return map;
}, [allScans]);

const compCheckInIds = useMemo(() => {
  const set = new Set<string>();
  for (const scan of allScans) {
    if (scan.scanResult !== "success") continue;
    if (scan.via !== "manual") continue;
    if (!scan.ticketId.startsWith("cg_")) continue;
    set.add(scan.ticketId);
  }
  return set;
}, [allScans]);
```

Pass these into `GuestRowCard` as props.

**`GuestRowCard` rewire:**

```tsx
{isOrder ? (() => {
  const totalQty = row.order.lines.reduce((s, l) => s + l.quantity - l.refundedQuantity, 0);
  const checkedInCount = props.orderCheckInCounts.get(row.order.id) ?? 0;
  if (totalQty === 0) return null; // fully refunded — no pill
  if (checkedInCount === 0) {
    return <View style={styles.checkInPillNone}><Text style={styles.checkInPillNoneText}>NOT CHECKED IN</Text></View>;
  }
  if (checkedInCount < totalQty) {
    return <Pill variant="accent">{`${checkedInCount} OF ${totalQty} CHECKED IN`}</Pill>;
  }
  return <Pill variant="info">ALL CHECKED IN</Pill>;
})() : (() => {
  const checkedIn = props.compCheckInIds.has(row.comp.id);
  return checkedIn ? (
    <Pill variant="info">CHECKED IN</Pill>
  ) : (
    <View style={styles.checkInPillNone}><Text style={styles.checkInPillNoneText}>NOT CHECKED IN</Text></View>
  );
})()}
```

**Visual styles:**
- "NOT CHECKED IN" → grey background (`rgba(120, 120, 120, 0.18)`), tertiary text — same as Cycle 10 placeholder
- "K OF N CHECKED IN" → accent variant (warm orange tint) — partial state
- "ALL CHECKED IN" → info variant (cool blue/teal) — fully checked in
- "CHECKED IN" (comp single ticket) → info variant

**Test cases:** T-09a/b/c/d, T-18, T-29 (cross-event scoping — comp from another event must NOT count).

#### J-S7 — Scanner-team management

**File:** `mingla-business/app/event/[id]/scanners/index.tsx` (NEW)
**Route:** `/event/{id}/scanners`
**Wires from:** New ActionTile on Event Detail (next to existing "Scan tickets") OR overflow menu entry. Implementor's call — recommend ActionTile.

**Layout:**

1. **TopBar** with `IconChrome icon="close"` (back) + title "Scanners" + right slot: `IconChrome icon="plus"` (open InviteScannerSheet)
2. **TRANSITIONAL banner** at top of content (rendered always, copy: *"Scanner emails ship in B-cycle. Invitations are stored locally for now."*)
3. **List of invitations** for this event:
   - Source: `useScannerInvitationsStore.entries` filtered to `eventId === id` via raw entries + useMemo
   - Sort: newest-first by `invitedAt`
   - Each row: avatar (initials, hashed hue), name + email, status pill (PENDING orange / ACCEPTED green / REVOKED grey), "Can manual check-in: yes/no" subtext, tap row to open action sheet (revoke option)
4. **Empty state** (no invitations yet): EmptyState `illustration="user"` `title="No scanners invited"` `description="Invite door staff or backup scanners. They'll receive access when emails ship in B-cycle."` `cta={{label: "Invite scanner", onPress: () => setInviteSheetOpen(true), variant: "primary"}}`

**Row press → action sheet:**
- For PENDING invitations: "Revoke invitation" CTA → confirm dialog → `useScannerInvitationsStore.revokeInvitation(id)`
- For ACCEPTED (impossible in Cycle 11): no actions; future B-cycle adds "Remove access"
- For REVOKED: no actions; entry stays visible for audit

**"+" → InviteScannerSheet** (see §4.10 J-S7 sheet detail below)

**Memory rule `feedback_implementor_uses_ui_ux_pro_max`:** Pre-flight design step REQUIRED. Query: `python3 .claude/skills/ui-ux-pro-max/scripts/search.py "operator team management invite member dark glass" --domain product`

**Const #1 No dead taps:** every interactive element responds. Pending invitation taps open action sheet; revoked entries are display-only (clearly indicated).

##### J-S7 sub-sheet — `InviteScannerSheet`

**File:** `mingla-business/src/components/scanners/InviteScannerSheet.tsx` (NEW)

**Pattern:** Mirror `AddCompGuestSheet` (Cycle 10) — Sheet primitive, controlled state, async confirm, side effects fired by component.

**Props interface:**

```ts
export interface InviteScannerSheetProps {
  visible: boolean;
  event: LiveEvent;
  brandId: string;
  operatorAccountId: string;
  onClose: () => void;
  onSuccess: (invitation: ScannerInvitation) => void;
}
```

**Inputs:**
- `name: string` (TextInput — required, 1..120 chars trimmed)
- `email: string` (TextInput — required, 1..200 chars trimmed, must contain `@` and `.`)
- `canManualCheckIn: boolean` (Toggle — default false; copy "Allow this scanner to manually check in guests")
- `canAcceptPayments: boolean` (DISABLED toggle — always false; copy "Door payments coming in B-cycle")
- `submitting: boolean` (state for disabling controls during simulated processing)

**Validation:**

| Field | Rule | Error copy |
|-------|------|------------|
| `name` | trimmed length 1..120 | "Enter the scanner's name." |
| `email` | trimmed length 1..200 + contains `@` AND `.` | "Enter a valid email." |

`isValid = nameValid && emailValid`. Confirm button disabled when `!isValid || submitting`.

**Confirm handler:**

```ts
const handleConfirm = useCallback(async (): Promise<void> => {
  if (!isValid) return;
  setSubmitting(true);
  try {
    await sleep(600); // simulated processing
    const newInvitation = useScannerInvitationsStore.getState().recordInvitation({
      eventId: event.id,
      brandId,
      inviteeEmail: email.trim().toLowerCase(),
      inviteeName: name.trim(),
      permissions: {
        canScan: true,
        canManualCheckIn,
        canAcceptPayments: false, // ALWAYS false in Cycle 11 per locked decision #6
      },
      invitedBy: operatorAccountId,
    });
    onSuccess(newInvitation);
  } finally {
    setSubmitting(false);
  }
}, [isValid, event, brandId, email, name, canManualCheckIn, operatorAccountId, onSuccess]);
```

**Toast on success (parent handles):** *"Invitation pending — emails ship in B-cycle."*

**TRANSITIONAL footer note** at bottom of sheet, above CTAs: *"Note: emails will be sent when scanner backend launches. The invitation is stored locally for now."*

**Sheet primitive:** `snapPoint="full"`. Use the existing `Sheet` primitive from `src/components/ui/Sheet.tsx`.

**Memory rule `feedback_keyboard_never_blocks_input`:** Sheet has 2 text inputs → keyboard avoidance MUST work via `keyboardShouldPersistTaps="handled"` + `automaticallyAdjustKeyboardInsets` on the inner ScrollView (mirror RefundSheet + AddCompGuestSheet patterns).

**Const #1 No dead taps:** Confirm button states = enabled (valid) / disabled (invalid) / loading ("Inviting..."). Cancel button always enabled when not submitting.

#### J-S8 — Per-ticket QR carousel (Cycle 8 surface fix)

Already specified in §4.9 above.

---

## 5 — Logout cascade

**File:** `mingla-business/src/utils/clearAllStores.ts` (MOD)

After Cycle 10's `useGuestStore.getState().reset()`, append:

```ts
useScanStore.getState().reset(); // NEW Cycle 11 — Constitution #6
useScannerInvitationsStore.getState().reset(); // NEW Cycle 11 — Constitution #6
```

Imports added at top of file alongside existing.

---

## 6 — Success criteria

| SC | Description |
|----|-------------|
| SC-1 | Operator taps "Scan tickets" tile → camera permission prompt appears (first time) → grants → CameraView mounts with reticle |
| SC-2 | Camera permission permanently denied → fallback screen renders with "Open Settings" CTA → tap navigates to device settings |
| SC-3 | Scanning a valid PAID ticket QR (this event, never used) → success overlay (green check + buyer name + ticket name) + Success haptic |
| SC-4 | Scanning the SAME QR a second time → duplicate overlay with "Already checked in {time}" + Warning haptic |
| SC-5 | Scanning a QR from a DIFFERENT event → wrong_event overlay + Error haptic; ScanRecord with `scan_result: "wrong_event"` recorded |
| SC-6 | Scanning a malformed QR (e.g., random text) → not_found overlay "Invalid QR code" + Error haptic |
| SC-7 | Scanning a ticket from a CANCELLED order → cancelled_order overlay + Error haptic |
| SC-8 | Scanning a ticket from a FULLY refunded order → void overlay + Error haptic |
| SC-9 | Scanning ticket-1 of qty=2 order → success on ticket-1; J-G1 pill updates to "1 OF 2 CHECKED IN" (accent orange); scanning ticket-2 → "ALL CHECKED IN" (info green) |
| SC-10 | Scanning a SPECIFIC ticket from a partially-refunded order where THAT seat was refunded → void overlay |
| SC-11 | Scanning offline (airplane mode) → still records to useScanStore with `offlineQueued: true`; success overlay; subsequent scans of same QR still detect duplicate |
| SC-12 | Session activity log expandable; shows current scanner session scans only (filtered by `scannerUserId === currentOperator && scannedAt >= sessionStart`); newest-first |
| SC-13 | Cycle 10 J-G1 row: 0 scans → grey "NOT CHECKED IN" pill; partial → orange "K OF N CHECKED IN"; full → green "ALL CHECKED IN" |
| SC-14 | Cycle 10 J-G2 detail (order kind): per-ticket section renders one row per `ExpandedTicket` with individual check-in state pill + "Mark checked in" CTA when not yet checked in |
| SC-15 | J-G2 Manual check-in via "Mark checked in" CTA records `via: "manual"` ScanRecord; activity feed shows "{name} checked in" event_scan kind |
| SC-16 | Comp guest manual check-in via J-G2: uses `comp.id` as ticketId; J-G1 row updates to CHECKED IN pill |
| SC-17 | Cycle 9c-2 activity feed (Recent Activity card on Event Detail) shows event_scan kind for successful scans; mixed with other 6 kinds; cap of 5 newest still applies |
| SC-18 | "Invite scanner" sheet: invalid email blocks confirm button; valid name + email + (optional) canManualCheckIn → invitation appears in scanners list with PENDING status; toast "Invitation pending — emails ship in B-cycle." |
| SC-19 | TRANSITIONAL banner at top of /event/{id}/scanners surface visible always with copy "Scanner emails ship in B-cycle. Invitations are stored locally for now." |
| SC-20 | "canAcceptPayments" toggle in InviteScannerSheet is DISABLED with copy "Door payments coming in B-cycle" — operator cannot enable it |
| SC-21 | Revoke pending invitation → status flips to REVOKED; row stays visible with REVOKED pill; can no longer be revoked again (idempotent) |
| SC-22 | Multi-ticket order on confirm.tsx: 2-ticket purchase shows 2 QRs in horizontal carousel with dots indicator + per-QR labels "Ticket 1 of 2 — General" / "Ticket 2 of 2 — General" |
| SC-23 | Single-ticket order on confirm.tsx: shows ONE QR with NO dots indicator (visual parity with current single-ticket UX preserved) |
| SC-24 | Buyer detail at /o/[orderId]: same multi-QR carousel pattern as confirm.tsx; expandTicketIds replaces local ticketIdFromOrder helper which is DELETED (Const #8 subtract before adding) |
| SC-25 | tsc clean across mingla-business workspace (`cd mingla-business && npx tsc --noEmit` exit 0; pre-existing `.expo/types/router.d.ts` autogen noise filtered) |
| SC-26 | All grep regression tests PASS: no `oklch`/`lab(`/`lch(` in new files; no fresh-array selectors directly subscribed on useScanStore/useScannerInvitationsStore; no buyer-route refs to scanner stores |
| SC-27 | Logout cascade: useScanStore.entries === [] AND useScannerInvitationsStore.entries === [] post-logout |
| SC-28 | Cold-start hydration: scans + invitations persist across app restart (Const #14) |
| SC-29 | Const #1 No dead taps: every interactive element on scanner + scanners + InviteScannerSheet + J-G2 manual CTA + Cycle 8 carousel responds |
| SC-30 | TRANSITIONAL labels honored: scanStore + scannerInvitationsStore + permissions.canAcceptPayments + scanner-emails-deferred copy all carry `[TRANSITIONAL]` markers with EXIT CONDITIONs documented |

---

## 7 — Test matrix

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 | Permission prompt | First-ever Scan tickets tap | Camera permission OS prompt appears | Component |
| T-02 | Permission grant flow | Operator allows | CameraView mounts with reticle | Component |
| T-03 | Permission denied (canAskAgain) | Operator denies, can ask again | Permission prompt screen with retry | Component |
| T-04 | Permission permanently denied | Tap "don't ask again" then deny | Settings fallback with deeplink | Component |
| T-05 | Scan valid paid ticket | Valid QR for this event, never used | Success overlay + Success haptic + ScanRecord saved | Full stack |
| T-06 | Scan duplicate same device | Same QR scanned twice within session | First success; second duplicate overlay with timestamp | Store + Component |
| T-07 | Scan QR for different event | QR encodes order from another event | wrong_event overlay; failed ScanRecord saved | Store + Component |
| T-08 | Scan malformed QR | Random text or non-mingla URL | not_found overlay "Invalid QR code" | Component |
| T-09 | Scan cancelled order | order.status === "cancelled" | cancelled_order overlay | Store + Component |
| T-10 | Scan refunded order (full) | order.status === "refunded_full" | void overlay | Store + Component |
| T-11 | Scan partially-refunded specific seat | Line refunded, scan that seat | void overlay; non-refunded seat scans success | Store + Component |
| T-12 | Multi-ticket count | qty=2 order, scan both tickets sequentially | After ticket 1: J-G1 "1 OF 2 CHECKED IN"; after ticket 2: "ALL CHECKED IN" | Store + Cycle 10 |
| T-13 | Scan offline | Airplane mode → scan valid QR | Success overlay; ScanRecord with offlineQueued=true; subsequent same-QR scan still detects duplicate | Store + Component |
| T-14 | Session activity log expand | Tap "Recent scans (N)" header | Expands list; newest-first; max 10 rows | Component |
| T-15 | Session activity log "Show all" | Tap CTA in expanded list | Modal sheet renders all session scans | Component |
| T-16 | Manual check-in J-G2 (order) | Tap "Mark checked in" on per-ticket row | ScanRecord with via="manual"; row pill flips to CHECKED IN; toast | Store + Cycle 10 |
| T-17 | Manual check-in J-G2 (comp) | Tap "Mark checked in" on comp detail | ScanRecord with ticketId=comp.id; J-G1 row pill updates | Store + Cycle 10 |
| T-18 | Activity feed event_scan kind | Successful scan on this event | Recent Activity card on Event Detail shows "{name} checked in" with check icon, success-green badge | Cycle 9c-2 wire |
| T-19 | Activity feed cap | 6+ events including scan | Only newest 5 visible; sort newest-first respected | Cycle 9c-2 wire |
| T-20 | Invite scanner — invalid email | Email "notanemail" | Confirm button disabled; "Enter a valid email." inline error | Component validation |
| T-21 | Invite scanner — valid | Valid name + email + canManualCheckIn=true | Sheet closes; new invitation in scanners list with PENDING; toast "Invitation pending — emails ship in B-cycle." | Store + Component |
| T-22 | Invite scanner — canAcceptPayments toggle disabled | Try toggle on | Toggle visually disabled; copy "Door payments coming in B-cycle"; canAcceptPayments stays false | Component |
| T-23 | Revoke pending invitation | Tap row → "Revoke invitation" → confirm | Status flips to REVOKED; row stays visible | Store + Component |
| T-24 | Revoke already-revoked (idempotent) | Tap revoked row | No revoke option in action sheet | Component |
| T-25 | Multi-ticket QR carousel — confirm.tsx | qty=2 order completes checkout | 2 QRs in horizontal swipe; dots indicator below; labels "Ticket 1 of 2 — {name}" / "Ticket 2 of 2 — {name}" | Cycle 8 |
| T-26 | Single-ticket QR — confirm.tsx | qty=1 order | ONE QR; NO dots indicator; visual parity with pre-Cycle-11 | Cycle 8 |
| T-27 | Multi-ticket QR carousel — /o/[orderId] | Open buyer order detail with qty=2 | Same carousel as confirm.tsx; ticketIdFromOrder helper REMOVED | Cycle 8 |
| T-28 | Cycle 10 column wire — partial | qty=3 order, 1 scan | J-G1 row pill: "1 OF 3 CHECKED IN" (accent orange) | Cycle 10 wire |
| T-29 | Cycle 10 column wire — full | qty=3 order, 3 scans | J-G1 row pill: "ALL CHECKED IN" (info green) | Cycle 10 wire |
| T-30 | Cycle 10 column wire — comp | Manual check-in for comp | J-G1 comp row: "CHECKED IN" pill | Cycle 10 wire |
| T-31 | Cycle 10 column wire — fully refunded | qty=2 order fully refunded | NO pill (don't render) | Cycle 10 wire |
| T-32 | Logout cascade | Sign out from operator | useScanStore.entries === []; useScannerInvitationsStore.entries === [] | Const #6 |
| T-33 | Cold-start hydration | Scan ticket → kill app → reopen | Scan persists; J-G1 still shows checked-in state | Const #14 |
| T-34 | Cross-event scoping (scans) | Scan ticket for event A; open J-G1 for event B | Event B's J-G1 does NOT show event A's scans | Selector scoping |
| T-35 | Cross-event scoping (invitations) | Invite scanner for event A | Event B's /scanners doesn't show event A's invitations | Selector scoping |
| T-36 | Different operator session log isolation | Operator B logs in after Operator A's scans | J-S4 session log shows only Operator B's scans (filtered by scannerUserId) | Selector |
| T-37 | tsc clean | `cd mingla-business && npx tsc --noEmit` (filter .expo/) | Exit 0 | Static |
| T-38 | No dead taps | Tap every button on scanner + scanners + InviteScannerSheet + J-G2 + carousel | Every tap responds | Const #1 |
| T-39 | No oklch / lab / lch | grep new files for forbidden color literals | 0 hits | Memory rule |
| T-40 | Selector pattern | grep `useScanStore((s) => s.getScans` and similar | 0 hits (forbidden direct subscription on fresh-array selectors) | Memory rule |
| T-41 | Buyer-route safety | grep app/o/ + app/e/ for useScanStore + useScannerInvitationsStore | 0 hits | I-21 |
| T-42 | parseTicketId edge cases | parseTicketId on `tkt_a_b_c_0_0`, malformed, missing prefix | Returns correct (orderId, lineIdx, seatIdx) for valid; null for malformed | Static |
| T-43 | parseQrPayload edge cases | parseQrPayload on valid + malformed payloads | Returns ParsedQrPayload for valid; null for malformed | Static |

---

## 8 — Invariants

### 8.1 Existing invariants this cycle preserves

| ID | Statement | How preserved | Test |
|----|-----------|---------------|------|
| **I-19** | Immutable order financials | Cycle 11 NEVER mutates OrderRecord; scans live in separate scanStore | T-37 + code review |
| **I-20** | Edit reason mandatory + audit log permanence | Manual scans don't capture reason (operator's auth identity is the audit); QR scans are operational signal | N/A — different audit pattern |
| **I-21** | Anon-tolerant buyer routes | J-S8 modifies `/o/[orderId]` for QR rendering only; no useAuth introduced | T-41 |
| **I-25** | Comp guests in useGuestStore ONLY | preserved; comp manual check-ins write to scanStore, not back to guestStore | T-37 + code review |
| **I-26** | LiveEvent.privateGuestList no buyer surface | unchanged | (no Cycle 11 touchpoint) |
| **Const #1** | No dead taps | Every button responds | T-38 |
| **Const #2** | One owner per truth | useScanStore = sole scan authority; useScannerInvitationsStore = sole invitation authority | T-37 |
| **Const #6** | Logout clears | reset() wired in clearAllStores | T-32 + SC-27 |
| **Const #8** | Subtract before adding | handleScanTickets toast removed before adding router.push; ticketIdFromOrder helper DELETED | T-37 + code review |
| **Const #9** | No fabricated data | Empty states honest; no fake scans seeded | T-38 + code review |
| **Const #14** | Persisted-state startup | Zustand persist v1 hydrates cleanly | T-33 |

### 8.2 NEW invariants this cycle establishes

#### I-27 — Each ticketId scanned successfully exactly once

**Statement:** For each unique `ticketId` in the system, there is AT MOST ONE `ScanRecord` with `scanResult === "success"`. Cycle 11 enforces single-device via `useScanStore.getSuccessfulScanByTicketId(ticketId)` lookup before recording new success scans. **B-cycle MUST land DB enforcement (`scan_events.ticket_id` partial UNIQUE index WHERE `scan_result = 'success'` OR edge-function pre-insert check) before multi-device scanning is enabled.**

**Origin:** Cycle 11 (2026-05-02)
**Enforcement (Cycle 11):** Client-side check in J-S1 + J-S5 → returns "Already checked in" overlay on duplicate
**Enforcement (B-cycle):** DB partial UNIQUE constraint
**Test:** SC-4 + T-06 (single-device). B-cycle adds cross-device verification.

#### I-28 — Scanner-invitation UI without functional flow until B-cycle

**Statement:** Cycle 11's `useScannerInvitationsStore.recordInvitation` creates a pending invitation in client-side store ONLY. NO email sends. NO acceptance flow exists. NO auth gate is enforced for non-operator users (operator-as-scanner is the only working identity model). Invitation rows MAY remain `status: "pending"` indefinitely until B-cycle wires backend functional flow.

**Origin:** Cycle 11 (2026-05-02)
**Enforcement:** Source-doc TRANSITIONAL marker + EXIT CONDITION + visible TRANSITIONAL banner on /scanners surface
**Test:** SC-18 + SC-19 + T-21

**Implementor pre-flight:** confirm next-available invariant numbers in `Mingla_Artifacts/INVARIANT_REGISTRY.md` before locking I-27 + I-28 IDs. If those numbers are taken (Cycle 10 used I-25 + I-26; ORCH-0706 may consume I-22..24), bump to next free. Document final IDs in implementation report.

---

## 9 — Implementation order

Numbered sequence. Implementor follows exactly; verify between major milestones.

1. **Type extensions:**
   - `ActivityEvent` discriminated union in `app/event/[id]/index.tsx` gets `event_scan` kind
   - tsc clean checkpoint
2. **NEW utilities:**
   - `src/utils/expandTicketIds.ts`
   - `src/utils/qrPayload.ts`
   - tsc clean checkpoint
3. **NEW store:** `src/store/scanStore.ts` per §4.6
4. **NEW store:** `src/store/scannerInvitationsStore.ts` per §4.7
5. **Wire logout cascade:** `src/utils/clearAllStores.ts` — both new stores
6. **`/ui-ux-pro-max` pre-flight** for J-S1 + J-S7 (memory rule mandate)
7. **J-S8 Cycle 8 surface fix:** `app/checkout/[eventId]/confirm.tsx` + `app/o/[orderId].tsx` — multi-QR carousel + DELETE local `ticketIdFromOrder` helper from `/o/[orderId].tsx`
   - tsc + manual smoke confirm.tsx with qty=1 + qty=2 + qty=3 → carousel works
8. **InviteScannerSheet:** `src/components/scanners/InviteScannerSheet.tsx` per §4.10/J-S7 sub-sheet
9. **Scanner-team route:** `app/event/[id]/scanners/index.tsx` per §4.10/J-S7
10. **Scanner camera route:** `app/event/[id]/scanner/index.tsx` per §4.10/J-S1+S2+S3+S4 (single screen with overlay + session log)
    - Includes: `parseQrPayload` integration, scan handler logic, overlay rendering, session log expand/collapse
11. **J-S5 Cycle 10 J-G2 manual CTA:** `app/event/[id]/guests/[guestId].tsx` MOD — per-ticket section + manual check-in handler
12. **J-S6 Cycle 10 J-G1 column rewire:** `app/event/[id]/guests/index.tsx` MOD — derive check-in state from useScanStore
13. **Cycle 9c-2 activity feed extension:** `app/event/[id]/index.tsx` MOD — add event_scan kind to recentActivity useMemo + activityKindSpec + ActivityRow rendering + activityRowKey
14. **Wire `handleScanTickets` stub replacement:** `app/event/[id]/index.tsx` — replace toast with `router.push(\`/event/${id}/scanner\`)`. SUBTRACT toast (Const #8).
15. **Add Scanners ActionTile** to Event Detail action grid (next to Scan tickets) → `router.push(\`/event/${id}/scanners\`)`
16. **Verification matrix:**
    - `cd mingla-business && npx tsc --noEmit` (filtered)
    - Manual smoke T-01 through T-43
    - grep checks per SC-26, SC-30
17. **Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_11_QR_SCANNER_REPORT.md` per `references/report-template.md` 15-section template

---

## 10 — Forward backend handoff (B-cycle requirements)

Cycle 11 ships UI-complete; B-cycle ships functional. The B-cycle dispatch must include:

### 10.1 scan-ticket edge function (DB requirement #1)

- New edge function: `supabase/functions/scan-ticket/index.ts`
  - Accepts: `{ ticketId: string, eventId: string, clientScanId?: string }` from authenticated scanner
  - Validates: ticket exists in `tickets` table; `tickets.event_id === eventId`; `tickets.status === 'valid'`; no existing successful scan_event row for this ticketId (UNIQUE check)
  - Writes to `scan_events` with appropriate `scan_result` enum value
  - Updates `tickets.used_at` + `used_by_scanner_id` + `tickets.status = 'used'` on success
  - Returns: `{ scanResult: ScanResult, recordedAt: string, scannerName?: string }` for client-side mirror
- **DB CHECK extension required:** `scan_events.scan_result` CHECK enum must extend `('success', 'duplicate', 'not_found', 'wrong_event', 'void')` to include `'cancelled_order'` per investigation D-CYCLE11-FOR-3 — OR alias `'cancelled_order' → 'void'` in client mapping
- **DB UNIQUE enforcement:** Either partial UNIQUE index on `scan_events (ticket_id) WHERE scan_result = 'success'` OR edge-function pre-insert lookup. Recommend partial index for atomicity — race condition between concurrent scans of same ticket impossible with index.

### 10.2 Scanner-invitation backend (J-S7 functional flow)

- Edge function: `supabase/functions/invite-scanner/index.ts`
  - Accepts: `{ eventId, inviteeEmail, inviteeName, permissions }` from authenticated operator
  - Validates: operator owns or admins event's brand (RLS check via `brand_team_members`)
  - Writes to `scanner_invitations` table with `status='pending'`
  - Sends Resend email with magic-link to acceptance route (signed token)
- Edge function: `supabase/functions/accept-scanner-invitation/index.ts`
  - Token-gated route (signed JWT in invitation email)
  - On accept: inserts row to `event_scanners` linking `auth.users.id` to `event_id`
  - Updates `scanner_invitations.status = 'accepted'` + `accepted_at`
- Auth gate at `/event/{id}/scanner` route (Cycle 11 skips this; B-cycle enables): check `event_scanners` membership for non-operator users. Operator-as-scanner v1 (Cycle 11) bypasses this check entirely.

### 10.3 Sync architecture for offline queue (Cycle 11 client → B-cycle backend)

- When client comes online (network state listener), batch-replay `useScanStore.entries.filter(s => s.offlineQueued === true)` to `scan-ticket` edge function (one call per scan, OR new bulk endpoint `scan-ticket-batch`)
- Backend deduplicates against existing `scan_events` rows via UNIQUE constraint (idempotent on retry)
- After successful sync per scan, flip `offlineQueued: false` in client store
- Conflict resolution: if backend rejects with `{ scanResult: "duplicate" }` for a scan client recorded as `success`, surface to operator with copy "Cross-device duplicate detected" — only relevant when multi-scanner concurrency lands

### 10.4 Migration cutover plan

- B-cycle migration moves `useScanStore.entries` → backend `scan_events`
- Cycle 11 client store contracts to a **read-through cache** (or removes entirely if backend is sole authority)
- `useScannerInvitationsStore` similar migration to `scanner_invitations`
- API surface (`recordScan`, `getScanByTicketId`, etc.) preserved across cutover — only the underlying source changes

---

## 11 — Regression prevention

| Risk | Structural safeguard | Test |
|------|----------------------|------|
| Filter pills sneak into J-G1 search (Cycle 10 hard line) | Hard-line in §3.2 + grep test (continues from Cycle 10) | T-39 |
| Comp guests fabricated as phantom orders | I-25 invariant (preserved from Cycle 10) | T-37 |
| Buyer-facing surface introduced | I-21 + I-26 + grep test SC-22 (continues) | T-41 |
| Fresh-array selector pattern returns | Selector rule documented in store headers + grep test | T-40 |
| Activity feed entries silently filtered | `event_scan` kind explicitly added; T-18 verifies feed visibility | T-18 |
| Logout doesn't clear new stores | Const #6 + clearAllStores wire + T-32 | T-32 + SC-27 |
| Cold-start state drift | Const #14 + Zustand persist v1 + T-33 | T-33 |
| Cross-event scan leakage | Selector scoping in J-G1 + J-S4 (filter by eventId) + T-34 | T-34 |
| Scanner-invitation toggles canAcceptPayments | TYPE-LOCKED to false in `recordInvitation` + UI toggle disabled + SC-20 | T-22 |
| Multi-ticket QR carousel breaks single-ticket UX | Conditional render (no dots if length === 1) + T-26 | T-26 |
| Operator scans own QR for testing → marks real ticket as used | Single-device duplicate prevention (I-27); operator can re-scan to see "Already used"; documented as expected | T-06 |

**Protective comments required in code:**

- `scanStore.ts` header: I-27 statement verbatim
- `scannerInvitationsStore.ts` header: I-28 statement verbatim with TRANSITIONAL EXIT CONDITION
- `app/o/[orderId].tsx` near `expandTicketIds` import: `// Cycle 11 J-S8 — multi-ticket QR carousel; SUBTRACTS local ticketIdFromOrder helper per Const #8`
- `recordScan` in scanStore: `// Caller-side audit log per Cycle 9c v2 require-cycle pattern; orderId === "" indicates comp manual check-in (synthetic ticketId = comp.id)`
- `permissions.canAcceptPayments` field in scannerInvitationsStore: `// ALWAYS false in Cycle 11 — gated on §6.2 B-cycle scanner-payments. EXIT: B-cycle enables this toggle.`

---

## 12 — Cross-references

- Investigation: [`reports/INVESTIGATION_BIZ_CYCLE_11_QR_SCANNER.md`](../reports/INVESTIGATION_BIZ_CYCLE_11_QR_SCANNER.md)
- Dispatch: [`prompts/SPEC_BIZ_CYCLE_11_QR_SCANNER.md`](../prompts/SPEC_BIZ_CYCLE_11_QR_SCANNER.md)
- PRD source: `Mingla_Artifacts/BUSINESS_PRD.md` §6
- Cycle 10 spec (sister-pattern reference): [`specs/SPEC_BIZ_CYCLE_10_GUEST_LIST.md`](./SPEC_BIZ_CYCLE_10_GUEST_LIST.md)
- Cycle 10 close commit: `dc75b5dd` (Sister patterns: AddCompGuestSheet, app/event/[id]/guests/, useGuestStore)
- Cycle 9c-2 activity feed (J-S extension target): commit `5e4b04d2`
- Cycle 9c v3 backlog (D-9c-V3-3 closed by event_scan kind): [`reports/IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT_v3.md`](../reports/IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT_v3.md) §8
- ORCH-0704 edit-log infrastructure: [`reports/IMPLEMENTATION_ORCH-0704_FULL_EDIT_AFTER_PUBLISH_REPORT.md`](../reports/IMPLEMENTATION_ORCH-0704_FULL_EDIT_AFTER_PUBLISH_REPORT.md)
- Cycle 8 QR utility (J-S8 modifies via expandTicketIds): `mingla-business/src/utils/stubOrderId.ts`
- PR #59 schema head: `836ce108054800aba1573d8bc30684f5728a86ce` (scan_events + tickets.used_* + event_scanners + scanner_invitations + biz_scan_events_block_mutate)
- Memory rules referenced: `feedback_keyboard_never_blocks_input`, `feedback_rn_color_formats`, `feedback_implementor_uses_ui_ux_pro_max`, `feedback_anon_buyer_routes`, `feedback_orchestrator_never_executes`, `feedback_no_coauthored_by`, `feedback_post_pass_protocol`, `feedback_no_summary_paragraph`, `feedback_diagnose_first_workflow`

---

## 13 — Output contract for the implementor

Implementor produces TWO things:

1. **Code changes** per §9 implementation order
2. **Implementation report** at `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_11_QR_SCANNER_REPORT.md`

The report MUST include:

- Old → New receipts for every file modified or created (~15 files expected)
- SC-1..SC-30 verification matrix with PASS / UNVERIFIED labels per SC
- T-01..T-43 outcomes
- Invariant registrations: confirmed final I-27 / I-28 IDs in `INVARIANT_REGISTRY.md`
- Memory rule deference proof: `/ui-ux-pro-max` invoked pre-flight on J-S1 + J-S7 with applied guidance
- Constitutional compliance scan (14 principles)
- Cache safety: confirm new selector pattern grep-clean
- Regression surface: 3-5 adjacent features tester should spot-check (Cycle 9c-2 feed, Cycle 10 J-G1+J-G2, Cycle 8 confirm.tsx, OrderDetail at /o/[orderId])
- Discoveries for orchestrator (any new side issues)
- Transition items (`[TRANSITIONAL]` comments + EXIT CONDITIONs)
- Files touched matrix (path + action + LOC delta)
- Verification commands run + outputs

Implementor MUST NOT:

- Re-debate any locked decision from §2
- Add scope beyond §3.1
- Touch backend / RLS / edge functions
- Skip the `/ui-ux-pro-max` pre-flight on J-S1 + J-S7
- Build a real scanner-invitation acceptance flow (TRANSITIONAL stub only — no email, no acceptance route)
- Silently override an invariant — surface to operator if conflict arises

If the spec is wrong or contradicts what the implementor finds in code: STOP. State the contradiction. Wait for direction.
