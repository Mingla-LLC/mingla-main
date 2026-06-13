# SPEC — ORCH-1120: Published-trip Settings tab → editable refund tiers + booking deadline + bookings-closed (sales-gated)

**Mode:** SPEC (binding build contract). **No product code in this file.**
**Author:** mingla-forensics (SPEC mode), 2026-06-12.
**Worktree:** `~/Desktop/mingla-orchs/orch-1120-[trip-settings-refund-deadline]/` on branch `orch-1120-trip-settings-refund-deadline` (rebased on origin/main; 0 behind at SPEC time).
**Binding inputs (read verbatim, embedded below):**
1. `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1120_TRIP_SETTINGS_REFUND_DEADLINE_READONLY.md` (root cause — F-1..F-4).
2. `Mingla_Artifacts/investigations/ENUMERATE_REFUND_BUYER_PROTECTION_RULES.md` (existing refund/sales-gate ruleset).
3. `Mingla_Artifacts/reports/UI_UX_ORCH-1120_TRIP_SETTINGS_REFUND_DEADLINE_EDITABLE.md` (COMPLETED pixel-precise design — embedded into §4 Component + §Design).
**Comms ledger:** scanned on entry. No OPEN row targets ORCH-1120, `mingla-forensics`, or `ALL` as BLOCK. COMMS-0024 (1116 renumber) + COMMS-0025 (1117 polish) are FYI for this ORCH (1120 owns its number cleanly; no collision). No ack required beyond noting them.

> **The design is DONE.** This SPEC embeds it; it does not re-open it. The locked product decision (Seth, this session) is enforced verbatim in §2.1.

> **RECOMPOSE (2026-06-12, per COMMS-0029): migration body now composed off the live-prod (1119-preserving) base.** The §6 migration that extends `biz_update_live_trip` originally re-emitted the function from the pre-1119 (1075) body. Forensics on prod proved the LIVE function already carries ORCH-1119's per-day-media §5b upsert (applied to prod ahead of merge, NOT yet on origin/main), so a naive apply would have clobbered 1119. The migration `20260929000000` was recomposed: function body = LIVE-PROD-BODY (1119 day-media preserved verbatim — 3 `1119` markers + `media = EXCLUDED.media`) + the ORCH-1120 §4g gate / §5f apply / §6 severity / 3 reasons. Behavioral contract below is UNCHANGED. HOLD-MERGE until ORCH-1119 merges to origin/main; prod is safe to apply now (it already has the 1119 schema).

---

## REWORK — consolidated to a single standard Save button (Seth device feedback, 2026-06-12)

After the first implementation shipped to device, Seth found the published-trip Edit screen showed **TWO** "Save changes" buttons: the new Settings accordion had its OWN save button + its OWN reason dialog (a duplicate save path) on top of the screen's standard bottom "Save changes". **Locked rework decision (Seth-confirmed this session): ONE save button (the standard bottom one), ONE reason prompt (the screen's existing `ChangeSummaryModal`), ONE gate (already on the standard path). The Settings tab becomes a pure CONTROLLED EDITOR.**

**New component contract — `EditPublishedTripSettingsAccordion` (post-REWORK):**
- It is a **pure controlled editor**. It owns **NO** save button, **NO** reason dialog/banner, **NO** mutation, **NO** `submitting`/`reason` state, **NO** `onReject`/`onDirtyChange`/`eventId` props.
- Its three edited values are **lifted to the parent** via controlled props: `refundPolicy`/`onRefundPolicyChange`, `bookingDeadline`/`onBookingDeadlineChange`, `bookingsClosed`/`onBookingsClosedChange`. Plus `tripStartIso`, `brandTimezone`, `affectedOrderCount`, `submitting` (display/disable only).
- The editors (`RefundPolicyEditor`, `BookingDeadlinePicker`, the bookings-closed `Switch`) stay mounted, wired to the controlled props.
- The proactive sales-aware banner remains as **read-only context** — it is NOT a save/reason control.

**Parent `EditPublishedTripScreen` (post-REWORK):**
- `refund_policy` / `booking_deadline` / `bookings_closed` are added to `LocalTripEditState` + `tripToLocalEditState` + `buildLiveTripPatch`'s dirty-diff (carry-only-dirty), so the **single bottom Save button**'s existing flow (diff → `ChangeSummaryModal` reason → `biz_update_live_trip` RPC → `buildRejectDialog` reject switch) now covers these three fields. `editedSectionKeys` derives the Settings "Edited" badge from the patch diff (the old `settingsDirty` lift is removed).
- Client diff/severity path: the three keys are **MATERIAL** (`MATERIAL_KEYS` + `computeRichTripFieldDiffs` + `FIELD_LABELS` in `tripAdapter.ts`). `validateLiveTripFieldUpdate` pre-blocks the two unambiguous unfavorable edits (earlier deadline; false→true bookings-closed); refund-policy realized-% downgrades are left to the canonical server classifier (no client money-math) and surface via the `!result.ok` → `buildRejectDialog` path.

**Unchanged:** the `biz_update_live_trip` RPC + migration + the 4 reject reasons + the tester's adversarial SQL test (the RPC gate is identical — only the client wiring changed). The published path STILL writes ONLY through `biz_update_live_trip`, never `refundPolicyService` (DISC-1120-A landmine stays closed); the strict-grep gate `i-proposed-1120-published-refund-via-gated-rpc.mjs` was updated to require the gated save in the SCREEN (parent) rather than the accordion.

---

## 1. Executive summary

Today a planner who opens a PUBLISHED trip → Edit → **Settings** sees a read-only snapshot plus a **lie**: "Refund tiers and booking deadline are managed from the trip wizard… Open the wizard from the draft trip menu to edit these." That wizard path **does not exist for a published trip** (proven: INVESTIGATE F-2 — status-based routing always lands published trips on the read-only `EditPublishedTripScreen`; no revert-to-draft mutation exists anywhere). The refund policy is a tier-count, the booking deadline is static text, and the "Bookings closed" switch is hardcoded `disabled`.

This SPEC makes the Settings tab **editable in place**: a new `EditPublishedTripSettingsAccordion.tsx` (the Settings sibling of the ORCH-0880 `EditPublishedTripIntakeAccordion.tsx`) wires the already-shipped ORCH-0875 `RefundPolicyEditor` + `BookingDeadlinePicker` plus a **live** "Bookings closed" `Switch`. ALL writes route through the **sales-aware** `biz_update_live_trip` RPC (extended to carry `refund_policy` / `booking_deadline` / `bookings_closed`), **NEVER** through the sales-unaware `refundPolicyService.updateRefundPolicy/updateBookingDeadline` direct-table writes (which have zero sales-gate — INVESTIGATE F-4 / ENUMERATE Path 2 / DISC-1120-A).

The RPC enforces a **buyer-protection asymmetry**: when the trip has paid non-cancelled orders, **buyer-UNFAVORABLE** edits (lower any tier's refund %, remove a tier, pull the booking deadline EARLIER, a harmful bookings-closed flip) are **HARD-BLOCKED** and return the affected-order count + a "Refund first" reject reason; **buyer-FAVORABLE** edits (raise a refund %, add a tier, push the deadline later) are **ALWAYS allowed**; with **no sales**, everything is freely editable. This mirrors the existing 8-path affected-orders refund-gate already live in `biz_update_live_trip` for dates/days/inclusions/pricing/capacity (ENUMERATE Path 1) and closes the last two buyer-relied-upon fields that escaped it (ENUMERATE (d)). The dead-end hint copy is deleted.

---

## 2. Scope & non-goals

### 2.1 LOCKED product decision (Seth, this session — the contract enforces this; do NOT re-open)

- Wire the existing `RefundPolicyEditor` + `BookingDeadlinePicker` into the published-trip Settings tab via a **new** `EditPublishedTripSettingsAccordion.tsx` (sibling of the ORCH-0880 intake accordion) **+** a **live "Bookings closed" `Switch`**.
- **ALL writes route through the `biz_update_live_trip` RPC** (extend the RPC **+** `LiveTripPatch` in `tripsService.ts` to carry `refund_policy` / `booking_deadline` / `bookings_closed`). **NOT** through the sales-unaware `refundPolicyService` functions.
- **Sales-gate asymmetry:** when paid non-cancelled orders exist, **HARD-BLOCK** buyer-UNFAVORABLE edits — lower any tier's refund %, remove a tier, pull the booking deadline EARLIER, a harmful bookings-closed flip — returning the affected-order count + a "Refund first" reject toast (reuse this screen's existing reject-dialog copy shape, **+4 new entries**). **ALWAYS allow** buyer-FAVORABLE edits — higher refund %, add a tier, later deadline. **No sales = fully editable.**
- **Delete the dead-end hint copy.**

### 2.2 In scope

| # | Item |
|---|------|
| S-1 | Migration `20260929000000_orch_1120_trip_settings_refund_deadline.sql` (version chosen per §4.0 safe-migration scan) — re-emits `biz_update_live_trip` VERBATIM from the 1075 authoritative body + adds the refund/deadline/bookings-closed accept blocks, the favorable-vs-unfavorable classifier, the existing affected-orders predicate reuse, and the 4 new reject reasons. |
| S-2 | `tripsService.ts`: extend `LiveTripPatch` (+3 keys), `UpdateLiveTripRejectReason` (+4 reasons), serialization of the 3 fields. Confirm/keep the published path off `refundPolicyService.updateRefundPolicy/updateBookingDeadline`. |
| S-3 | New `EditPublishedTripSettingsAccordion.tsx` per the embedded design (§4 + §Design). |
| S-4 | `EditPublishedTripScreen.tsx`: replace the read-only `case "settings"` JSX with `<EditPublishedTripSettingsAccordion … />`; extend `buildRejectDialog` with the 4 new "Refund first" copy entries; wire `editedSectionKeys` for `"settings"`; delete the dead `styles.settingsWrap/settingsHint/settingsField/settingsLabel/settingsValue`. |
| S-5 | Regression tests (implementor happy-path fails-on-revert + the migration SQL gate). |

### 2.3 Non-goals (explicitly OUT — do NOT widen)

- **N-1 — Per-order policy snapshot ("terms at time of purchase").** ENUMERATE D-2 flagged that `biz_compute_refund_for_cancel` always reads the CURRENT policy. The locked decision is an **edit-gate**, not a snapshot. Snapshotting is a separate future ORCH. Do not build it.
- **N-2 — Trip orders ledger.** The "Open Orders" CTA reuses the existing `closeAndOpenOrders` transitional toast stub. Do NOT build a real orders screen.
- **N-3 — Redesigning the ORCH-0875 editors** (`RefundPolicyEditor`, `BookingDeadlinePicker`). Mount them as-is. No new props on them except as §4 fork 2 dictates (none — they get wrapped, not modified).
- **N-4 — `refundPolicyService.updateRefundPolicy/updateBookingDeadline`** stay AS-IS for the **draft wizard** path (`TripCreatorWizard` Step 5, where no orders exist). Do NOT delete them; do NOT add a sales-gate to them. The published path simply must not call them. (Touching them = scope creep + risk to the draft flow.)
- **N-5 — Consumer/buyer/admin surfaces.** Refund policy is *displayed* to buyers on the public trip page (read-only) but never edited there.
- **N-6 — ORCH-1118 (departure/destination Mapbox) on the same screen.** See §5 coexistence boundary. Do not touch 1118's Basics-tab address fields.
- **N-7 — Free-trip special-casing.** Per design §1 edge: a free trip still shows the editor normally (the column exists; a refund policy on a never-charged trip is harmless). Do NOT hide the editor on free trips.

### 2.4 Assumptions

- The `trip` prop already carries `refundPolicy`, `bookingDeadline`, `bookingsClosed`, `businessTrip.startAt`, `timezone` (confirmed: `tripsService.ts` L121-124, L84, L110, L113). No new query needed — seed synchronously from props.
- The 1075 migration (`20260911000000`) is the authoritative current `biz_update_live_trip` body (grep-confirmed: the only later migration touching the function name is none; 1075 is newest of the 8 that reference it). The new migration re-emits from 1075.
- The columns are server-writable on any status with no immutability constraint (ENUMERATE (b) — only the shape-CHECK `events_refund_policy_valid` applies). The gate is added by THIS spec; it does not pre-exist.

---

## 3. Cross-Surface Impact Declaration (MANDATORY per-surface table)

| # | Surface | Covered | User-visible behavior demanded | Files touched here | Parity |
|---|---------|---------|--------------------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile/` iOS) | **NO** | none | — | n/a — no trip authoring (INVESTIGATE §7) |
| 2 | Consumer Android | **NO** | none | — | n/a |
| 3 | Buyer/anon Web (`/t/...`) | **NO** | none — refund policy *displayed* read-only, never edited | — | n/a — display consumes the same columns; correctness preserved because the gate only blocks worsening edits |
| 4 | Business iOS | **YES** | Settings tab: edit refund tiers, booking deadline, live Bookings-closed switch; sales-aware proactive banner; "Refund first" block on buyer-unfavorable edits with sales; success toast; dead-end hint gone | `EditPublishedTripSettingsAccordion.tsx` (new), `EditPublishedTripScreen.tsx`, `tripsService.ts`, migration | **automatic** (shared RN code) |
| 5 | Business Android | **YES** | identical to #4; glass surfaces use the opaque ≥0.92 fallback inside `GlassCard` (inherited) | same as #4 | **automatic** (shared RN) — Android glass via `GlassCard` (invariant `ANDROID_GLASS_USES_OPAQUE_FALLBACK`) |
| 6 | Admin Web (`mingla-admin/`, adjacent) | **NO** | none | — | n/a — no trip editor |
| 7 | Business Web preview (adjacent) | **YES (adjacent)** | same component renders; controls editable in the web preview; renders the iOS translucent glass path (acceptable for preview per design §8) | same as #4 | **automatic** (same RN component) |

Because business iOS / Android / web-preview share the one `EditPublishedTripSettingsAccordion` RN component and the one RPC, parity is automatic — success criteria are NOT split per surface for behavior (one code path). The only per-surface delta is the glass-fill mechanism, fully owned inside `GlassCard` (no work here).

---

## 4. Layered specification

### 4.0 Migration version selection (safe-migration protocol)

**Scanned at SPEC time (2026-06-12) — highest migration version across the anchor + EVERY active worktree:**

| Tree | Highest migration |
|------|-------------------|
| anchor `mingla-main` | `20260926000000` |
| ORCH-1116-booking-gate-rls | `20260927000000` |
| ORCH-1116-hub-multiselect | `20260928000000` |
| ORCH-1119-trip-day-media | `20260928000001` |
| (all others) | `20260926000000` |

**CHOSEN: `20260929000000_orch_1120_trip_settings_refund_deadline.sql`** — strictly greater than every in-flight version (`20260928000001` was the max). **The implementor MUST re-run this scan at IMPLEMENT time** (concurrent sessions may push higher); if any tree has reached `20260929xxxxxx`, bump to the next free `2026093...`. Pin via `git fetch origin && git rebase origin/main` first.

### 4.1 Database — migration `20260929000000_orch_1120_trip_settings_refund_deadline.sql`

**Discipline (from `feedback_edge_deploy_and_migration_apply_hazards`):**
- `biz_update_live_trip` is `CREATE OR REPLACE` returning a **scalar `jsonb`** (NOT `RETURNS TABLE`) — the **DROP-before-widening-RETURNS-TABLE** hazard does **NOT** apply; no `DROP FUNCTION` needed (return type is unchanged).
- The 1075 body uses `AS $$ … $$;` dollar-quoting. Keep `$$` (do NOT switch to `$function$`). The **`$function$;`-before-GRANT** discipline is about not placing GRANT before the function's closing quote — here the closing `$$;` precedes the `GRANT EXECUTE … TO authenticated;` exactly as in 1075. **Preserve that ordering.** Re-emit the GRANT + the COMMENT.
- Idempotent, no destructive DDL, no data backfill, no column adds (the 3 columns already exist from the TR4 migration `20260612000000`). Safe to re-run.
- **Re-emit the ENTIRE 1075 `biz_update_live_trip` body VERBATIM** (lines 2626-3164 of `20260911000000`), then INSERT the new blocks at the points below. Do NOT hand-rewrite the existing 8 refund-gate paths — copy them.

**New parameter acceptance — patch keys (top-level on `p_patch`):** `refund_policy` (jsonb, the `{kind, tiers:[…]}` shape OR JSON `null` to clear), `booking_deadline` (text ISO timestamptz OR JSON `null`), `bookings_closed` (boolean). Only present keys are evaluated (client omits unchanged keys — design §9 "carry ONLY the dirty fields").

**Block placement inside the re-emitted body:**

**(A) Classifier + gate — insert as a new section `4g` immediately AFTER the existing `4f` intake_schemas block (after line ~2999, before `-- ---------- 5. Apply patch ----------`).** Uses `v_total_sold` (already computed at §3, line 2744) and `v_event` (already SELECTed). Pseudocontract (the implementor writes the plpgsql; this fixes the exact semantics):

```
-- 4g. ORCH-1120 refund_policy / booking_deadline / bookings_closed gate.
-- Buyer-FAVORABLE edits always allowed. Buyer-UNFAVORABLE edits HARD-BLOCK
-- when v_total_sold > 0. No sales => everything allowed.
```

1. **`refund_policy` (when `p_patch ? 'refund_policy'`):**
   - Let `v_old_policy := v_event.refund_policy` (jsonb, may be NULL); `v_new_policy := CASE WHEN jsonb_typeof(p_patch->'refund_policy')='null' THEN NULL ELSE p_patch->'refund_policy' END`.
   - **Validate shape first** by calling `validate_refund_policy(v_new_policy)` (defined in TR4 migration `20260612000000` L493). If it raises, let it propagate as the existing 23514 path (the service maps it) — i.e. do NOT swallow; this matches the CHECK constraint that will fire anyway. (Belt-and-suspenders: the DB CHECK `events_refund_policy_valid` enforces it on UPDATE regardless.)
   - **Favorable/unfavorable classification (only matters when `v_total_sold > 0`):** define `refund_pct_at(policy, d)` = the winning refund_pct a buyer cancelling with `d` whole-days-before-start would receive under `policy` — i.e. the tier with the **largest `days_before_start <= d`**, else **0** (mirrors `biz_compute_refund_for_cancel` tier selection, TR4 L232-236; NULL policy ⇒ 0 at every `d`). The edit is **UNFAVORABLE** iff there EXISTS a `d` in the union of both policies' `days_before_start` thresholds (∪ `{0}`) where `refund_pct_at(v_new_policy, d) < refund_pct_at(v_old_policy, d)`. Because both policies are step functions changing only at their declared thresholds, evaluating at every threshold in the union (plus 0) is exhaustive — no need to scan all integer days.
     - Implementation note: gather `v_thresholds := (SELECT array_agg(DISTINCT x) FROM (SELECT (t->>'days_before_start')::int x FROM jsonb_array_elements(COALESCE(v_old_policy->'tiers','[]')) t UNION SELECT (t->>'days_before_start')::int FROM jsonb_array_elements(COALESCE(v_new_policy->'tiers','[]')) t UNION SELECT 0) u)`. For each `d` in `v_thresholds`, compute `refund_pct_at` old vs new; if any new < old ⇒ unfavorable.
     - **Tier-removal is captured by this same predicate** (removing the only tier that gave a positive % at some `d` drops new<old there). The locked decision lists "remove a tier" as unfavorable; this predicate yields exactly that whenever removal lowers the realized % at any threshold. If a removed tier is redundant (its % equals the neighboring surviving tier at every `d`), no buyer is harmed and the edit is allowed — this is the correct, money-accurate reading of "buyer-unfavorable" and is acceptable per the locked decision's "lower any tier's refund % / remove a tier" intent (the harm test is the realized %, not the literal tier array). **LOCKED: classify by realized `refund_pct_at`, not by literal tier-array shape.**
   - **Block:** if `v_total_sold > 0 AND <unfavorable>` → `RETURN jsonb_build_object('ok', false, 'reason', 'refund_policy_downgrade_with_sales', 'affected_order_count', v_total_sold);` **before** any UPDATE.
   - **NOTE — single reason for refund downgrades:** the locked decision named "lower a tier's %" and "remove a tier" as two cases. Both are surfaced by the SAME realized-%-drop predicate, so they share the reason `refund_policy_downgrade_with_sales`. **The design's `refund_tier_removed_with_sales` reason (design §5 / §3.5 table) is RESERVED but UNUSED by the RPC under this classifier** (a pure tier-count drop that lowers realized % returns `refund_policy_downgrade_with_sales`). **Open question Q-1 (§10)** asks Seth whether to keep both reasons distinct (requires a literal-tier-count branch in addition to the realized-% predicate) or collapse to one. **Default contract: emit `refund_policy_downgrade_with_sales` for ALL refund downgrades**; the `refund_tier_removed_with_sales` reason + copy entry are still ADDED to the type + `buildRejectDialog` (so the design's table is honored and the type stays exhaustive), but the RPC does not emit it unless Q-1 flips. Document this in the migration comment.

2. **`booking_deadline` (when `p_patch ? 'booking_deadline'`):**
   - `v_old_deadline := v_event.booking_deadline`; `v_new_deadline := CASE WHEN jsonb_typeof(p_patch->'booking_deadline')='null' THEN NULL ELSE (p_patch->>'booking_deadline')::timestamptz END`.
   - **Unfavorable = pulling the deadline EARLIER** (shrinking the booking window strands in-flight buyers). Specifically unfavorable iff `v_new_deadline IS NOT NULL AND (v_old_deadline IS NULL OR v_new_deadline < v_old_deadline)`. (NULL→a deadline = newly closing the window earlier than "never" = unfavorable. A later deadline, or clearing the deadline (→NULL = window stays open longer), = FAVORABLE, always allowed.)
   - **Block:** if `v_total_sold > 0 AND <earlier>` → `RETURN jsonb_build_object('ok', false, 'reason', 'booking_deadline_earlier_with_sales', 'affected_order_count', v_total_sold);`.
   - **Future-validity:** when SETTING a non-null deadline, it must be in the future (`v_new_deadline > v_now`), mirroring `updateBookingDeadline` L229. If not, `RETURN … 'reason', 'booking_deadline_in_past'` — **reuse the existing `offering_date_past`? NO** — that reason has different copy ("Pick a future date" about the trip date). Add it under the deadline's own handling: **LOCKED — reuse `invalid_booking_deadline`** is NOT needed; instead the picker (`BookingDeadlinePicker`) already prevents past selection client-side (it bounds the spinner to future ≤ tripStart). Server defense: if a past deadline somehow arrives, `RETURN jsonb_build_object('ok', false, 'reason', 'invalid_edit_reason')` is WRONG. **Decision: add a 5th defensive reason `booking_deadline_in_past` is OUT of the locked "+4" scope.** Instead, clamp defensively: if `v_new_deadline <= v_now`, treat as a no-op skip of the deadline write and proceed (the client cannot produce it). **LOCKED: do not add a 5th reason; rely on the picker's client bound + the cron/checkout enforcement.** (Document this in the migration comment.)

3. **`bookings_closed` (when `p_patch ? 'bookings_closed'`):**
   - `v_old_closed := v_event.bookings_closed`; `v_new_closed := (p_patch->>'bookings_closed')::boolean`.
   - **Harmful flip = closing bookings (`false → true`) while sales exist.** Opening bookings (`true → false`) is favorable (more availability), always allowed. **Why closing-with-sales is gated:** closing mid-window can strand buyers who started a booking; it is the manual equivalent of pulling the deadline to "now."
   - **Block:** if `v_total_sold > 0 AND v_old_closed = false AND v_new_closed = true` → `RETURN jsonb_build_object('ok', false, 'reason', 'bookings_closed_harms_active', 'affected_order_count', v_total_sold);`.
   - **Coupling with deadline-clear:** the standalone `updateBookingDeadline` resets `bookings_closed=false` when clearing the deadline (refundPolicyService L241-243). The RPC does **NOT** auto-couple — each of the 3 fields is evaluated/written independently from the patch. If the client clears the deadline AND wants bookings re-opened, it sends `bookings_closed:false` explicitly in the same patch (favorable → allowed). Document: no implicit coupling in the RPC.

**(B) Apply — insert a new write block in section `5` (after `5e` intake upsert, before `-- 6. Compute changed_keys`).** Each field writes only if present in the (post-gate) patch:

```
-- 5f. ORCH-1120 refund/deadline/bookings-closed writes (gate passed above).
UPDATE public.events SET
  refund_policy   = CASE WHEN p_patch ? 'refund_policy'
                         THEN (CASE WHEN jsonb_typeof(p_patch->'refund_policy')='null'
                                    THEN NULL ELSE p_patch->'refund_policy' END)
                         ELSE refund_policy END,
  booking_deadline = CASE WHEN p_patch ? 'booking_deadline'
                         THEN (CASE WHEN jsonb_typeof(p_patch->'booking_deadline')='null'
                                    THEN NULL ELSE (p_patch->>'booking_deadline')::timestamptz END)
                         ELSE booking_deadline END,
  bookings_closed = CASE WHEN p_patch ? 'bookings_closed'
                         THEN (p_patch->>'bookings_closed')::boolean
                         ELSE bookings_closed END,
  bookings_closed_at = CASE
                         WHEN p_patch ? 'bookings_closed' AND (p_patch->>'bookings_closed')::boolean = true
                              AND bookings_closed = false THEN v_now
                         WHEN p_patch ? 'bookings_closed' AND (p_patch->>'bookings_closed')::boolean = false
                              THEN NULL
                         ELSE bookings_closed_at END,
  updated_at = v_now
WHERE id = p_event_id
  AND (p_patch ? 'refund_policy' OR p_patch ? 'booking_deadline' OR p_patch ? 'bookings_closed');
```
- `bookings_closed_at` mirrors the cron/standalone semantics: set to `now()` on a false→true close, cleared on any →false open. (Matches `process-booking-deadlines` and `updateBookingDeadline`.)
- The DB CHECK `events_refund_policy_valid` validates `refund_policy` on this UPDATE as defense-in-depth.

**(C) changed_keys / severity (section 6).** `v_changed_keys` already = `ARRAY(SELECT jsonb_object_keys(p_patch))` — the 3 new keys flow in automatically. **Add** `refund_policy`, `booking_deadline`, `bookings_closed` to the `material` severity test (line 3117-3123): a refund/deadline/closed edit is **material** (it changes buyer-relied-upon terms), so OR them into the material condition. This makes the edit-log severity honest.

**(D) GRANT + COMMENT.** Re-emit the `GRANT EXECUTE ON FUNCTION public.biz_update_live_trip(uuid, jsonb, text) TO authenticated;` and an UPDATED `COMMENT` appending: "ORCH-1120: also accepts refund_policy / booking_deadline / bookings_closed patch keys; buyer-unfavorable edits (lower realized refund %, earlier deadline, harmful bookings-closed flip) hard-block when sold>0 with reasons refund_policy_downgrade_with_sales / booking_deadline_earlier_with_sales / bookings_closed_harms_active." Keep the GRANT AFTER the closing `$$;`.

**RLS:** unchanged — `biz_update_live_trip` is `SECURITY DEFINER` and gates on `biz_brand_effective_rank >= event_manager` (line 2707). The 3 columns are written inside the DEFINER function, so no new RLS policy on `events` is needed (the existing planner ownership path is the authority).

### 4.2 Service — `mingla-business/src/services/tripsService.ts`

**(a) `LiveTripPatch` (L1151-1167) — add 3 optional keys:**
```ts
export interface LiveTripPatch {
  // … existing keys …
  refund_policy?: import("./refundPolicyService").RefundPolicy | null;
  booking_deadline?: string | null;   // ISO timestamptz, or null to clear
  bookings_closed?: boolean;
}
```
Serialization: `updateLiveTripFields` already passes `patch as Record<string, unknown>` straight to `supabase.rpc("biz_update_live_trip", { p_patch: patch, … })`. `RefundPolicy` (`{kind, tiers}`) serializes to the exact jsonb the RPC reads; `null` for `refund_policy`/`booking_deadline` serializes to JSON `null` which the RPC detects via `jsonb_typeof(...) = 'null'`. **No new serialization code** — the existing pass-through is correct. The client MUST omit unchanged keys (handled in the component, §4.3).

**(b) `UpdateLiveTripRejectReason` (L1169-1182) — add 4 reasons:**
```ts
  | "refund_policy_downgrade_with_sales"
  | "refund_tier_removed_with_sales"     // reserved; RPC emits downgrade unless Q-1 flips
  | "booking_deadline_earlier_with_sales"
  | "bookings_closed_harms_active";
```
The existing `UpdateLiveTripResult` `{ok:false}` arm already carries `affectedOrderCount` — the 4 new reasons reuse it; no new result fields.

**(c) Confirm the published path NEVER calls `refundPolicyService`.** The only callers of `updateRefundPolicy`/`updateBookingDeadline` must remain the **draft wizard** (`TripCreatorWizard` Step 5 autosave). **Verification step the implementor performs (and a CI grep, §9):** `grep -rn "updateRefundPolicy\|updateBookingDeadline" mingla-business/src` must show callers ONLY in `TripCreatorWizard.tsx` / wizard-step files / `refundPolicyService.ts` itself — NEVER in `EditPublishedTripScreen.tsx` or `EditPublishedTripSettingsAccordion.tsx`. The new accordion saves exclusively via `updateLiveTripFields` (through the `useUpdateLiveTripFields` hook).

**(d) Hook.** Reuse the EXISTING `useUpdateLiveTripFields()` mutation hook (already used by `EditPublishedTripScreen` line 548 and the intake accordion). It calls `updateLiveTripFields`, returns the `UpdateLiveTripResult`, and invalidates the trip query on success. **No new hook.** The accordion either consumes the hook directly OR (parity with intake) receives the result and signals up — see §4.3.

### 4.3 Component — `EditPublishedTripSettingsAccordion.tsx` (NEW) + design embed

> **The full pixel-precise design is the binding input `UI_UX_ORCH-1120_TRIP_SETTINGS_REFUND_DEADLINE_EDITABLE.md`, embedded verbatim in §Design below. This subsection states the engineering contract and LOCKS the two design forks.**

**Path:** `mingla-business/src/components/trip/EditPublishedTripSettingsAccordion.tsx` — the Settings sibling of `EditPublishedTripIntakeAccordion.tsx`. Copy that file's skeleton verbatim (imports, `REASON_MIN=10`/`REASON_MAX=200`, `reasonDialogVisible`/`reason`/`reasonError` state, `onSavePressed`/`onConfirmSave`/`onCloseReasonDialog`, `Toast`, and the named `styles` shapes `container`/`saveWrap`/`reasonBanner`/`reasonInput`/`reasonButtons`/`reasonCancel`/`reasonConfirmCell`/`reasonCounter`/`reasonError`/`toastWrap`/`warningBanner`/`warningRow`/`warningText`), then swap the tier-tab body for the three Settings blocks (Refund policy / Booking window / sales-aware notice) per design §2.

**Props (LOCKED — design §9):**
```ts
interface EditPublishedTripSettingsAccordionProps {
  eventId: string;
  refundPolicy: RefundPolicy | null;          // trip.refundPolicy
  bookingDeadline: string | null;             // ISO, trip.bookingDeadline
  bookingsClosed: boolean;                     // trip.bookingsClosed
  tripStartIso: string | null;                // trip.businessTrip.startAt
  brandTimezone: string | null;               // trip.timezone
  affectedOrderCount?: number;                // paid non-cancelled count; >0 ⇒ sales banner + block-aware
  onDirtyChange?: (dirty: boolean) => void;   // lifts dirtiness → parent editedSectionKeys("settings")
  onReject: (result: Extract<UpdateLiveTripResult, { ok: false }>) => void; // FORK 1 — see below
  testID?: string;
}
```

**Server-seeded local state (design §9, synchronous from props — NO loading skeleton):**
```ts
const [policy, setPolicy] = useState<RefundPolicy | null>(refundPolicy);
const [deadline, setDeadline] = useState<string | null>(bookingDeadline);
const [closed, setClosed] = useState<boolean>(bookingsClosed);
const dirty = JSON.stringify(policy) !== JSON.stringify(refundPolicy)
           || deadline !== bookingDeadline
           || closed !== bookingsClosed;
// fire onDirtyChange(dirty) in a useEffect
```
Use a `useEffect`-on-prop-change re-seed guarded by the same `trip`-identity pattern the parent uses IF the implementor wants symmetry, but since props arrive populated, the `useState` initializers suffice (design §5 loading note). Do NOT flash empty.

**Save wiring (design §9):** `onConfirmSave` builds `patch` carrying **ONLY the dirty fields** (omit unchanged keys so the RPC classifier evaluates only what changed):
```ts
const patch: LiveTripPatch = {};
if (JSON.stringify(policy) !== JSON.stringify(refundPolicy)) patch.refund_policy = policy;
if (deadline !== bookingDeadline) patch.booking_deadline = deadline;
if (closed !== bookingsClosed) patch.bookings_closed = closed;
```
Call `updateLiveTripFields(eventId, patch, trimmedReason)` via `useUpdateLiveTripFields()`. On `ok:true` → close reason banner, clear dirty, success Toast **"Settings saved. Live now."**. On `ok:false` → **see FORK 1**.

**FORK 1 — LOCKED: route the 4 refund-class reject reasons through the PARENT's `setRejectDialog` via the `onReject(result)` prop.**
**Decision + rationale:** The 4 new reasons MUST be added to `UpdateLiveTripRejectReason` (the union) AND to the parent's `buildRejectDialog` exhaustive `switch` (the trailing `const _exhaust: never = result.reason;` at `EditPublishedTripScreen.tsx` L890-892 makes the build FAIL if any union member is unhandled). Therefore the "Refund first" copy for the 4 reasons lives in `buildRejectDialog` **regardless**, and the screen's `ConfirmDialog` (L1470-1480) is the single reject-dialog renderer. So the accordion does NOT re-implement a dialog: on `ok:false` it calls `props.onReject(result)`; the parent wires `onReject={(r) => setRejectDialog(buildRejectDialog(r))}`. The accordion keeps the reason banner OPEN (preserves the typed reason + edit state so the planner can dial the edit back to favorable and retry) and clears `submitting`. **Network/unknown errors** (thrown, not `ok:false`) stay LOCAL: the accordion shows inline `reasonError` "Couldn't save. Try again." (intake parity), banner stays open. **This split is LOCKED: `ok:false` business rejects → parent dialog via `onReject`; thrown errors → local `reasonError`.**

**FORK 2 — LOCKED: per-control disable during submit via a `pointerEvents` + opacity wrapper (the editors take no `disabled` prop).**
`RefundPolicyEditor` and `BookingDeadlinePicker` accept **no `disabled` prop** (confirmed: `RefundPolicyEditorProps` = `{value, onChange}` L54-56; `BookingDeadlinePickerProps` = `{value, tripStartIso, brandTimezone, onChange}` L34-41). Therefore wrap **each** of the two editors in:
```tsx
<View pointerEvents={submitting ? "none" : "auto"} style={{ opacity: submitting ? 0.6 : 1 }}>
  <RefundPolicyEditor value={policy} onChange={setPolicy} />
</View>
```
The **Switch** supports a native `disabled` prop → pass `disabled={submitting}` directly (no wrapper). The reason-banner buttons use their own `loading`/`disabled` (intake parity). **LOCKED: editors wrapped (`pointerEvents="none"` + 0.6 opacity); Switch uses native `disabled`.**

**The live "Bookings closed" switch (design §2.1):** reuse the existing `trackColor` (`{false:"rgba(255,255,255,0.16)", true:accent.warm}`), `thumbColor="#ffffff"`, `ios_backgroundColor="rgba(255,255,255,0.16)"` from the current disabled switch; **remove `disabled` (except the submit-gate), add `onValueChange={setClosed}`**, value `={closed}`. a11y: `accessibilityRole="switch"`, `accessibilityLabel="Bookings closed"`, `accessibilityState={{checked:closed, disabled:submitting}}`, `accessibilityHint="Stops new bookings immediately."` (design §7).

**Proactive sales-aware banner (design §5 "WITH paid sales"):** render the `GlassCard` warning banner (intake `warningBanner` styles) ABOVE the save row **only when `affectedOrderCount > 0`**, with bell icon + copy: *"{n} traveler{s} already booked. More-generous refunds, an extra tier, or a later deadline save instantly — but you can't make terms worse for them here."* Hidden when `affectedOrderCount` is 0/undefined.

**ALL states (design §5):** loading = none (synchronous seed); empty = n/a (null policy → editor's own non-refundable template state; null deadline → picker's "No deadline" off); populated-no-sales = all 3 controls live, no banner, Save disabled until dirty; populated-with-sales = + proactive banner; submitting = editors wrapped-disabled + Switch disabled + Save loading; error = local `reasonError`; blocked-by-sales = parent `ConfirmDialog` via `onReject`, banner stays open, edit state preserved.

### 4.4 Parent — `EditPublishedTripScreen.tsx`

1. **Import** `EditPublishedTripSettingsAccordion`.
2. **Replace** the entire `case "settings":` JSX (L1291-1338 — the hint `Text` + 3 `settingsField` rows + the disabled `Switch`) with:
   ```tsx
   case "settings":
     return (
       <EditPublishedTripSettingsAccordion
         eventId={trip.id}
         refundPolicy={trip.refundPolicy}
         bookingDeadline={trip.bookingDeadline}
         bookingsClosed={trip.bookingsClosed}
         tripStartIso={trip.businessTrip.startAt}
         brandTimezone={trip.timezone}
         affectedOrderCount={/* see step 5 */}
         onDirtyChange={(d) => /* feed settings into editedSectionKeys */}
         onReject={(r) => setRejectDialog(buildRejectDialog(r))}
       />
     );
   ```
3. **Extend `buildRejectDialog`** (the `switch` at L782-893) with the **4 new cases** — copy shapes from design §5 (mirror existing "Refund first" entries, primary `closeAndOpenOrders`):

   | reason | title | body (n = affectedOrderCount) | primary |
   |---|---|---|---|
   | `refund_policy_downgrade_with_sales` | "Refund first" | `${n} traveler${n===1?"":"s"} booked under the current refund terms. You can make refunds MORE generous, but to lower them, refund existing buyers first.` | "Open Orders" → `closeAndOpenOrders` |
   | `refund_tier_removed_with_sales` | "Refund first" | `${n} traveler${n===1?"":"s"} are protected by your current refund tiers. Add a tier freely, but removing one means refunding them first.` | "Open Orders" → `closeAndOpenOrders` |
   | `booking_deadline_earlier_with_sales` | "Refund first" | `Moving the deadline earlier can strand people mid-booking. You can push it LATER any time; to pull it in, refund the ${n} affected first.` | "Open Orders" → `closeAndOpenOrders` |
   | `bookings_closed_harms_active` | "Refund first" | `Closing bookings this way affects ${n} active booking${n===1?"":"s"}. Refund them first, or leave bookings open.` | "Open Orders" → `closeAndOpenOrders` |

   All 4 added BEFORE the `default: { const _exhaust: never = result.reason; … }` so the exhaustive check stays satisfied. (Adding the union members in §4.2 WITHOUT these cases will fail the build — that is the intended fails-on-revert tripwire for the copy.)
4. **`editedSectionKeys`** (L665-685): add an effect/state so the accordion's `onDirtyChange(true)` adds `"settings"` to the set and `false` removes it, lighting the section-header "Edited" badge like every other section. Since `computed.patch` (the parent's diff) does NOT carry settings fields, the parent holds a small `settingsDirty` boolean state set by `onDirtyChange`, and `editedSectionKeys` ORs `settingsDirty` into adding `"settings"`. (Lightweight; mirrors how intake dirtiness is surfaced — confirm the intake accordion's parity mechanism and match it.)
5. **`affectedOrderCount` for the proactive banner:** the parent does not currently fetch a live sold-count for the banner. **LOCKED minimal approach:** pass the count the parent already has access to. If no count is readily on `trip`, the accordion's banner simply hides (treat undefined as 0) — the SERVER is the source of truth for the actual block (it computes `v_total_sold` fresh). The banner is a *proactive teach*, not the gate; a missing count degrades gracefully to "no banner, but the server still blocks correctly." **Open question Q-2 (§10):** does Seth want a live sold-count query wired for the banner, or is graceful-hide acceptable? Default: graceful-hide (no new query) to honor "do not widen scope."
6. **Delete** the now-dead styles: `settingsWrap`, `settingsHint`, `settingsField`, `settingsLabel`, `settingsValue` (L1621-1648). Remove the now-unused `Switch` import IF no other usage remains (grep first; keep if used elsewhere).

### 4.5 Realtime — N/A. No realtime channel touched.

---

## Design (embedded verbatim — binding input #3)

> The following is `UI_UX_ORCH-1120_TRIP_SETTINGS_REFUND_DEADLINE_EDITABLE.md` in full. It is the pixel-precise contract. §4.3 above LOCKS the two forks the designer flagged (route reject through parent `onReject`; wrap editors for submit-disable). Where this design says "the SPEC will lock which," §4.3 is authoritative.

(See the complete design report at `Mingla_Artifacts/reports/UI_UX_ORCH-1120_TRIP_SETTINGS_REFUND_DEADLINE_EDITABLE.md` — sections 0-10: deliverable, IA & flow, layout & spacing grid (incl. §2.1 live switch row), type scale, color & token mapping, every interactive state (incl. the NEW blocked-by-sales state + the 4 reject copy rows), motion spec, accessibility, per-platform deltas (Android opaque glass), build-ready handoff (props/state/save wiring/parent change), and justification ledger. The implementor MUST read that file in full alongside this SPEC. All of its concrete values — `spacing.md`=16 outer gap, `spacing.sm`=8 in-block, switch row ≥44pt via `paddingVertical: spacing.xs` + two-line text, `typography.caption`+600 block labels at `text.secondary`, `accent.warm` #eb7825 switch-on, the `GlassCard variant="base"` warning banner with `semantic.warning` #f59e0b border, the 200/160ms reason-banner ease in/out, the `accessibilityRole="switch"` config — are binding and not restated here to avoid drift.)

**The two forks the design flagged → LOCKED in §4.3:**
- **Fork 1 (reject routing):** route the 4 refund-class `ok:false` results through the parent's existing `setRejectDialog(buildRejectDialog(result))` via an `onReject(result)` prop. Thrown/network errors stay local as `reasonError`.
- **Fork 2 (per-control submit disable):** wrap `RefundPolicyEditor` + `BookingDeadlinePicker` each in `<View pointerEvents={submitting?"none":"auto"} style={{opacity: submitting?0.6:1}}>`; the `Switch` uses native `disabled={submitting}`.

---

## 5. ORCH-1118 coexistence (no-collision boundary)

**ORCH-1118** = `trip-address-mapbox-validation`: departure/destination free-text + Mapbox structured address on the **Basics** tab of the SAME `EditPublishedTripScreen` (its highest migration is `20260926000000`, i.e. it has NOT added a migration touching `biz_update_live_trip` yet, but it WILL extend the Basics editor + possibly the `business_trip` patch keys for `departureLocationText`/`destinationLocationText`).
**ORCH-1120** = THIS — the **Settings** tab refund/deadline/bookings-closed.

**Boundary (both land independently):**
- **Different tabs:** 1118 owns `case "basics"` (+ its address sub-editors); 1120 owns `case "settings"`. No JSX overlap.
- **Different RPC patch keys:** 1118 → `theme.business_trip.{departureLocationText,destinationLocationText,…}` (already partially handled by the 1075 §4b2 destination block); 1120 → top-level `refund_policy`/`booking_deadline`/`bookings_closed`. **No key collision.**
- **Migration ordering:** both `CREATE OR REPLACE` the same function. **Whichever merges second must re-emit from the LATEST merged main**, not its stale spawn copy, so it carries the other's block (clobber hazard — `feedback_edge_deploy_and_migration_apply_hazards`). The implementor of THIS ORCH MUST `git fetch origin && git rebase origin/main` immediately before writing the migration; if 1118's migration has already merged and rewrote `biz_update_live_trip`, re-emit from THAT body (not 1075) and add the 1120 blocks on top. **State this explicitly in the migration header comment.**
- **`buildRejectDialog`:** 1118 may add its own reject reasons; both append cases before the `_exhaust` default. Merge-conflict is a simple additive resolution. No shared logic.
- **`tripsService.ts` `LiveTripPatch`/`UpdateLiveTripRejectReason`:** both add keys to the same interfaces — additive, non-conflicting union/interface extensions.

---

## 6. Invariants

| ID | Status | How preserved | Test |
|----|--------|---------------|------|
| `I-AUDIT-PUBLISHED-TRIP-MUTATIONS-ROUTE-THROUGH-biz_update_live_trip` (per `EditPublishedTripScreen` header L37-39 audit invariant) | preserved | All refund/deadline/bookings-closed writes go through the extended `biz_update_live_trip`; the published path NEVER calls `refundPolicyService` | §9 grep gate + happy-path test SC-3 |
| `ANDROID_GLASS_USES_OPAQUE_FALLBACK` | preserved | The component uses `GlassCard` for the warning + reason banners; the opaque ≥0.92 Android fill is owned inside `GlassCard` (design §8) — no hand-rolled translucent `View` | visual parity on Android emulator (tester) |
| `I-PROPOSED-TR4-REFUND-CASCADE-MONOTONICITY` | preserved | The RPC validates via `validate_refund_policy()` + the DB CHECK `events_refund_policy_valid` fires on the UPDATE | migration test (bad policy raises) |
| **`I-PROPOSED-1120-PUBLISHED-REFUND-DEADLINE-VIA-GATED-RPC`** | **DRAFT (NEW — flips ACTIVE on CLOSE)** | Published-trip refund-policy / booking-deadline / bookings-closed edits MUST route through `biz_update_live_trip` (which enforces the buyer-unfavorable sales-gate), NEVER through `refundPolicyService.updateRefundPolicy/updateBookingDeadline`. The standalone service functions remain DRAFT-WIZARD-ONLY | §9 strict-grep gate: `refundPolicyService.update{RefundPolicy,BookingDeadline}` callers ⊆ {wizard files}; `EditPublishedTripScreen`/`EditPublishedTripSettingsAccordion` must NOT import them |
| **`I-PROPOSED-1120-UNFAVORABLE-EDIT-HARD-BLOCKS-WITH-SALES`** | **DRAFT (NEW)** | When `v_total_sold>0`, a realized-refund-% drop, an earlier deadline, or a false→true bookings-closed flip returns `ok:false` with the matching reason + `affected_order_count` and does NOT write; favorable edits always apply | migration SQL test (§7) + tester adversarial cases |

---

## 7. Test cases

| # | Test | Scenario | Input | Expected | Layer |
|---|------|----------|-------|----------|-------|
| T-1 | unfavorable refund + sales → BLOCK | trip with 2 paid orders, policy Flexible(30→100,14→50,0→0) | patch `refund_policy`=Strict(90→100,0→0) (lowers realized % at d=14..29 from 50→0) | `{ok:false, reason:"refund_policy_downgrade_with_sales", affected_order_count:2}`; `events.refund_policy` unchanged | DB (RPC) |
| T-2 | favorable refund + sales → ALLOW | same trip | patch `refund_policy`=Flexible but 14→**80** (raise) | `{ok:true}`; policy written | DB |
| T-3 | add a tier + sales → ALLOW | policy Strict(90→100,0→0), 1 paid order | patch adds 30→50 tier (raises realized % at d∈[30,89]) | `{ok:true}` | DB |
| T-4 | remove tier that lowers realized % + sales → BLOCK | Flexible 3-tier, 1 paid order | patch removes 14→50 tier (realized % at d=14..29 drops 50→0) | `{ok:false, reason:"refund_policy_downgrade_with_sales", affected_order_count:1}` (NOT `refund_tier_removed_with_sales` under default classifier — see §4.1.A note) | DB |
| T-5 | no sales → fully editable | trip with 0 paid orders | any of the above unfavorable patches | `{ok:true}`; written | DB |
| T-6 | deadline earlier + sales → BLOCK | deadline 2026-08-01, 1 paid order | patch `booking_deadline`=2026-07-01 | `{ok:false, reason:"booking_deadline_earlier_with_sales", affected_order_count:1}` | DB |
| T-7 | deadline later + sales → ALLOW | deadline 2026-07-01, 1 paid order | patch `booking_deadline`=2026-08-01 | `{ok:true}`; written | DB |
| T-8 | clear deadline + sales → ALLOW (favorable) | deadline 2026-07-01, 1 paid order | patch `booking_deadline`=null | `{ok:true}`; deadline NULL | DB |
| T-9 | close bookings + sales → BLOCK | `bookings_closed=false`, 1 paid order | patch `bookings_closed`=true | `{ok:false, reason:"bookings_closed_harms_active", affected_order_count:1}` | DB |
| T-10 | reopen bookings + sales → ALLOW | `bookings_closed=true`, 1 paid order | patch `bookings_closed`=false | `{ok:true}`; closed=false, `bookings_closed_at`=NULL | DB |
| T-11 | bad policy shape → CHECK raises | any trip | patch `refund_policy` with ascending days | RPC propagates 23514 (or validate raise); service maps to friendly error; no write | DB + service |
| T-12 | published path does not call refundPolicyService | static | grep | 0 callers of `updateRefundPolicy`/`updateBookingDeadline` outside wizard + service file | static (CI grep) |
| T-13 | dead-end hint gone | render Settings tab | mount `EditPublishedTripSettingsAccordion` | no "Open the wizard from the draft trip menu" string anywhere on the screen | component |
| T-14 | switch fires (dead-tap proof) | render, toggle Bookings-closed | tap switch | `closed` flips, dirty=true, Save enables (runtime/device) | component / device |
| T-15 | exhaustive reject switch | build | add 4 union reasons | `buildRejectDialog` compiles only with all 4 cases present (revert any case → `_exhaust: never` TS error) | type/build |

---

## 8. Success criteria (numbered, observable, testable — parity automatic so not split per surface)

- **SC-1** Opening a published trip → Edit → Settings shows an EDITABLE refund-policy block, an editable booking-deadline picker, and a LIVE "Bookings closed" switch — no read-only snapshot, no "use the wizard" hint anywhere (T-13).
- **SC-2** Editing any control marks the field dirty, enables "Save changes," and lights the Settings section-header "Edited" badge; Save opens the reason banner; ≥10-char reason + Save commits via `biz_update_live_trip` and shows "Settings saved. Live now." (T-14, §4.4.4).
- **SC-3** Every save routes through `updateLiveTripFields` → `biz_update_live_trip`; the published path makes ZERO calls to `refundPolicyService.updateRefundPolicy/updateBookingDeadline` (T-12, §9 grep).
- **SC-4** With paid non-cancelled orders: a buyer-UNFAVORABLE edit (lower realized refund %, remove a tier that lowers realized %, earlier deadline, false→true bookings-closed) is HARD-BLOCKED — RPC returns `ok:false` + the matching reason + `affected_order_count`, NOTHING is written, and the parent `ConfirmDialog` shows the "Refund first" copy (T-1, T-4, T-6, T-9).
- **SC-5** With paid orders: a buyer-FAVORABLE edit (raise a refund %, add a tier, later deadline, clear deadline, reopen bookings) ALWAYS applies (T-2, T-3, T-7, T-8, T-10).
- **SC-6** With NO sales: all edits apply freely (T-5).
- **SC-7** On `ok:false`, the reason banner stays open, the typed reason + local edit state are preserved, and submitting clears, so the planner can dial the edit to favorable and retry (§4.3 Fork 1).
- **SC-8** During submit, the two editors are non-interactive (0.6 opacity, `pointerEvents:none`) and the Switch is `disabled`; on network/unknown error the inline `reasonError` "Couldn't save. Try again." shows and the banner stays open (§4.3 Fork 2 + states).
- **SC-9** Android renders the warning + reason banners with the opaque ≥0.92 `GlassCard` fallback (no translucent hand-rolled fill); business-web preview renders the same component editable.

---

## 9. Regression prevention (fails-on-revert contract)

1. **Strict-grep CI gate** `.github/scripts/strict-grep/i-proposed-1120-published-refund-via-gated-rpc.mjs`:
   - **FAILS** if `EditPublishedTripScreen.tsx` OR `EditPublishedTripSettingsAccordion.tsx` imports/calls `updateRefundPolicy` or `updateBookingDeadline`.
   - **FAILS** if `EditPublishedTripSettingsAccordion.tsx` does not call `updateLiveTripFields` (or the `useUpdateLiveTripFields` hook).
   - Protective comment in the gate: *"ORCH-1120: published refund/deadline/bookings-closed edits MUST route through the sales-gated biz_update_live_trip RPC, NEVER the sales-unaware refundPolicyService direct writes (INVESTIGATE F-4 / DISC-1120-A). The standalone service functions are draft-wizard-only."*
   - **Revert proof:** point the published save back at `updateRefundPolicy` → gate FAILS; restore → PASSES.
2. **Migration SQL test** `supabase/migrations/__tests__/orch_1120_trip_settings_refund_deadline.test.sql` (sibling of the existing `orch_1075_…test.sql`): seeds a trip + paid order, asserts T-1/T-2/T-6/T-7/T-9/T-10 return the exact `{ok, reason, affected_order_count}` shapes and that no row is written on a block. **Revert proof:** remove the `4g` gate block → T-1/T-6/T-9 return `ok:true` (write happens) → test FAILS; restore → PASSES.
3. **Type-exhaustiveness tripwire (built-in):** the 4 new `UpdateLiveTripRejectReason` members + the `_exhaust: never` in `buildRejectDialog` mean omitting any of the 4 cases is a compile error (T-15). No separate test needed — `tsc` is the gate.

---

## 10. Open questions

- **Q-1 (classifier reason granularity):** The realized-% classifier surfaces both "lowered a tier %" and "removed a tier" as `refund_policy_downgrade_with_sales`. The design names a distinct `refund_tier_removed_with_sales`. **Default contract:** RPC emits only `refund_policy_downgrade_with_sales` for all refund downgrades; the `refund_tier_removed_with_sales` reason + copy are still ADDED (type + dialog) but unused unless Seth wants a literal-tier-count branch. **Decision needed:** keep one reason (simpler, money-accurate) or split into two (matches the design table exactly)? Recommend ONE (the realized-% harm test is the correct buyer-protection semantic). Non-blocking — implementor proceeds with the default.
- **Q-2 (proactive banner sold-count):** the `affectedOrderCount` for the proactive teach banner — wire a live sold-count query, or graceful-hide when unavailable (server still blocks correctly)? **Default:** graceful-hide (no new query, honors no-scope-widen). Non-blocking.
- **Q-3 (device proof of the disabled-switch baseline):** INVESTIGATE capped the *visual* of the old disabled switch at "suspected" (login-gated sim). Not blocking the build, but the tester's device pass (SC-1, T-14) closes it.

None of Q-1..Q-3 block IMPLEMENT. The SPEC's defaults are buildable as-is.

---

## 11. Scoped allowlist + DO-NOT-TOUCH

**ALLOWLIST (implementor may create/modify ONLY these):**
- `supabase/migrations/20260929000000_orch_1120_trip_settings_refund_deadline.sql` (NEW — version per §4.0 re-scan)
- `supabase/migrations/__tests__/orch_1120_trip_settings_refund_deadline.test.sql` (NEW)
- `mingla-business/src/components/trip/EditPublishedTripSettingsAccordion.tsx` (NEW)
- `mingla-business/src/components/trip/EditPublishedTripScreen.tsx` (settings case + `buildRejectDialog` + `editedSectionKeys` + style deletions + import)
- `mingla-business/src/services/tripsService.ts` (`LiveTripPatch` + `UpdateLiveTripRejectReason` only)
- `.github/scripts/strict-grep/i-proposed-1120-published-refund-via-gated-rpc.mjs` (NEW) + its registration in the strict-grep runner manifest
- Test files colocated with the above (jest for the accordion happy-path)

**DO-NOT-TOUCH (stop-and-amend before changing — request a SPEC amendment):**
- `mingla-business/src/services/refundPolicyService.ts` (`updateRefundPolicy`/`updateBookingDeadline` stay as-is — draft-wizard path, N-4)
- `mingla-business/src/components/trip/TripCreatorWizard.tsx` + Step-5 files (draft path)
- `mingla-business/src/components/trip/RefundPolicyEditor.tsx`, `BookingDeadlinePicker.tsx` (mount as-is, no new props — wrapped not modified, N-3)
- `supabase/functions/cancel-trip-booking/`, `process-booking-deadlines/`, `ticket-checkout-create/` (enforcement consumers — read the columns, unaffected)
- ORCH-1118's Basics-tab address editors / `business_trip` departure-destination keys (§5, N-6)
- Any consumer/buyer/admin surface (N-5)

---

## 12. Implementation order

1. **Re-scan migration versions** (§4.0) + `git fetch origin && git rebase origin/main`. Confirm `20260929000000` is still free; bump if not. If 1118's migration has merged and rewrote `biz_update_live_trip`, re-emit from THAT body.
2. **DB:** write `20260929000000_…sql` — re-emit 1075 `biz_update_live_trip` verbatim + insert §4.1 blocks (4g gate, 5f apply, severity, GRANT, COMMENT). Write the `.test.sql`.
3. **Service:** extend `LiveTripPatch` + `UpdateLiveTripRejectReason` in `tripsService.ts` (§4.2).
4. **Parent types/dialog:** extend `buildRejectDialog` with the 4 cases (§4.4.3) — build now passes the exhaustive check.
5. **Component:** create `EditPublishedTripSettingsAccordion.tsx` from the intake skeleton + the 3 Settings blocks + forks 1 & 2 (§4.3 + Design).
6. **Parent wiring:** replace `case "settings"` JSX, wire `onReject`/`onDirtyChange`/`editedSectionKeys`, delete dead styles, fix imports (§4.4).
7. **CI gate:** add the strict-grep gate (§9.1) + register it.
8. **Self-verify:** run jest (accordion happy-path), the SQL test, the grep gate; prove fails-on-revert for §9.1 and §9.2; `tsc` clean.

---

## 13. Downstream routing

**Next = mingla-implementor (business side).** Inputs: this SPEC + the 3 binding artifacts (esp. the embedded design report read in full). Worktree `~/Desktop/mingla-orchs/orch-1120-[trip-settings-refund-deadline]/` on branch `orch-1120-trip-settings-refund-deadline` (rebase on origin/main first; re-scan migration version). Hard constraints: allowlist + DO-NOT-TOUCH (§11); forks LOCKED in §4.3; migration re-emitted from latest merged `biz_update_live_trip` body; published path NEVER calls `refundPolicyService`. Output: working code + the §9 regression artifacts + an implementation report. **Then = mingla-tester** (adversarial, different-angle: drive the business app on device — prove the switch + editors actually FIRE and PERSIST per the runtime-proof invariant; adversarial SQL on the gate covering T-1..T-11; cross-check no `refundPolicyService` call on the published path; Android opaque-glass visual). **Then = mingla-orchestrator CLOSE** (flips the 2 DRAFT invariants ACTIVE).
