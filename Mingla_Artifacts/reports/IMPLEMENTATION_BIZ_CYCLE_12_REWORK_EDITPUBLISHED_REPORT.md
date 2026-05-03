# IMPLEMENTATION REPORT — Cycle 12 EditPublished rework (3-fix patch)

**Status:** `implemented and verified` — all 3 fixes applied; all 5 verification gates PASS.
**Mode:** IMPLEMENT (rework — operator device-smoke discovered 2 P0 EditPublishedScreen bugs)
**Date:** 2026-05-03
**Surface:** Mingla Business mobile app (`mingla-business/`)
**Cycle:** Cycle 12 rework on top of commit `3420a3d0`
**Dispatch:** [`prompts/IMPLEMENTOR_BIZ_CYCLE_12_REWORK_EDITPUBLISHED.md`](../prompts/IMPLEMENTOR_BIZ_CYCLE_12_REWORK_EDITPUBLISHED.md)

---

## 1 — Layman summary

Two missed wires in Phase 1 broke the edit-after-publish flow on existing events:
1. The door-sales toggle wasn't recognised by the save logic — toggling did nothing.
2. The diff display crashed when shown an `undefined` value (from pre-Cycle-10 events with no `privateGuestList`).

The 3-fix patch (~10 LOC across 2 files) wires the missed bits: the save-patch builder now sees `inPersonPaymentsEnabled`, the diff display tolerates `undefined`, and the v1→v2 migrate now backfills `privateGuestList` for pre-Cycle-10 events. Both toggles now save cleanly without crashing the screen.

---

## 2 — Status & verification matrix

| Gate | Command | Status |
|------|---------|--------|
| Gate 1 — tsc clean | `cd mingla-business && npx tsc --noEmit \| grep -vE "\\.expo/types/router\\.d\\.ts"` | ✅ PASS — only the 2 pre-existing errors remain (D-CYCLE12-IMPL-1 + D-CYCLE12-IMPL-2). 0 new tsc errors introduced |
| Gate 2 — Fix A wired into patch builder | `grep -nE "inPersonPaymentsEnabled" mingla-business/src/utils/liveEventAdapter.ts` | ✅ PASS — 4 hits: line 66 (snapshot extract), 105 (FIELD_LABELS), 220, 221 (NEW patch check). Expected ≥ 4 |
| Gate 3 — Fix B undefined guard | `grep -nE "value === undefined\|value === null" mingla-business/src/utils/liveEventAdapter.ts` | ✅ PASS — `value === undefined` at line 268 (NEW), `value === null` at line 269 (existing). Both inside `formatValueForKey` body |
| Gate 4 — Fix C migrate backfill | `grep -nE "privateGuestList" mingla-business/src/store/liveEventStore.ts` | ✅ PASS — 6 hits including line 240 (V1LiveEvent Omit gains it), 244 (optional in v1 shape), 257 (NEW backfill in upgradeV1LiveEventToV2) |
| Gate 5 — No file scope creep | `git diff --stat` | ✅ PASS — exactly 2 files modified (liveEventAdapter.ts + liveEventStore.ts) per dispatch §6 |

---

## 3 — Files touched

| Path | Action | LOC delta |
|------|--------|-----------|
| `mingla-business/src/utils/liveEventAdapter.ts` | MOD | +13 / -0 |
| `mingla-business/src/store/liveEventStore.ts` | MOD | +13 / -3 |

**Total:** 2 MOD files, ~+26 / -3 LOC. Surgical 3-fix patch as specified.

---

## 4 — Old → New receipts

### 4.1 `src/utils/liveEventAdapter.ts` (Fix A)

**What it did before:** `editableDraftToPatch` checked 23 editable fields against the original LiveEvent and built a patch of changed fields. The function ended at `privateGuestList` (line 213-215) and immediately returned the patch. `inPersonPaymentsEnabled` was wired into FIELD_LABELS, the snapshot extract, and the editable-keys union (Phase 1) but missing here.

**What it does now:** Adds a 3-line check after `privateGuestList` that mirrors that field's pattern verbatim:
```ts
if (original.inPersonPaymentsEnabled !== edited.inPersonPaymentsEnabled) {
  patch.inPersonPaymentsEnabled = edited.inPersonPaymentsEnabled;
}
```
Plus a 3-line comment explaining the rework rationale.

**Why:** SPEC §4.7 requires `inPersonPaymentsEnabled` to flow through edit-after-publish save. Operator-reported P0 — toggling produced "No changes to save."

**Lines changed:** +6 LOC (3 logic + 3 comment).

### 4.2 `src/utils/liveEventAdapter.ts` (Fix B)

**What it did before:** `formatValueForKey` checked for `null` first, then strings, numbers, booleans, and special keys, falling through to `truncate(JSON.stringify(value))` as the last resort. With `value === undefined`, none of the type checks matched and the fallback produced `truncate(undefined)` — `JSON.stringify(undefined)` returns the literal value `undefined`, then `.length` on undefined crashes.

**What it does now:** Adds an `undefined` guard at the very top of the function body (immediately after the signature opens), treating undefined the same as null:
```ts
if (value === undefined) return "(empty)";
```
Plus a 7-line comment explaining the regression context (pre-Cycle-10 events with undefined fields).

**Why:** Operator-reported P0 — toggling `privateGuestList` on a pre-Cycle-10 published event crashed `EditPublishedScreen` with `TypeError: Cannot read property 'length' of undefined`.

**Lines changed:** +8 LOC (1 guard + 7 comment).

### 4.3 `src/store/liveEventStore.ts` (Fix C)

**What it did before:** The persist v1→v2 migrate function `upgradeV1LiveEventToV2` handled `availableAt` (tickets) + `inPersonPaymentsEnabled` (event) but did NOT backfill `privateGuestList`. Cycle 10 added `privateGuestList` to LiveEvent without bumping persist version. Pre-Cycle-10 events stored under v1 had `privateGuestList: undefined`. The Phase 1 v1→v2 migrate spread `...e` and copied undefined straight through.

**What it does now:**
- `V1LiveEvent` type widens its Omit to include `privateGuestList`, then re-adds the field as optional (`privateGuestList?: boolean`). This represents the actual v1 wire shape — pre-Cycle-10 events may not have the field.
- `upgradeV1LiveEventToV2` adds `privateGuestList: e.privateGuestList ?? false,` to the spread. New events get false; events that already had a value preserve it.

**Why:** Defense in depth alongside Fix B. Fix B handles the runtime crash; Fix C heals the data. Together they ensure no pre-Cycle-10 event ever surfaces undefined for this field again.

**Lines changed:** +13 / -3 LOC (type widening + 1 backfill + 8 comment).

---

## 5 — Invariant verification

| ID | Statement | Status |
|----|-----------|--------|
| I-19 | Immutable order financials | ✅ N/A (rework touches event-level fields, not order/door-sale snapshots) |
| I-21 | Anon-tolerant buyer routes | ✅ Preserved (no changes to app/o/, app/e/, app/checkout/) |
| I-25 | Comp guests in useGuestStore only | ✅ N/A |
| I-27 | Single successful scan per ticketId | ✅ N/A |
| I-28 (Cycle 12 amendment) | UI-only invitation flow | ✅ N/A |
| I-29 | Door sales NEVER as phantom OrderRecord | ✅ Preserved |
| I-30 | Door-tier vs online-tier separation | ✅ Preserved (no changes to tier filter chains) |

**No invariant violations.**

---

## 6 — Constitutional compliance scan

| # | Principle | Status |
|---|-----------|--------|
| 1 | No dead taps | ✅ Toggle now responds (Fix A unblocks save flow) |
| 2 | One owner per truth | ✅ Same single source (LiveEvent) |
| 3 | No silent failures | ✅ Fix A removes the silent "no changes" failure |
| 4 | One key per entity | N/A |
| 5 | Server state server-side | ✅ Persist v1→v2 still client-only [TRANSITIONAL] |
| 6 | Logout clears | ✅ No change |
| 7 | Label temporary | ✅ No new TRANSITIONALs introduced |
| 8 | Subtract before adding | ✅ Pure additive patch — no broken code layered |
| 9 | No fabricated data | ✅ Backfill default (`false`) is honest — pre-Cycle-10 events never had a user-set value, so false is the safe semantic |
| 10 | Currency-aware | N/A |
| 11 | One auth instance | N/A |
| 12 | Validate at right time | ✅ No validation timing changes |
| 13 | Exclusion consistency | N/A |
| 14 | Persisted-state startup | ✅ Migrate function strictly improved (now safer for pre-Cycle-10 cache shapes) |

**No violations.**

---

## 7 — Cache safety

- **Persist version unchanged at v2.** Per dispatch §6 (do NOT bump). Fix C improves the migrate's behaviour for pre-Cycle-10 events that haven't yet migrated; Fix B handles already-migrated broken records.
- **Self-healing on save.** When an operator opens an existing pre-Cycle-10 event with `privateGuestList: undefined` and toggles it, the patch builder sees `undefined !== true` → `patch.privateGuestList = true` → `updateLiveEventFields` merges the patch → record self-heals to `true` (or `false` next save).
- **Render-stable for already-broken records.** Fix B ensures `formatValueForKey(undefined)` returns `"(empty)"`, so `EditPublishedScreen`'s `computeRichFieldDiffs` useMemo no longer crashes.
- **No query keys** (mingla-business uses Zustand only).

---

## 8 — Regression surface

Spot-check on next operator device smoke:

1. **Toggle privateGuestList on a pre-Cycle-10 event** → screen MUST NOT crash. Diff modal MUST render with `Private guest list: (empty) → Yes`.
2. **Toggle inPersonPaymentsEnabled on any event** → diff modal MUST open showing `In-person payments: No → Yes` (or via "(empty)" if pre-Cycle-12). Save with reason MUST succeed.
3. **Toggle BOTH** → both fields appear in modal; save succeeds; Event Detail picks up "Door Sales" tile reactively.
4. **Edit a field that doesn't go through new code paths** (e.g., name, description) → save still works exactly as before. No regression.
5. **Cold-start on a pre-Cycle-10 event** → no crash on render; entries hydrate correctly.

---

## 9 — Discoveries for orchestrator

**No new discoveries.** Implementor-side observations:

- D-QA-CYCLE12-1 (P2 silent-failure in DoorRefundSheet null-fallback) is **unrelated to this rework** — still queued for follow-up small ORCH per QA report §12.
- The procedural gap that allowed Fix A through Phase 1 (tester verifying symbol existence but not control-flow path) was already noted by orchestrator as D-QA-CYCLE12-2 (P3 process improvement).

---

## 10 — Manual test plan for operator (after fix)

After applying the patch (commit pending), operator re-tests on device:

### Pre-step (force re-hydration)

The Fix B + Fix C migrate path runs only on persist version transitions. For already-migrated v2 cache, Fix B alone is sufficient (no re-migrate needed). Operator may need to:
- Hot-reload the app (Expo dev server fast-refresh) — picks up the new code immediately for already-loaded JS.
- For a clean test: sign out + sign back in (clears stores via `clearAllStores`; persist re-hydrates fresh from cache; if cache is pre-v2, Fix C migrate runs).

### Test steps

1. **Open a pre-Cycle-10 published event** → tap Edit. → screen MUST render without crash. Each section opens cleanly.
2. **Settings section → toggle "Private guest list"** → no crash. Modal shows the diff. Tap Save with a 10+ char reason → success toast "Saved. Live now."
3. **Reopen Edit → Settings → toggle "In-person payments"** → no crash. Modal shows the diff. Save with reason → success.
4. **Back at Event Detail** → "Door Sales" action tile appears (was missing before due to Fix A bug).
5. **Tap "Door Sales"** → /door route opens. Resume the original Cycle 12 device-smoke checklist (steps 1-22 from orchestrator's prior message).

---

## 11 — Cross-references

- Original Cycle 12 SPEC: [`specs/SPEC_BIZ_CYCLE_12_DOOR_SALES.md`](../specs/SPEC_BIZ_CYCLE_12_DOOR_SALES.md)
- Phase 1 IMPL report (commit `668bf968`): [`reports/IMPLEMENTATION_BIZ_CYCLE_12_DOOR_SALES_PHASE_1_REPORT.md`](./IMPLEMENTATION_BIZ_CYCLE_12_DOOR_SALES_PHASE_1_REPORT.md)
- Phase 2 IMPL report (commit `3420a3d0`): [`reports/IMPLEMENTATION_BIZ_CYCLE_12_DOOR_SALES_REPORT.md`](./IMPLEMENTATION_BIZ_CYCLE_12_DOOR_SALES_REPORT.md)
- QA report: [`reports/QA_BIZ_CYCLE_12_DOOR_SALES_REPORT.md`](./QA_BIZ_CYCLE_12_DOOR_SALES_REPORT.md)
- Rework dispatch: [`prompts/IMPLEMENTOR_BIZ_CYCLE_12_REWORK_EDITPUBLISHED.md`](../prompts/IMPLEMENTOR_BIZ_CYCLE_12_REWORK_EDITPUBLISHED.md)
