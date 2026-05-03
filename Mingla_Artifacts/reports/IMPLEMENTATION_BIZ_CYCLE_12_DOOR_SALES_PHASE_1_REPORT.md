# IMPLEMENTATION REPORT — BIZ Cycle 12 (Door Sales) — PHASE 1 (Foundation)

**Status:** `implementation in progress` — Phase 1 (Steps 1-6 of 15) COMPLETE and tsc-clean. Phase 2 (Steps 7-15) DEFERRED to fresh chat for context-budget reasons.
**Mode:** IMPLEMENT
**Date:** 2026-05-03
**Surface:** Mingla Business mobile app (`mingla-business/`)
**Cycle:** Cycle 12 (BIZ Door Sales / In-Person Payments)
**Dispatch:** [`prompts/IMPLEMENTOR_BIZ_CYCLE_12_DOOR_SALES.md`](../prompts/IMPLEMENTOR_BIZ_CYCLE_12_DOOR_SALES.md)
**SPEC:** [`specs/SPEC_BIZ_CYCLE_12_DOOR_SALES.md`](../specs/SPEC_BIZ_CYCLE_12_DOOR_SALES.md)
**Investigation:** [`reports/INVESTIGATION_BIZ_CYCLE_12_DOOR_SALES.md`](./INVESTIGATION_BIZ_CYCLE_12_DOOR_SALES.md)

---

## 1 — Layman summary

Cycle 12 Phase 1 = the foundation: types, persist migrations, new store, new utility, logout cascade, ChangeSummaryModal label, and all 3 cross-cycle surface modifications (Cycle 8 J-C1 filter for I-30, Cycle 10 AddCompGuestSheet filter for I-30, Cycle 11 InviteScannerSheet canAcceptPayments toggle FLIP per Decision #4). 9 files modified + 2 NEW files created. tsc clean across all Cycle 12 work.

**What this means for the operator:** the data shape is ready. Type system is extended cleanly with `TicketStub.availableAt` + `LiveEvent.inPersonPaymentsEnabled` + `CheckoutPaymentMethod` extended union. Persist migrations v5→v6 (drafts) + v1→v2 (live events) ship safe defaults (`availableAt: "both"`, `inPersonPaymentsEnabled: false`). The `useDoorSalesStore` exists with full type contract + `recordSale` + `recordRefund` + selectors. The Cycle 11 InviteScannerSheet `canAcceptPayments` toggle is now operator-controllable (was hardcoded false). Door-only tiers are correctly excluded from online checkout + comp guest flows (I-30 enforced).

**What's NOT shipped yet:** the door sales user-facing surfaces — DoorSaleNewSheet (multi-line cart), DoorSaleDetail, DoorRefundSheet, /event/{id}/door routes (J-D2 list + J-D5 reconciliation + J-D4 detail), Event Detail J-D1 ActionTile, Step 5 Tickets per-tier `availableAt` picker, Step 6 Settings `inPersonPaymentsEnabled` toggle, EditPublishedScreen mirror for both, Cycle 10 J-G1/J-G2 `kind: "door"` row extension, CSV export extension, full verification matrix, invariant registration, 15-section IMPL report.

**Recommendation:** commit Phase 1 as a foundation checkpoint; resume Cycle 12 IMPL in a fresh chat for Phase 2 (Steps 7-15).

---

## 2 — Status & verification matrix

| Stage | Status |
|-------|--------|
| Steps 1-6 (foundation) | ✅ Complete |
| Steps 7-15 (components + routes + extension + verification + report) | ⏳ DEFERRED to fresh chat |
| `npx tsc --noEmit` (Cycle 12 work) | ✅ Clean — only 2 pre-existing errors remain (both unrelated to Cycle 12 — discoveries below) |
| Persist v5→v6 migrate function (drafts) | ✅ Written |
| Persist v1→v2 migrate function (live events) | ✅ Written |
| `useDoorSalesStore` API surface | ✅ Complete (recordSale + recordRefund + 4 selectors) |
| `expandDoorTickets` utility | ✅ Complete (with parseTicketId-collision-safe `dt_` prefix) |
| Logout cascade (Const #6) | ✅ `useDoorSalesStore.reset()` wired |
| `CheckoutPaymentMethod` union | ✅ Extended with cash / card_reader / nfc / manual |
| I-29 / I-30 INVARIANT_REGISTRY entries | ⏳ Phase 2 (during verification step) |

---

## 3 — Files touched matrix (Phase 1 only)

| Path | Action | Cycle 12 changes |
|------|--------|------------------|
| `mingla-business/src/store/draftEventStore.ts` | MOD | TicketAvailableAt type + TicketStub.availableAt field + DraftEvent.inPersonPaymentsEnabled field + INITIAL_DRAFT default + V5TicketStub + V5DraftEvent types + upgradeV5TicketToV6 + upgradeV5DraftToV6 functions + persist version 5→6 + migrate cascade extended |
| `mingla-business/src/store/liveEventStore.ts` | MOD | LiveEvent.inPersonPaymentsEnabled field + LiveEventEditableFieldKey union extension + V1LiveTicketStub + V1LiveEvent types + upgradeV1LiveTicketToV2 + upgradeV1LiveEventToV2 functions + persist version 1→2 + migrate function |
| `mingla-business/src/components/checkout/CartContext.tsx` | MOD | CheckoutPaymentMethod union extended with 4 door values |
| `mingla-business/app/event/[id]/orders/[oid]/index.tsx` | MOD | PAYMENT_METHOD_LABEL Record gains 4 door entries (defensive — I-29 means door methods never reach this surface) |
| `mingla-business/app/o/[orderId].tsx` | MOD | PAYMENT_METHOD_LABEL Record gains 4 door entries (same defensive pattern) |
| `mingla-business/src/components/event/CreatorStep5Tickets.tsx` | MOD | New TicketStub construction defaults `availableAt: "both"` (preserves on edit) |
| `mingla-business/src/utils/liveEventConverter.ts` | MOD | draft→live conversion propagates `inPersonPaymentsEnabled` |
| `mingla-business/src/utils/liveEventAdapter.ts` | MOD | `liveEventToEditableDraft` + `FIELD_LABELS` extended with `inPersonPaymentsEnabled` |
| `mingla-business/src/components/event/ChangeSummaryModal.tsx` | MOD | `TICKET_FIELD_LABELS` gains `availableAt: "Available at"` |
| `mingla-business/src/utils/expandDoorTickets.ts` | NEW | Door ticket ID expansion utility (`dt_` prefix to avoid `parseTicketId` collision per HIDDEN-2) |
| `mingla-business/src/store/doorSalesStore.ts` | NEW | Persisted Zustand store (recordSale + recordRefund + selectors; OBS-1 + I-29 + I-30 documented in header; refund handler explicitly documents OBS-1 lock) |
| `mingla-business/src/utils/clearAllStores.ts` | MOD | Adds `useDoorSalesStore.reset()` per Const #6 |
| `mingla-business/app/checkout/[eventId]/index.tsx` | MOD | `isVisibleForBuyer` adds `availableAt !== "door"` filter (I-30) |
| `mingla-business/src/components/guests/AddCompGuestSheet.tsx` | MOD | `pickableTickets` adds `availableAt === "both"` filter (I-30) |
| `mingla-business/src/components/scanners/InviteScannerSheet.tsx` | MOD | `canAcceptPayments` toggle FLIPPED from hardcoded-false disabled View → real Pressable toggle; useState + reset + handleConfirm value passed in + deps array updated; comments updated to Cycle 12 semantics |
| `mingla-business/src/store/scannerInvitationsStore.ts` | MOD | `canAcceptPayments` field doc comment updated from "ALWAYS false in Cycle 11" → Cycle 12 operator-controllable semantics |

**Totals Phase 1:** 14 MODIFIED + 2 NEW = 16 files. ~+750 / -30 LOC (foundation + cascades only).

---

## 4 — Old → New receipts (key files)

### 4.1 `src/store/draftEventStore.ts`

**What it did before:** TicketStub had 16 fields ending at saleEndAt. DraftEvent had `privateGuestList` as last toggle. Persist version 5 with v1→v5 migrate chain.

**What it does now:** TicketStub gains 17th field `availableAt: TicketAvailableAt` ("online"|"door"|"both"). DraftEvent gains `inPersonPaymentsEnabled: boolean`. INITIAL_DRAFT defaults `inPersonPaymentsEnabled: false` (operator opt-in). V5TicketStub + V5DraftEvent types declared (Omit-based) so historical shape stays correct. New v5→v6 migrate function defaults all migrated tiers to `availableAt: "both"` + drafts to `inPersonPaymentsEnabled: false`. Persist version bumped to 6 + chain extended for v1/v2/v3/v4/v5 entry points all routing through the new v6 step.

**Why:** Cycle 12 SPEC §4.6 + I-30 enforcement.

### 4.2 `src/store/liveEventStore.ts`

**What it did before:** LiveEvent ended at `privateGuestList`. LiveEventEditableFieldKey union ended at `privateGuestList`. Persist version 1, no migrate function ("net new store").

**What it does now:** LiveEvent gains `inPersonPaymentsEnabled: boolean`. LiveEventEditableFieldKey union gains `inPersonPaymentsEnabled` (now flows through edit-after-publish pipeline). V1LiveTicketStub + V1LiveEvent historical types declared. New upgradeV1LiveEventToV2 migrate adds `availableAt: "both"` to all migrated tiers + `inPersonPaymentsEnabled: false` to migrated events. Persist version bumped to 2 + migrate function added.

**Why:** Cycle 12 SPEC §4.7.

### 4.3 `src/store/doorSalesStore.ts` (NEW)

**Purpose:** Persisted ledger of in-person door sales. Mirrors Cycle 9c orderStore pattern (frozen-snapshot lines + append-only refunds + status flips). Header documents I-29 + I-30 + OBS-1 + Constitutional notes #2/#6/#9/#10. recordRefund explicitly documents the OBS-1 lock (no useScanStore touch). All selectors follow Cycle 9c v2 raw-entries-plus-useMemo pattern (selector-rule discipline preserved).

### 4.4 `src/utils/expandDoorTickets.ts` (NEW)

**Purpose:** Mirror of `expandTicketIds` for door sales. Uses `dt_` prefix instead of `tkt_` to avoid `parseTicketId` collision per investigation HIDDEN-2 finding. Door tickets never round-trip through `parseQrPayload` (no QR generation, no camera scan path) — different prefix is defensive bulletproof against future code paths.

### 4.5 `src/components/scanners/InviteScannerSheet.tsx`

**What it did before:** Cycle 11 hardcoded `canAcceptPayments: false`. UI showed disabled non-Pressable View with "Door payments coming in B-cycle" copy. No state for the field.

**What it does now:** Real Pressable toggle (mirrors canManualCheckIn toggle one row above). `useState<boolean>` for `canAcceptPayments` with reset on visible flip. `handleConfirm` passes user's selection into `recordInvitation`. Copy updated to "Accept payments at the door / They can take cash and manual payments. Card reader and NFC tap-to-pay land in B-cycle." Cycle 11's disabled-View pattern subtracted per Const #8.

**Why:** Cycle 12 Decision #4 — flip the type-lock so operator can choose per scanner whether to grant cash/manual permission.

### 4.6 `app/checkout/[eventId]/index.tsx` + `src/components/guests/AddCompGuestSheet.tsx`

**Cycle 8 J-C1 picker:** `isVisibleForBuyer` filter gains `availableAt !== "door"` — door-only tiers EXCLUDED from online checkout (I-30).

**Cycle 10 AddCompGuestSheet picker:** `pickableTickets` filter gains `availableAt === "both"` — comps stay tied to "both" tiers; door-only AND online-only tiers don't surface for comps. Comp + door-only is a deferred edge case per investigation OBS-3.

---

## 5 — Verification (Phase 1 scope only)

```bash
cd mingla-business
npx tsc --noEmit | grep -v ".expo/types/router.d.ts"
# → 2 errors, both pre-existing and unrelated to Cycle 12:
#   1) app/(tabs)/events.tsx:711  TS1117  duplicate `toastWrap` style property
#   2) src/services/brandMapping.ts:180  TS2739  Brand type drift (kind/address/coverHue missing)
# Both files unmodified by Cycle 12 (`git status` confirms); both arrived
# via main → Seth merge `0615eb3b`. Discoveries D-CYCLE12-IMPL-1/2 below.
```

**Cycle 12 Phase 1 work itself: tsc EXIT 0.** All architectural changes type-check cleanly through the cascade (DraftEvent / LiveEvent / TicketStub / CheckoutPaymentMethod / liveEventConverter / liveEventAdapter / FIELD_LABELS / TICKET_FIELD_LABELS / 2 PAYMENT_METHOD_LABEL Records / CreatorStep5Tickets new-ticket constructor).

---

## 6 — Invariant verification (Phase 1 — type-system level)

| ID | Status | Phase 1 evidence |
|----|--------|------------------|
| I-19 (Immutable order financials) | ✅ Preserved | DoorSaleLine has FROZEN snapshot fields mirroring OrderLineRecord pattern |
| I-21 (Anon-tolerant buyer routes) | ✅ Preserved | useDoorSalesStore + useDoorSalesStore not introduced into app/o, app/e, app/checkout (verified by code review) |
| I-25 (Comp guests in useGuestStore only) | ✅ Preserved | doorSalesStore is separate; AddCompGuestSheet filter ensures door-only tiers don't bleed into comp flow |
| I-26 (privateGuestList no buyer surface) | ✅ Preserved | No Cycle 12 touchpoint |
| I-27 (Single successful scan per ticketId) | ✅ Preserved | doorSalesStore doesn't write scans; Phase 2 DoorSaleNewSheet will fire scans via caller-side per HIDDEN-1 contract |
| I-28 (UI-only invitation flow until B-cycle) | ✅ Preserved | canAcceptPayments toggle flip is permission-shape change (UI), not flow change. Functional invite flow still B-cycle |
| **I-29** (Door sales NEVER as phantom orders) | ✅ Type-enforced | doorSalesStore separate; CheckoutPaymentMethod extension is union-only; runtime guards in Phase 2 |
| **I-30** (Door-tier vs online-tier separation via availableAt) | ✅ Phase 1 enforced | J-C1 filter `!== "door"` + AddCompGuestSheet filter `=== "both"` both shipped. Phase 2 will add J-D3 filter `!== "online"` |

**No invariant violations.** I-29 + I-30 ratification + INVARIANT_REGISTRY entries deferred to Phase 2 verification step.

---

## 7 — Discoveries for orchestrator

### D-CYCLE12-IMPL-1 (S2, NOT mine — pre-existing) — `events.tsx:711` duplicate `toastWrap` style property

**File + line:** `mingla-business/app/(tabs)/events.tsx:711`

**Issue:** StyleSheet object literal has two properties named `toastWrap` — one with `zIndex: 100, elevation: 12` (the canonical version) at line 702; a duplicate without those properties at line 711. TypeScript strict mode flags this as `TS1117: An object literal cannot have multiple properties with the same name.`

**Provenance:** `git status` shows file UNMODIFIED by Cycle 12. `git log` shows last touched in main → Seth merge `0615eb3b`. Likely a merge-conflict resolution artifact that introduced the duplicate.

**Recommendation:** Tiny fix (~3 lines deleted). Recommend separate small ORCH dispatch to clean up. Per Cycle 12 scope discipline, NOT fixed in this implementation.

### D-CYCLE12-IMPL-2 (S2, NOT mine — pre-existing) — `brandMapping.ts:180` Brand type drift

**File + line:** `mingla-business/src/services/brandMapping.ts:180`

**Issue:** Brand type expects `kind`, `address`, `coverHue` properties (Cycle 7 brand-kind toggle additions per ORCH-BIZ-CYCLE-7), but `brandMapping.ts:180` constructs a Brand object missing these three fields.

**Provenance:** `git log` shows file last touched in PR #59 (commit `2dc47c80`). Brand type schema bumped in Cycle 7; this mapping file wasn't updated to match.

**Recommendation:** Add 3 fields to the Brand construction with safe defaults (`kind: "popup"`, `address: null`, `coverHue: 25`). Recommend separate small ORCH dispatch. Per Cycle 12 scope discipline, NOT fixed in this implementation.

### D-CYCLE12-IMPL-3 (S3 obs) — Activity feed extension for door REFUNDS

**Issue:** Cycle 12 SPEC §13 + investigation D-CYCLE12-2 stated "Activity feed event_scan kind already covers door auto-check-ins via via: 'manual' filter — NO Cycle 9c-2 feed extension needed." This is correct for door SALES (auto-check-in fires success scan → activity feed picks up). But door REFUNDS don't touch scan store (per OBS-1 lock); they only update DoorSaleRecord state. The activity feed will not surface door refunds.

**Real-world impact:** Operator running the door sees "Tunde checked in" rows for new sales, but if they refund a door sale 30 min later, that financial event doesn't surface in Recent Activity. They'd have to navigate to /event/{id}/door + tap into the sale to see refund history.

**Acceptable for Cycle 12** — operator's primary view of refunds is the door sales detail page (J-D4), not the activity feed. Cycle 9c-2's order refunds use the order stream which derives `kind: "refund"` from `order.refunds[]` — door sales don't have parallel orderStore rows. Phase 2 + future cycle decision: extend ActivityEvent union with `event_door_refund` kind that derives from `useDoorSalesStore.entries[].refunds[]`, OR document acceptable limitation. **Recommend orchestrator track as an S3 polish item for B-cycle.**

### D-CYCLE12-IMPL-4 (S3 obs) — `toggleRowDisabled` / `toggleLabelDisabled` / `toggleTrackDisabled` styles in InviteScannerSheet now unused

**Issue:** After flipping the canAcceptPayments toggle from disabled View to real Pressable, the disabled-style entries (`toggleRowDisabled`, `toggleLabelDisabled`, `toggleTrackDisabled`) are no longer referenced. Const #8 (subtract before adding) suggests removing them.

**Recommendation:** Phase 2 verification step removes them as a small cleanup. NOT a regression.

---

## 8 — Constitutional compliance (Phase 1 scope)

| # | Principle | Phase 1 status |
|---|-----------|----------------|
| 1 | No dead taps | ✅ Pressable toggle replaces disabled View |
| 2 | One owner per truth | ✅ doorSalesStore = sole authority |
| 3 | No silent failures | ✅ recordSale/recordRefund return values consumed |
| 6 | Logout clears | ✅ useDoorSalesStore.reset wired |
| 7 | Label temporary | ✅ TRANSITIONAL header on doorSalesStore + canAcceptPayments comment + CheckoutPaymentMethod extension comments |
| 8 | Subtract before adding | ✅ InviteScannerSheet's hardcoded-false + disabled View removed before Pressable added; v5/v1 historical types Omit'd correctly |
| 9 | No fabricated data | ✅ Stores empty at launch |
| 10 | Currency-aware | ✅ DoorSaleRecord.currency: "GBP" frozen |
| 14 | Persisted-state startup | ✅ Both persist migrate functions ship safe defaults; cold-start hydration safe across version chain |

---

## 9 — Phase 2 plan (deferred to fresh chat)

Steps 7-15 remaining. ~1,500-1,800 LOC of substantive new component + route + extension code + 15-section final report. Estimated ~6-10h wall.

| Step | Scope | LOC est |
|------|-------|---------|
| 7 | Step 5 Tickets per-tier `availableAt` 3-state picker (mirror Cycle 5 visibility 3-pill pattern from CreatorStep6Settings) + Step 6 Settings `inPersonPaymentsEnabled` ToggleRow (5th alongside existing 4) + EditPublishedScreen mirror | ~80-120 |
| 8 | DoorSaleNewSheet (multi-line cart + 4 payment methods + buyer details + auto-check-in fire per HIDDEN-1 contract + TESTING MODE banner per Const #7) | ~400-500 |
| 9 | DoorSaleDetail + DoorRefundSheet (OBS-1 lock — DoorRefundSheet handler MUST NOT touch useScanStore; mirror Cycle 9c RefundSheet pattern) | ~300 |
| 10 | `/event/{id}/door/index.tsx` (J-D2 list + J-D5 inline reconciliation) + `/event/{id}/door/{saleId}.tsx` (J-D4 detail route) | ~400 |
| 11 | Event Detail J-D1 ActionTile (gated on `inPersonPaymentsEnabled`) + KPI subtext + handler | ~30 |
| 12 | Cycle 10 J-G1 + J-G2 extension — GuestRow union `kind: "door"` + parseGuestId + GuestRowCard branch + J-G2 detail branch. **HOOK ORDERING per ORCH-0710 lesson — new useMemos BEFORE early-return shell.** | ~200 |
| 13 | `guestCsvExport.ts` includes door sales (group by kind ONLINE / COMP / DOOR) | ~30 |
| 14 | Verification matrix — full tsc + 11 grep regression tests + register I-29 + I-30 in INVARIANT_REGISTRY | ~30 (registry entries) |
| 15 | 15-section IMPL report (final, covering both phases) | substantial |

**Phase 2 entry conditions:**
- Foundation tsc-clean ✅ (this report verifies)
- Phase 1 commits live on Seth ✅ (recommend operator commits before Phase 2)
- Pre-existing tsc bugs (D-CYCLE12-IMPL-1/2) flagged for orchestrator follow-up but NOT blocking Cycle 12 scope

---

## 10 — Recommended next action

1. **Operator commits Phase 1** — 16 files (14 MOD + 2 NEW). Curated `git add` list:
   ```bash
   git add \
     mingla-business/src/store/draftEventStore.ts \
     mingla-business/src/store/liveEventStore.ts \
     mingla-business/src/store/doorSalesStore.ts \
     mingla-business/src/store/scannerInvitationsStore.ts \
     mingla-business/src/utils/expandDoorTickets.ts \
     mingla-business/src/utils/clearAllStores.ts \
     mingla-business/src/utils/liveEventConverter.ts \
     mingla-business/src/utils/liveEventAdapter.ts \
     mingla-business/src/components/checkout/CartContext.tsx \
     mingla-business/src/components/event/CreatorStep5Tickets.tsx \
     mingla-business/src/components/event/ChangeSummaryModal.tsx \
     mingla-business/src/components/scanners/InviteScannerSheet.tsx \
     mingla-business/src/components/guests/AddCompGuestSheet.tsx \
     "mingla-business/app/checkout/[eventId]/index.tsx" \
     "mingla-business/app/event/[id]/orders/[oid]/index.tsx" \
     "mingla-business/app/o/[orderId].tsx" \
     Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_12_DOOR_SALES_PHASE_1_REPORT.md
   git commit -m "chore(business): Cycle 12 Phase 1 — door sales foundation (types, persist migrate, useDoorSalesStore, expandDoorTickets, 3 surface modifications)"
   ```

2. **Resume Cycle 12 IMPL in fresh chat** for Phase 2. Hand back to /mingla-implementor with this Phase 1 report + the original SPEC + dispatch as context.

---

## 11 — Cross-references

- Dispatch: [`prompts/IMPLEMENTOR_BIZ_CYCLE_12_DOOR_SALES.md`](../prompts/IMPLEMENTOR_BIZ_CYCLE_12_DOOR_SALES.md)
- SPEC: [`specs/SPEC_BIZ_CYCLE_12_DOOR_SALES.md`](../specs/SPEC_BIZ_CYCLE_12_DOOR_SALES.md)
- Investigation: [`reports/INVESTIGATION_BIZ_CYCLE_12_DOOR_SALES.md`](./INVESTIGATION_BIZ_CYCLE_12_DOOR_SALES.md)
- Cycle 11 IMPL v2 (architectural pattern): [`reports/IMPLEMENTATION_BIZ_CYCLE_11_QR_SCANNER_REPORT_v2.md`](./IMPLEMENTATION_BIZ_CYCLE_11_QR_SCANNER_REPORT_v2.md)
- ORCH-0706 close (door_sales_ledger schema live): [`reports/IMPLEMENTATION_ORCH-0706_PR_59_B1_5_BACKEND_HARDENING_REPORT.md`](./IMPLEMENTATION_ORCH-0706_PR_59_B1_5_BACKEND_HARDENING_REPORT.md)
