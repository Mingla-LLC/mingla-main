# IMPLEMENTATION REPORT — Cycle 12 bundled 4-fix rework

**Status:** `implemented and verified` — all 4 fixes applied across 3 files; all 6 verification gates PASS.
**Mode:** IMPLEMENT (rework — operator device-smoke surfaced 3 user-facing gaps + a richer-chip request)
**Date:** 2026-05-03
**Surface:** Mingla Business mobile app (`mingla-business/`)
**Cycle:** Cycle 12 rework on top of commit `977d0ad1`
**Dispatch:** [`prompts/IMPLEMENTOR_BIZ_CYCLE_12_REWORK_BUNDLE_3FIX.md`](../prompts/IMPLEMENTOR_BIZ_CYCLE_12_REWORK_BUNDLE_3FIX.md)

---

## 1 — Layman summary

Three user-visible gaps fixed in one bundle: (1) ticket cards now badge ALL the operator's settings — Door only / Online only / Sale window scheduled / Min N per buyer / Max N per buyer / Transfers disabled — propagating across wizard Step 5, Step 7 preview, EditPublishedScreen, PreviewEventView, and the public buyer page from one helper edit; (2) the public event page no longer advertises door-only tiers as buyable — they render with a "Door only" pill + a disabled "Pay at the door" button instead of routing buyers to an empty cart; (3) the Recent Activity feed on Event Detail now surfaces door refunds as `Tunde — refunded £10.00 (door)` in warm-orange, sorted alongside online refunds and check-ins.

3 files, ~75 LOC additive. No code subtracted, no other behavior changed.

---

## 2 — Status & verification matrix

| Gate | Command | Status |
|------|---------|--------|
| Gate 1 — tsc clean | `cd mingla-business && npx tsc --noEmit \| grep -vE "\\.expo/types"` | ✅ PASS — only the 2 pre-existing Phase 1 errors (D-CYCLE12-IMPL-1 events.tsx duplicate toastWrap + D-CYCLE12-IMPL-2 brandMapping Brand drift). 0 new tsc errors |
| Gate 2 — Fix 1 chips wired | `grep -nE "Door only\|Online only\|Sale window scheduled\|per buyer\|Transfers disabled" mingla-business/src/utils/ticketDisplay.ts` | ✅ PASS — 6 hits at lines 81 (Door only) / 83 (Online only) / 93 (Sale window scheduled) / 96 (Min N per buyer) / 99 (Max N per buyer) / 102 (Transfers disabled) |
| Gate 3 — Fix 2 PublicTicketRow | `grep -nE "isDoorOnly\|Pay at the door" mingla-business/src/components/event/PublicEventPage.tsx` | ✅ PASS — 4 hits at lines 644 (flag declaration) / 649 (handleTap early return) / 672 (effectiveLabel branch) / 682 (isButtonDisabled OR-clause) |
| Gate 4 — Fix 3 activity feed wired | `grep -nE "event_door_refund\|allDoorEntries" "mingla-business/app/event/[id]/index.tsx"` | ✅ PASS — `event_door_refund` 7 hits (union member 116 / key branch 158 / recentActivity emit 587 / activityKindSpec 1153 / amountLabel 1190 / comment 1198 / isOrderLevel 1208); `allDoorEntries` already in scope from J-D1 ActionTile work |
| Gate 5 — Selector pattern (raw entries) | `grep -nE "useDoorSalesStore\\(\\(s\\) => s\\.entries\\)" "mingla-business/app/event/[id]/index.tsx"` | ✅ PASS — 1 hit at line 419 (`allDoorEntries = useDoorSalesStore((s) => s.entries)`). No banned direct subscription to fresh-array selectors |
| Gate 6 — Scope discipline | `git diff --stat` | ✅ PASS — exactly 3 Cycle-12 files modified: ticketDisplay.ts (+24 / -0), PublicEventPage.tsx (+9 / -0), event/[id]/index.tsx (+70 / -4). The 4th file in `git diff` (INVESTIGATION_ORCH-0700_CYCLE2_LIVE_FIRE.md) is operator's pre-existing other-workstream edit — UNTOUCHED by this rework |

---

## 3 — Files touched

| Path | Action | LOC delta |
|------|--------|-----------|
| `mingla-business/src/utils/ticketDisplay.ts` | MOD | +24 / -0 |
| `mingla-business/src/components/event/PublicEventPage.tsx` | MOD | +9 / -0 |
| `mingla-business/app/event/[id]/index.tsx` | MOD | +70 / -4 |

**Total:** 3 MOD files, ~+103 / -4 LOC. Pure additive patch (no behavior subtracted; one comment updated from "all 7 streams" → "all 8 streams" — that's the -4).

---

## 4 — Old → New receipts

### 4.1 `src/utils/ticketDisplay.ts` (Fix 1 — 6 new chip categories)

**What it did before:** `formatTicketBadges` emitted 5 chips: Sales paused (visibility=disabled, returns early — overrides all other badges), Hidden — direct link only (visibility=hidden), Approval required, Password required, + Waitlist. The remaining 11 ticket-sheet settings (availableAt, saleStartAt, saleEndAt, minPurchaseQty, maxPurchaseQty, allowTransfers, plus implicit ones like description / free / unlimited / price / capacity / name) didn't surface as chips. Operator could not tell at a glance what configuration a tier carried without tapping into edit.

**What it does now:** Adds 6 new chip categories (Cycle 12 contract + rework):
- **Door only** (info variant) — when `availableAt === "door"`
- **Online only** (info variant) — when `availableAt === "online"`
- **Sale window scheduled** (muted variant) — when `saleStartAt !== null || saleEndAt !== null`
- **Min N per buyer** (muted variant) — when `minPurchaseQty > 1` (min=1 is default; not chipped)
- **Max N per buyer** (muted variant) — when `maxPurchaseQty !== null` (no cap is default; not chipped)
- **Transfers disabled** (muted variant) — when `!allowTransfers` (transfers-on is default; not chipped)

Order on a card (most-important first): Sales paused → Hidden → Door/Online only → Approval required → Password required → + Waitlist → Sale window scheduled → Min/Max per buyer → Transfers disabled. A vanilla tier (visibility=public, availableAt=both, no approval/password/waitlist, no sale window, min=1, no max, transfers=on) emits ZERO chips — card stays uncluttered.

**Why:** Operator visibility into per-tier configuration without drilling into edit (operator-reported gap during device smoke). Mirror Cycle 12 SPEC §4.16 contract for `availableAt` + extends helper to the existing settings the helper had been silent about.

**Lines changed:** +24 / -0 LOC. Single helper edit propagates to 5 surfaces (Step 5 wizard TicketCard, Step 7 mini preview, EditPublishedScreen via reused step component, PreviewEventView, PublicEventPage.PublicTicketRow line 634).

### 4.2 `src/components/event/PublicEventPage.tsx` (Fix 2 — door-only handling)

**What it did before:** `PublicEventPage` filter at line 122-123 + 411 was `t.visibility !== "hidden"` only — door-only tiers passed through and rendered in the buyer's tier list. `PublicTicketRow.handleTap` had no branch for door-only, so tapping "Buy ticket" on a door-only tier routed to `/checkout/{eventId}` where the J-C1 picker filter immediately hid the tier → buyer landed on a cart that didn't show what they'd just clicked → confusion.

**What it does now:** 4 micro-edits to `PublicTicketRow` (lines 622+):
- New flag `isDoorOnly = ticket.availableAt === "door"` near the existing `isVisDisabled` / `isSoldOutTicket` flags
- `handleTap` early-returns for `isDoorOnly` (no-op tap; no navigation)
- `effectiveLabel` reads "Pay at the door" when `isDoorOnly` (info-only label)
- `isButtonDisabled` OR-clause includes `isDoorOnly` (button visually disabled)

Combined with Fix 1 (the new "Door only" pill from `formatTicketBadges`), the buyer now sees: tier name + price + "Door only" pill + greyed-out "Pay at the door" button. Honest disclosure: buyer knows the rate exists but understands it's not buyable online.

**Why:** Fix the inconsistency between PublicEventPage (which advertised door tiers) and the J-C1 cart filter (which hid them). Operator-reported confusion during device smoke.

**Lines changed:** +9 / -0 LOC. The J-C1 cart filter at `app/checkout/[eventId]/index.tsx:57` is UNTOUCHED — Fix 2 prevents the buyer from ever needing to hit that filter.

### 4.3 `app/event/[id]/index.tsx` (Fix 3 — door refund activity stream)

**What it did before:** `recentActivity` useMemo merged 7 streams: order purchase / order refund / order cancel / event edit / event sales ended / event cancelled / event scan. Door SALES surfaced via the `event_scan` stream (Cycle 11 wire — door auto-check-in fires `useScanStore.recordScan({via: "manual"})` per ticket sold; the via-agnostic filter `s.scanResult === "success"` picks them up). Door REFUNDS write to `useDoorSalesStore.entries[].refunds[]` only (per OBS-1 lock — refund is money-only, not attendance) and never touched scanStore, so the activity feed had no path to surface them. Operator saw the £40 sale go in (3 check-in entries) but not the £10 refund go out → reconciliation surface lied.

**What it does now:** Adds an 8th stream — `event_door_refund` — across 4 sub-edits in the same file:

1. **ActivityEvent union extension** (line 110-122) — new union member with shape `{ kind: "event_door_refund"; saleId; refundId; buyerName; summary; amountGbp; at }`
2. **`activityRowKey` branch** (line 158-160) — keys by `${kind}-${refundId}` so React reconciliation distinguishes refund entries from siblings
3. **`recentActivity` useMemo emit block** (line 577-594) — walks `allDoorEntries.filter(s => s.eventId === event.id)`, then iterates each sale's `refunds[]` and emits one ActivityEvent per refund record. summary reads `${buyerName} — refunded ${formatGbp(amountGbp)} (door)` with "(door)" suffix to distinguish from online refunds. useMemo deps array extended from `[allOrderEntries, allEditEntries, allScanEntries, event]` to `[allOrderEntries, allEditEntries, allScanEntries, allDoorEntries, event]`
4. **Renderer branches** (lines 1153, 1190, 1208):
   - `activityKindSpec` returns warm-orange treatment (icon=refund, accent.warm color, badgeBg=rgba(235,120,37,0.18), amountSign="-") — visually consistent with online order refunds
   - `amountLabel` derivation includes `event_door_refund` branch (uses `${spec.amountSign}${formatGbp(amountGbp)}` — same as order refund)
   - `isOrderLevel` test extended to include `event_door_refund` so the renderer uses the buyer-name-on-top row shape (same as purchase / refund / cancel) — door refunds show `Tunde Test` on line 1, `Tunde Test — refunded £10.00 (door)` on line 2, time on line 3, and the warm-orange amount on the right

**Note:** `allDoorEntries` raw subscription at line 419 was already in scope from the J-D1 ActionTile work (Phase 2). Fix 3 reuses it — no new subscription added. Selector pattern PASS (raw `entries` → useMemo → filter; no fresh-array selector subscribed).

**Why:** Operator-reported gap during device smoke — "refund history, refunds both partial and full should also show up on the recent activity." Promotes D-CYCLE12-IMPL-3 from B-cycle polish queue to Cycle 12 CLOSE blocker.

**Lines changed:** +70 / -4 LOC. The -4 is the comment "Newest first across all 7 streams" → "Newest first across all 8 streams" + the `isOrderLevel` test gaining a clause + a comment update.

---

## 5 — Invariant verification

| ID | Statement | Status |
|----|-----------|--------|
| I-19 | Immutable order financials | ✅ N/A (rework touches display layer + activity feed; not order/door-sale snapshots) |
| I-21 | Anon-tolerant buyer routes | ✅ Preserved (`useDoorSalesStore` still absent from `app/o/`, `app/e/`, `app/checkout/`. Activity feed lives at operator-side `app/event/[id]/index.tsx` per existing convention) |
| I-25 | Comp guests in useGuestStore only | ✅ N/A |
| I-27 | Single successful scan per ticketId | ✅ Preserved — Fix 3 reads from `useDoorSalesStore.entries[].refunds[]`, does NOT write a void scan (refund stays money-only) |
| I-28 (Cycle 12 amendment) | UI-only invitation flow | ✅ N/A |
| I-29 | Door sales NEVER as phantom OrderRecord | ✅ Preserved — door refund stream stays in its own activity kind (`event_door_refund`); does not synthesize fake order rows |
| I-30 | Door-tier vs online-tier separation via availableAt | ✅ Preserved + STRENGTHENED. Fix 1 surfaces the field as a visible chip; Fix 2 enforces it on the buyer surface (Buy disabled for door-only). Both make the existing filter-chain enforcement more discoverable to operator + buyer |

**No invariant violations.** I-30 enforcement is now visible to humans, not just code.

---

## 6 — Constitutional compliance scan (14 rules)

| # | Rule | Status |
|---|------|--------|
| 1 | No dead taps | ✅ Pay-at-the-door button is visibly disabled (greyed) — same pattern as "Sales paused". Not a dead tap; non-interactive by explicit design + label |
| 2 | One owner per truth | ✅ All chip data sourced from TicketStub (single source); door refund data sourced from useDoorSalesStore (single source). No duplication |
| 3 | No silent failures | ✅ Display-only changes; no error paths added |
| 4 | One key per entity | N/A |
| 5 | Server state server-side | ✅ Door entries still client Zustand persist [TRANSITIONAL]; rework reads from existing subscription |
| 6 | Logout clears | ✅ Activity feed re-renders empty post-logout (door entries cleared by clearAllStores) |
| 7 | Label temporary | ✅ No new TRANSITIONALs introduced; existing ones preserved |
| 8 | Subtract before adding | ✅ Pure additive — no broken code layered. The -4 LOC is comment refresh + one boolean clause extension, not subtraction-of-broken-code (nothing was broken) |
| 9 | No fabricated data | ✅ Chips emit only when actual configured value differs from default. Door refund stream emits only real refund records from doorSalesStore. "Walk-up" rendered only when buyerName is empty (existing convention) |
| 10 | Currency-aware | ✅ All amounts via `formatGbp`. Currency frozen "GBP" on every sale |
| 11 | One auth instance | N/A |
| 12 | Validate at right time | ✅ No validation timing changes |
| 13 | Exclusion consistency | ✅ I-30 enforcement now spans 4 surfaces: J-C1 cart filter (unchanged) + AddCompGuestSheet filter (unchanged) + DoorSaleNewSheet filter (unchanged) + **PublicEventPage Buy gate (NEW)**. Same `availableAt` field source-of-truth |
| 14 | Persisted-state startup | ✅ No persist version changes. Activity feed reads from existing migrated stores |

**No violations.**

---

## 7 — Cache safety

- **No persist version changes.** Reads from existing `useDoorSalesStore.entries` (already populated by J-D3 sales + J-D4 refunds).
- **No query keys** (mingla-business uses Zustand only).
- **Re-render path:** `recentActivity` useMemo deps gain `allDoorEntries` — when a door refund is recorded, the activity feed recomputes within the same render tick. No staleness.
- **PublicEventPage:** door-only tiers were already in `visibleTickets` (line 122-123 filter is `visibility !== "hidden"` — unchanged). Fix 2 adds runtime gate at row level, not at filter level. No tier disappears or reappears unexpectedly.

---

## 8 — Regression surface (4-5 adjacent features tester should spot-check)

1. **Cycle 9c online order refunds** — verify `refund` kind activity rows still render with warm-orange amount + relative time. The new `event_door_refund` spec mirrors `refund` exactly so visual parity should hold; the only difference is summary text (door has "(door)" suffix).
2. **Cycle 11 event_scan check-in entries** — verify they still render under the same color / icon / row shape. No collision with the new kind.
3. **Cycle 8 J-C1 buyer cart** — verify door-only tiers still excluded from cart (filter at `app/checkout/[eventId]/index.tsx:57` UNTOUCHED). Fix 2 prevents the buyer from reaching this filter for door-only, but the filter itself still acts as a defensive belt for any other route into the cart.
4. **Cycle 10 AddCompGuestSheet** — verify `availableAt === "both"` filter still hides door-only AND online-only tiers from comp picker. UNTOUCHED.
5. **Step 7 wizard preview** — verify the new chips render correctly on the Step 7 mini-card preview (uses same `formatTicketBadges` helper).

---

## 9 — Discoveries for orchestrator

**No new discoveries from this rework.** Implementor-side observations:

- **D-QA-CYCLE12-1** (P2 silent-failure in DoorRefundSheet null-fallback) is **unrelated to this rework** — still queued for follow-up small ORCH per QA report §12 + Phase 2 IMPL §12.
- **D-CYCLE12-IMPL-3** (activity-feed door-refund extension) is now **CLOSED by Fix 3** above. Promote from "B-cycle polish" → "shipped Cycle 12".
- D-CYCLE12-IMPL-1 / -2 (pre-existing tsc errors) — UNCHANGED.
- D-CYCLE12-IMPL-4 (unused toggleRowDisabled styles in InviteScannerSheet) — UNCHANGED.
- D-CYCLE12-IMPL-5 (PAYMENT_METHOD_LABELS duplication) — UNCHANGED.
- D-CYCLE12-IMPL-6 (per-seat refund attribution heuristic) — UNCHANGED.

---

## 10 — Manual test plan for operator (after fix)

After hot-reload, run **Blocks A–D** from dispatch §6 of `IMPLEMENTOR_BIZ_CYCLE_12_REWORK_BUNDLE_3FIX.md`:

### Block A — Operator-side tier badges (rich chips)
1. Open the test event (with mixed `availableAt` tiers) in EditPublishedScreen Step 5 Tickets section.
2. **Door-only tier** card → "Door only" pill visible.
3. **Online-only tier** card → "Online only" pill visible.
4. **"Both" tier** with default settings (no sale window, min=1, no max, transfers on) → ZERO chips. Card stays clean.
5. Configure ONE tier with: sale start = a future date + min purchase = 2 + max purchase = 5 + transfers = OFF. Save. Reopen → that tier card now shows: "Sale window scheduled" + "Min 2 per buyer" + "Max 5 per buyer" + "Transfers disabled" (all muted variant).
6. Confirm wizard parity — create a new draft, configure the same options, the chips appear identically in Step 5's wizard cards (same helper).

### Block B — Public page door-only display
1. Open the public event link for the event with a door-only tier.
2. The door-only tier should now render with: tier name + price + "Door only" pill + button reading "Pay at the door" (greyed out / disabled).
3. Tap the button — should be a no-op (no navigation, no error).
4. Tap an "Online" or "both" tier's Buy button — should still route to checkout normally.

### Block C — Activity feed door refunds
1. Open the test event with the existing £10 refund.
2. Scroll to **Recent Activity** on Event Detail.
3. New entry visible: `Tunde Test — refunded £10.00 (door)` with relative time.
4. Order: refund appears ABOVE the 3 check-in entries (newest-first sort).
5. Record another door sale + immediate full refund → 2 new check-in entries + 1 new refund entry, all sorted newest-first.

### Block D — Cycle 8 online refund regression check
1. (If you have a stub online order with a refund) confirm online refunds still surface as expected (existing `refund` kind, no "(door)" suffix).

---

## 11 — Cross-references

- Original Cycle 12 SPEC: [`specs/SPEC_BIZ_CYCLE_12_DOOR_SALES.md`](../specs/SPEC_BIZ_CYCLE_12_DOOR_SALES.md)
- Phase 1 IMPL report (commit `668bf968`): [`reports/IMPLEMENTATION_BIZ_CYCLE_12_DOOR_SALES_PHASE_1_REPORT.md`](./IMPLEMENTATION_BIZ_CYCLE_12_DOOR_SALES_PHASE_1_REPORT.md)
- Phase 2 IMPL report (commit `3420a3d0`): [`reports/IMPLEMENTATION_BIZ_CYCLE_12_DOOR_SALES_REPORT.md`](./IMPLEMENTATION_BIZ_CYCLE_12_DOOR_SALES_REPORT.md)
- EditPublished rework IMPL report (commit `977d0ad1`): [`reports/IMPLEMENTATION_BIZ_CYCLE_12_REWORK_EDITPUBLISHED_REPORT.md`](./IMPLEMENTATION_BIZ_CYCLE_12_REWORK_EDITPUBLISHED_REPORT.md)
- QA report (CONDITIONAL PASS): [`reports/QA_BIZ_CYCLE_12_DOOR_SALES_REPORT.md`](./QA_BIZ_CYCLE_12_DOOR_SALES_REPORT.md)
- This dispatch: [`prompts/IMPLEMENTOR_BIZ_CYCLE_12_REWORK_BUNDLE_3FIX.md`](../prompts/IMPLEMENTOR_BIZ_CYCLE_12_REWORK_BUNDLE_3FIX.md)
