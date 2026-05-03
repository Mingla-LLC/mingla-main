# Implementation v2 — BIZ Cycle 9c rework (3 fixes after smoke FAIL)

**Status:** implemented, partially verified
**Verification:** tsc PASS · require cycle BROKEN · selector audit clean · runtime UNVERIFIED (awaits user re-smoke)
**Scope:** 6 MOD · ~+95 / -130 LOC (~-35 net) · 0 schema migrations · 0 new files
**Spec:** [SPEC_BIZ_CYCLE_9c_ORDERS_OPS.md](../specs/SPEC_BIZ_CYCLE_9c_ORDERS_OPS.md) — unchanged
**Rework dispatch:** [IMPLEMENTOR_BIZ_CYCLE_9c_REWORK_v2.md](../prompts/IMPLEMENTOR_BIZ_CYCLE_9c_REWORK_v2.md)
**v1 report:** [IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT.md](IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT.md) — all v1 sections except the 3 reworked items carry forward

---

## 1 — Rework summary (what failed in v1, what changed in v2)

| Failure | Symptom | Fix |
|---------|---------|-----|
| **Require cycle** | Console: `Require cycle: src/store/liveEventStore.ts -> src/store/orderStore.ts -> src/store/liveEventStore.ts` | Moved notify + edit-log side effects OUT of `orderStore.recordRefund` + `cancelOrder` mutations and INTO the calling components (`RefundSheet.tsx` + `CancelOrderDialog.tsx`). orderStore is now pure data. |
| **Infinite loop on Orders list** | Console: `The result of getSnapshot should be cached to avoid an infinite loop` + `Maximum update depth exceeded`. Selector returned a fresh filtered array each render. | Converted both array-returning Zustand selectors (`Orders list` + `buyer page materialEdits`) to raw-entries-plus-useMemo pattern. Mirrors existing `useLiveEventBySlug` (liveEventStore.ts:194-207). |
| **Event Detail "0 sold" KPI + per-tier 0 sold** | KPI tile + per-tier rows showed hardcoded 0; never swapped to useOrderStore in v1 — missed swap-point. EventListCard worked correctly so data flow is fine. | Wired `revenueGbp` + `payoutGbp` + `totalSoldCount` (Orders ActionTile) + per-tier `soldCount` map (TicketTypeRow) to useOrderStore selectors. |

All 3 fixes surgical; spec unchanged.

---

## 2 — Old → New Receipts (rework only)

### `mingla-business/src/store/orderStore.ts` (-100 / +20 LOC net)
**Before:** `recordRefund` + `cancelOrder` imported `useLiveEventStore`, `useCurrentBrandStore`, `useEventEditLogStore`, and `notifyEventChanged`/`deriveChannelFlags` to fire notification stack + record edit log directly inside the mutations. liveEventStore imports useOrderStore (Phase 2 swap) → require cycle.
**After:** all 5 imports removed. Both mutations stripped of post-`set(...)` side-effect blocks; they're now pure data mutations that return the updated `OrderRecord`. Caller (RefundSheet / CancelOrderDialog) reads the returned record + fires side effects from there. `cancelOrder` keeps `reason` parameter on signature for caller symmetry but `void reason`s it inside (caller uses the reason for the notification it fires).
**Why:** spec §3 Fix 1 — break require cycle by separating data ownership (store) from side-effect dispatch (component)

### `mingla-business/src/components/orders/RefundSheet.tsx` (+60 LOC)
**Before:** `handleConfirm` called `recordRefund(...)` and relied on the store to fire notification + edit log internally.
**After:** added imports for `useLiveEventStore`, `useCurrentBrandStore`, `useEventEditLogStore`, `notifyEventChanged`, `deriveChannelFlags`. After `recordRefund` returns non-null, the component reads the resolved `event` + `brand` + computes `allLinesFullyRefunded` from the returned status + fires `useEventEditLogStore.recordEdit` (severity "destructive", orderId set) + `notifyEventChanged` (banner + email + SMS always per destructive flags).
**Why:** spec §3 Fix 1 caller-side side-effect ownership

### `mingla-business/src/components/orders/CancelOrderDialog.tsx` (+50 LOC)
**Before:** same pattern — relied on store to fire notification + edit log.
**After:** mirror of RefundSheet's pattern. Imports for the same 5 modules. After `cancelOrder` returns non-null, fires `recordEdit` (severity "destructive", orderId set, diffSummary "Order cancelled") + `notifyEventChanged` (destructive flags).
**Why:** spec §3 Fix 1

### `mingla-business/app/event/[id]/orders/index.tsx` (+12 / -3 LOC)
**Before:**
```ts
const orders = useOrderStore((s) =>
  typeof eventId === "string" ? s.getOrdersForEvent(eventId) : [],
);
```
`getOrdersForEvent` returns `entries.filter(...)` — fresh array reference each render → useSyncExternalStore infinite loop.
**After:**
```ts
const allOrderEntries = useOrderStore((s) => s.entries);
const orders = useMemo<OrderRecord[]>(
  () =>
    typeof eventId === "string"
      ? allOrderEntries.filter((o) => o.eventId === eventId)
      : [],
  [allOrderEntries, eventId],
);
```
Subscribes to the stable raw `entries` array; filter computed in useMemo (stable ref between renders unless allEntries or eventId changes).
**Why:** spec §3 Fix 2 — mirror useLiveEventBySlug pattern

### `mingla-business/app/o/[orderId].tsx` (+10 / -7 LOC)
**Before:** `materialEdits` used inline `useEventEditLogStore((s) => { ... s.entries.filter(...) })` which returned a fresh filtered array each render.
**After:** subscribes to raw `entries` via `useEventEditLogStore((s) => s.entries)`; runs the same filter in `useMemo` keyed on `[editLogEntries, order]`. Imports `EventEditEntry` type for the useMemo annotation.
**Why:** spec §3 Fix 2

### `mingla-business/app/event/[id]/index.tsx` (+45 / -10 LOC)
**Before:**
- `revenueGbp = 0` and `payoutGbp = 0` literal stubs (Cycle 9a placeholder)
- `<ActionTile sub={\`${0} sold\`} />` hardcoded
- TicketTypeRow inline: `const sold = 0;` literal stub
**After:**
- `revenueGbp` from `useOrderStore.getRevenueForEvent(event.id)` (returns NUMBER — safe selector)
- `payoutGbp = Math.round(revenueGbp * 96) / 100` (4% TRANSITIONAL stub Stripe fee retention; B-cycle wires real Stripe payouts)
- `totalSoldCount` from `useOrderStore.getSoldCountForEvent(event.id)` (returns NUMBER — safe)
- ActionTile sub now `\`${totalSoldCount} sold\``
- New `soldCountByTier` map computed in useMemo from raw `useOrderStore.entries` (avoids `getSoldCountByTier` returning fresh Record<string,number> each render). TicketTypeRow extended with `soldCount: number` prop; parent passes `soldCountByTier[ticket.id] ?? 0` per row.
**Why:** spec §3 Fix 3 — KPI wired live; per-tier sold count derives correctly per ticket

---

## 3 — Verification matrix

| Goal | Method | Result |
|------|--------|--------|
| Require cycle broken | `grep -rn "from \"./liveEventStore\"\|from \"../liveEventStore\"" mingla-business/src/store/orderStore.ts` | **PASS** — zero hits |
| tsc EXIT=0 | `cd mingla-business && npx tsc --noEmit` | **PASS** — no errors |
| No fresh-array Zustand selectors remain | grep all `useOrderStore((s) => s.*)` + manual audit | **PASS** — only primitives, raw entries, or stable mutation refs subscribed |
| `getOrdersForEvent` no longer used as a subscriber | grep — should be ONLY `.getState().getOrdersForEvent` (imperative) | **PASS** — 2 callers, both use `.getState()` (liveEventStore line 400 + EditPublishedScreen line 594) |
| Event Detail KPI live (Fix 3) | code review + manual smoke | UNVERIFIED runtime — needs user re-smoke |
| Side effects fire from caller, not store | code review | **PASS** — RefundSheet + CancelOrderDialog handleConfirm both fire recordEdit + notifyEventChanged inline |
| Initial smoke priorities 1-3 unblocked | manual smoke | UNVERIFIED — needs user re-smoke (was the showstopper) |

---

## 4 — Files Touched (rework only)

| File | Action | LOC |
|------|--------|-----|
| `mingla-business/src/store/orderStore.ts` | MOD | -100 / +20 (5 imports removed; 2 side-effect blocks stripped) |
| `mingla-business/src/components/orders/RefundSheet.tsx` | MOD | +60 / -1 |
| `mingla-business/src/components/orders/CancelOrderDialog.tsx` | MOD | +50 / -1 |
| `mingla-business/app/event/[id]/orders/index.tsx` | MOD | +12 / -3 |
| `mingla-business/app/o/[orderId].tsx` | MOD | +10 / -7 |
| `mingla-business/app/event/[id]/index.tsx` | MOD | +45 / -10 |
| **Net** | | ~+197 / -122 (~+75 net) |

6 MOD. v1 NEW files (orderStore + 5 components/routes) and v1 MOD files (eventEditLogStore + eventChangeNotifier + clearAllStores etc.) carry forward unchanged.

---

## 5 — Invariant Verification

| ID | Status |
|----|--------|
| I-11..I-17 | PRESERVED (no shape changes; opaque IDs unchanged) |
| I-18 (buyer→founder order persistence) | PRESERVED — confirm.tsx recordOrder wire untouched |
| I-19 (immutable order financials) | PRESERVED — API surface still excludes update/delete on snapshot fields; recordRefund still spreads + appends; cancelOrder still touches only status+cancelledAt |
| I-20 (edit reason mandatory + audit log permanence) | PRESERVED — refund/cancel reasons still captured (caller now records the entry; same data shape lands in useEventEditLogStore) |
| I-21 (anon-tolerant buyer routes) | PRESERVED — `/o/[orderId]` MUST NOT call useAuth; rework only changed materialEdits selector pattern; no auth-related additions |

---

## 6 — Cache safety

No new query keys (no React Query). Zustand subscriptions in EventListCard + Orders list + Order detail + buyer page now stable (raw entries + useMemo). New AsyncStorage key still `mingla-business.orderStore.v1` (no version bump; data shape unchanged).

---

## 7 — Regression Surface (tester re-verify)

**Same 5 surfaces as v1, all should now actually work:**

1. **Smoke 1 (paid refund happy path)** — should now succeed without infinite loop. Refund sheet opens, completes, fires `[email-stub]` AND `[sms-stub]` (now from RefundSheet handleConfirm caller, not store).
2. **Smoke 2 (buyer page anon-tolerant)** — MaterialChangeBanner consumer no longer infinite-loops; page renders without sign-in prompt.
3. **Smoke 3 (material change banner)** — operator edits → banner shows reason → "Got it" advances lastSeenEventUpdatedAt.
4. **Smoke 4 (ORCH-0704 regression)** — guard rails fire; "Open Orders" navigates to `/event/[id]/orders` (was already correct in v1; this rework didn't touch it but liveEventStore.ts is no longer in a require cycle so cleaner runtime).
5. **NEW Event Detail KPI** — after one paid checkout, the Event Detail screen's "Orders" ActionTile shows "1 sold" (was "0 sold"); revenue card shows real revenue; per-tier rows show "X / capacity" with correct sold count.

---

## 8 — Discoveries for Orchestrator (rework cycle)

**D-9c-V2-1 (Note severity)** — `payoutGbp = revenueGbp × 0.96` is a stub TRANSITIONAL value (4% Stripe fee retention assumed). Real Stripe fees vary (1.5% domestic + 20p, 2.5% European, etc.). Marked TRANSITIONAL with EXIT CONDITION pointing at B-cycle real Stripe payouts. Acceptable for stub mode.

**D-9c-V2-2 (Note severity)** — Audit confirmed `useOrderStore((s) => s.getSoldCountByTier(eventId))` would have been an infinite-loop bug if used as a subscriber (returns `Record<string, number>` — fresh object each call). Avoided that pattern in Fix 3 by computing the per-tier map from raw `entries` in useMemo at the parent. Spec §3.2.2 documents `getSoldCountByTier` as a selector signature; in practice, callers must compose via raw entries when subscribing in components. Documented in code comment.

**D-9c-V2-3 (Low severity)** — `cancelOrder` keeps `reason` on its signature even though the store no longer uses it directly (`void reason`). This preserves API symmetry with `recordRefund` which takes `RefundRecord` (which itself contains `reason`). Future B-cycle that wires real Stripe cancel could re-introduce reason consumption inside the store; signature is forward-compatible.

**D-9c-V2-4 (Note severity)** — When the orderStore mutation returns null (order disappeared mid-flight, rare), the caller's side-effect block is gated by `if (result !== null)` — no notification + no edit log fires. Failure is silent at the caller but recordRefund/cancelOrder return null is itself a meaningful signal (caller's `onSuccess` either fires with `0` for RefundSheet or doesn't fire at all for CancelOrderDialog). Tester should verify the rare-case UX is acceptable.

**D-9c-V2-5 (Low severity)** — RefundSheet now accesses 5 stores (`useOrderStore`, `useLiveEventStore`, `useCurrentBrandStore`, `useEventEditLogStore`, plus the notifier service). Component is ~530 LOC post-rework. Could be refactored into a `fireOrderEventNotification(payload)` helper service if more order-event types are added in B-cycle, but for the current 2 cases (refund + cancel) inline is fine.

**No other side issues.**

---

## 9 — Status

**implemented, partially verified.**

- tsc EXIT=0 ✅
- Require cycle broken (zero liveEventStore imports in orderStore.ts) ✅
- Selector pattern audit clean (no fresh-array subscribers remain) ✅
- 6 grep gates from v1 still PASS (verified incidentally)
- Runtime UNVERIFIED — needs user re-smoke on the original 4 priorities

If smoke surfaces issues, return for v3 rework against specific failed criteria.
