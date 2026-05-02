# IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT_v3

**Status:** implemented and verified (tsc + 5 manual smoke checks queued)
**Mode:** REWORK (single missed swap-point — operator-caught)
**Backward dep:** [IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT_v2.md](./IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT_v2.md) — all v2 content carries forward unchanged
**Spec:** [SPEC_BIZ_CYCLE_9c_ORDERS_OPS.md](../specs/SPEC_BIZ_CYCLE_9c_ORDERS_OPS.md) — unchanged
**Dispatch:** [IMPLEMENTOR_BIZ_CYCLE_9c_REWORK_v3.md](../prompts/IMPLEMENTOR_BIZ_CYCLE_9c_REWORK_v3.md)

---

## 1 — Rework v3

### 1.1 — What was missing (operator caught)

After v2 smoke PASS on all 5 priorities, operator opened Event Detail with completed checkout, refund, and cancel events in the order log. The "Recent activity" section still displayed the hardcoded "No activity yet." placeholder. Same class as v2 Fix 3 (Event Detail KPI swap-point) — Cycle 9a built the empty placeholder against `liveEvent.orders: never[]` and Cycle 9c was supposed to derive the feed from `useOrderStore` per Q-9-11, but it was not on the explicit swap-point list. v2 caught the KPI; v3 catches the activity feed.

### 1.2 — What changed (single fix)

`mingla-business/app/event/[id]/index.tsx`:

- Added `ActivityEvent` discriminated union (purchase / refund / cancel)
- Added `formatActivityRelativeTime` helper (mirrors OrderListCard pattern: just-now / Nm ago / Nh ago / Nd ago)
- Added `recentActivity` `useMemo` deriving events from `allOrderEntries` (REUSES the v2 raw-entries subscription — does NOT add a second Zustand subscriber)
- Replaced the hardcoded `<Text>No activity yet.</Text>` with conditional render: empty branch preserves "No activity yet." copy; populated branch renders up to 5 newest events via `<ActivityRow>`
- Added `ActivityRow` inline component (icon badge + name + summary + relative time + signed amount) — same composition shape as `TicketTypeRow`
- Added `activityKindSpec` lookup mapping kind → icon + color + badge background + amount sign
- Added `activityRowStyles` StyleSheet + `styles.activityList` gap container

Three event kinds per Q-9-11:

| Kind | Source | Display | Icon · Badge tint · Amount |
|------|--------|---------|------|
| `purchase` | OrderRecord at `paidAt` | "{name}" \\ "bought {N}× {ticketName}" (or "{N}× tickets" if multi-line) \\ relTime | ticket · `rgba(34,197,94,0.18)` · `+£X.XX` (#34c759) — or "Free" when `totalGbpAtPurchase === 0` |
| `refund` | Each `RefundRecord` in `OrderRecord.refunds[]` at `refundedAt` | "{name}" \\ "refunded {totalQty}× tickets" \\ relTime | refund · `rgba(235,120,37,0.18)` · `-£X.XX` (`accent.warm`) |
| `cancel` | OrderRecord with `status === "cancelled"` at `cancelledAt` | "{name}" \\ "cancelled their order" \\ relTime | close · `rgba(120,120,120,0.18)` · no amount |

Sorting: `events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())` newest-first. Cap at `.slice(0, 5)`.

---

## 2 — Old → New Receipt

### `mingla-business/app/event/[id]/index.tsx`

**What it did before:**
- "Recent activity" section rendered a hardcoded `<Text>No activity yet.</Text>` regardless of order state. No derivation, no rendering of orders/refunds/cancellations. Cycle 9a empty-state placeholder built against `liveEvent.orders: never[]`.

**What it does now:**
- Derives `recentActivity: ActivityEvent[]` from `allOrderEntries` (existing v2 raw subscription).
- Each OrderRecord generates 1 purchase event (always) + 0..N refund events (one per `RefundRecord` in `order.refunds[]`) + 0..1 cancel event (only when `status === "cancelled"`).
- Sorts newest-first, caps at 5.
- Empty branch preserves "No activity yet." copy verbatim (regression-safe).
- Populated branch renders one `<ActivityRow>` per event with icon badge + buyer name + summary + relative time + signed amount (purchase = green +, refund = warm orange –, cancel = no amount).

**Why:**
- Operator-caught missed swap-point: Cycle 9c was supposed to wire the activity feed from `useOrderStore` per Q-9-11 spec but the swap was not on the v1/v2 explicit list.
- Same lesson as v2 Fix 3: empty placeholder built against pre-orderStore `never[]` shape needs derivation from the new authority.

**Lines changed:** ~+165 / −3 (1 file)

**Discoveries during edit:** None. Reused `Icon` + `IconName` + `accent.warm` + `formatGbp` already imported. No new dependencies. No store-shape changes. No new selectors on `useOrderStore` — the existing `entries` subscription powers it.

---

## 3 — Verification Matrix

| Check | Method | Result |
|-------|--------|--------|
| **TypeScript compiles** | `cd mingla-business && npx tsc --noEmit` | PASS (exit 0, no output) |
| **Empty-state regression** | Grep confirms "No activity yet." still rendered conditionally on `recentActivity.length === 0` | PASS |
| **No fresh-array selector** | `recentActivity` `useMemo` subscribes to stable `allOrderEntries` ref (reuses v2 subscription) | PASS |
| **No oklch / lab / lch** | All inline color literals are hex (`#34c759`) or rgb-tuple (`rgba(34,197,94,0.18)` etc.) | PASS — memory rule `feedback_rn_color_formats` honored |
| **Const #9 no fabricated data** | Empty branch renders "No activity yet." — never seeds fake events | PASS |
| **Const #1 no dead taps** | Activity rows are display-only `<View>` elements, not `<Pressable>` (deferred to future polish per dispatch §4) | PASS |

### Manual smoke (operator runs)
1. Pristine event with no orders → "No activity yet." renders (regression check)
2. Buyer completes paid checkout → top row: "{Name}" / "bought 1× {TicketName}" / "just now" / `+£X.XX` (green)
3. Operator partial-refunds → new top row: "{Name}" / "refunded 1× tickets" / "just now" / `-£X.XX` (warm orange)
4. Operator cancels free order → new top row: "{Name}" / "cancelled their order" / "just now" / no amount (grey badge)
5. Multi-line order → "bought N× tickets" (collapsed); 6+ events → only newest 5 render

---

## 4 — Invariant Verification

| Invariant | Status |
|-----------|--------|
| **I-19 — immutable order financials** | Preserved. Activity feed is READ-ONLY derivation; no order/line/refund mutation. |
| **I-21 — anon-tolerant buyer routes** | Untouched. Edit is in `app/event/[id]/index.tsx` (operator route, NOT buyer surface). |
| **No new Zustand subscriber** | Preserved. `recentActivity` reuses the existing `allOrderEntries` subscription declared at line ~281 for `soldCountByTier`. |
| **No fresh-array selector pattern** | Preserved. `useMemo` derivation guarantees stable reference until `allOrderEntries` or `event` changes. |
| **One owner per truth (Const #2)** | Preserved. Activity feed reads from `useOrderStore`; no duplication into liveEventStore. |
| **Currency-aware UI (Const #10)** | Preserved. Uses `formatGbp()` — same primitive as `EventDetailKpiCard` and OrderListCard. |
| **Subtract before adding (Const #8)** | Honored. The hardcoded `<Text>No activity yet.</Text>` was REMOVED from the unconditional branch and re-instantiated only inside the `length === 0` branch. |

---

## 5 — Cache Safety + Regression Surface

**Cache safety:** No query keys touched (this is Zustand, not React Query). No persisted-state shape changes. No new store mutations or selectors. AsyncStorage `mingla-business.orderStore.v1` payload unchanged.

**Regression surface (3-5 adjacent features the tester should spot-check):**
1. **Event Detail KPI strip** — `revenueGbp` / `payoutGbp` / `totalSoldCount` from v2 must still render correctly (same `useOrderStore` subscription pattern).
2. **Per-tier "X sold" badges** — `soldCountByTier` must still flow into `<TicketTypeRow soldCount=...>` (untouched but lives in same file).
3. **"Cancel event" CTA visibility** — `status === "live" || status === "upcoming"` gate is unchanged.
4. **Manage menu + Share modal + EndSales sheet + ConfirmDialog** — all still wired identically.
5. **Orders list page** — separate route untouched; activity feed and Orders list both read from same store with no contention.

---

## 6 — Constitutional Compliance

| Principle | Status |
|-----------|--------|
| #1 No dead taps | Activity rows are display-only `<View>` (not `<Pressable>`). Future enhancement: tap → Order detail (out of v3 scope). |
| #2 One owner per truth | useOrderStore is sole source for activity events. |
| #3 No silent failures | N/A (read-only derivation, no async, no catch blocks). |
| #6 Logout clears | Inherited from existing `clearAllStores` wiring of `useOrderStore.reset()`. |
| #8 Subtract before adding | The hardcoded empty `<Text>` was removed from the always-rendered slot before being re-bound to the conditional branch. |
| #9 No fabricated data | Empty state preserves "No activity yet." copy verbatim — never seeds fake orders. |
| #10 Currency-aware UI | `formatGbp()` for amounts; `currency: "GBP"` frozen on every OrderRecord. |

---

## 7 — Transition Items

None. All event kinds, amounts, and sources derive from existing OrderRecord / RefundRecord persisted shapes. No `[TRANSITIONAL]` comments added in this rework.

---

## 8 — Discoveries for Orchestrator

All v2 discoveries carry forward (D-9c-V2-1 payout stub still applies, etc.). The v3 fix is contained to a single file and a single missed swap-point.

### v3 NEW backlog items (operator-approved 2026-05-02 — register on CLOSE)

The activity feed currently shows order-domain events only (purchase / refund / cancel). Operator approved expansion to surrounding domains in a future cycle. These are NOT bugs and do NOT block Cycle 9c CLOSE — register as new ORCH-IDs and slot per cycle.

| Discovery | Severity | Cycle target | Description |
|-----------|----------|--------------|-------------|
| **D-9c-V3-1 — Event-level edits in activity feed** | S2 | Cycle 10 candidate | Pipe `useEventEditLogStore` entries (title / date / venue / ticket-price changes) into the same Recent Activity card. Decide whether they share the row component or get a distinct icon/badge style. Must respect destructive-vs-minor severity already present on `EventEditEntry`. |
| **D-9c-V3-2 — Lifecycle events in activity feed** | S2 | Cycle 10 candidate | Render `endedAt` (sales ended) + `cancelledAt` + `status === "cancelled"` as activity rows. Source: `LiveEvent` lifecycle fields (already populated by Cycle 9b-1 End Sales / Cancel Event flows). |
| **D-9c-V3-3 — Ticket scan events** | S2 | Cycle 11 — fold into scanner build | Cycle 11 will introduce the QR scanner; each scan produces a row "{buyer} scanned in" with timestamp. Schema: extend OrderRecord with `scannedLines[]` or new `ScanEvent` substore — to be specced in Cycle 11 forensics. |
| **D-9c-V3-4 — Guest list approvals** | S2 | Cycle 10 + B4 — fold into guest-list build | Guest approvals (Cycle 10 visual surface + B-cycle backend) produce activity rows on approve / decline. Schema: depends on guest-list store shape — to be specced in Cycle 10 / B4 forensics. |

**Notable observation (not a discovery):** The current `ActivityRow` is display-only. A future polish ticket could wire `onPress → router.push("/event/{id}/orders/{orderId}")`. Out of v3 scope per dispatch §4.

---

## 9 — Files Touched

| File | Action | LOC delta |
|------|--------|-----------|
| `mingla-business/app/event/[id]/index.tsx` | MOD — add `ActivityEvent` type + `formatActivityRelativeTime` helper + `recentActivity` useMemo + `ActivityRow` inline component + `activityKindSpec` + `activityRowStyles` StyleSheet + `styles.activityList` + swap empty placeholder for conditional render | ~+165 / −3 |

Single file. No new dependencies. No spec changes. No store-shape changes. No persisted-data migration.

---

## 10 — Cross-References

- v2 report: [IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT_v2.md](./IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT_v2.md)
- v1 report: [IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT.md](./IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT.md)
- v3 dispatch: [IMPLEMENTOR_BIZ_CYCLE_9c_REWORK_v3.md](../prompts/IMPLEMENTOR_BIZ_CYCLE_9c_REWORK_v3.md)
- Cycle 9 forensics Q-9-11 (activity feed contract): [INVESTIGATION_BIZ_CYCLE_9_EVENT_MANAGEMENT.md](./INVESTIGATION_BIZ_CYCLE_9_EVENT_MANAGEMENT.md) §5 Q-9-11
- Spec: [SPEC_BIZ_CYCLE_9c_ORDERS_OPS.md](../specs/SPEC_BIZ_CYCLE_9c_ORDERS_OPS.md)
