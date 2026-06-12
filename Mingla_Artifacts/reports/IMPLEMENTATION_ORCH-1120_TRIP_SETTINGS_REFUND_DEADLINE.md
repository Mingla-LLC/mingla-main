# IMPLEMENTATION — ORCH-1120 [Published-trip Settings tab → editable refund tiers + booking deadline + bookings-closed (sales-gated)]

**Skill:** mingla-implementor (business side). **Date:** 2026-06-12.
**Worktree:** `~/Desktop/mingla-orchs/orch-1120-[trip-settings-refund-deadline]/` on branch `orch-1120-trip-settings-refund-deadline` (rebased on origin/main at start).
**Status:** implemented and verified (source + gate level). Device/runtime dead-tap + live-SQL gate drive deferred to the tester per SPEC §13. **REWORK applied 2026-06-12 — see the REWORK section below.**
**Binding inputs read in full:** SPEC_ORCH-1120, UI_UX_ORCH-1120 (design), INVESTIGATE_ORCH-1120 + ENUMERATE_REFUND_BUYER_PROTECTION_RULES (context), the 1075 `biz_update_live_trip` body, TR4 `validate_refund_policy` + `biz_compute_refund_for_cancel`, the intake-accordion skeleton, both ORCH-0875 editors, `tripsService.ts`, `EditPublishedTripScreen.tsx`.

---

## 1. Summary

A planner editing a PUBLISHED trip → Edit → **Settings** previously saw a read-only snapshot plus a lie ("Refund tiers and booking deadline are managed from the trip wizard… Open the wizard from the draft trip menu") routing to a path that doesn't exist for published trips, plus a hardcoded-disabled "Bookings closed" switch.

This ORCH makes Settings **editable in place**: a new `EditPublishedTripSettingsAccordion` mounts the shipped ORCH-0875 `RefundPolicyEditor` + `BookingDeadlinePicker` (unmodified) plus a **live** "Bookings closed" Switch. ALL writes route through the sales-aware `biz_update_live_trip` RPC (extended to carry `refund_policy` / `booking_deadline` / `bookings_closed`), never through the sales-unaware `refundPolicyService` direct writes. The RPC enforces the buyer-protection asymmetry: with paid non-cancelled orders, buyer-UNFAVORABLE edits (lower realized refund %, earlier deadline, harmful bookings-closed flip) HARD-BLOCK with a "Refund first" dialog + affected-order count; buyer-FAVORABLE edits always apply; no sales = fully editable. The dead-end hint + its dead styles are deleted.

---

## 2. SPEC success-criteria coverage

| SC | Criterion | How satisfied | Commit |
|----|-----------|---------------|--------|
| SC-1 | Settings shows editable refund block + deadline picker + LIVE switch; no read-only snapshot, no "use the wizard" hint | New accordion mounts both editors + live `Switch`; `case "settings"` rewired; hint + dead styles deleted | `62e6b0b90` |
| SC-2 | Editing marks dirty, enables Save, lights "Edited" badge; reason banner; ≥10-char reason commits via `biz_update_live_trip`; "Settings saved. Live now." | `dirty` from JSON-compare; `onDirtyChange→settingsDirty→editedSectionKeys`; intake reason chassis; success Toast copy | `636043196` / `62e6b0b90` |
| SC-3 | Every save routes through `updateLiveTripFields`→`biz_update_live_trip`; ZERO `refundPolicyService` calls on the published path | Accordion saves via `useUpdateLiveTripFields`; strict-grep gate enforces it | `636043196` |
| SC-4 | Paid orders + buyer-UNFAVORABLE edit HARD-BLOCKED — RPC `ok:false`+reason+count, nothing written, parent "Refund first" dialog | §4g gate (realized-% classifier + deadline-earlier + harmful-close), `onReject`→`buildRejectDialog` | `ef8381355` / `62e6b0b90` |
| SC-5 | Paid orders + buyer-FAVORABLE edit ALWAYS applies | §4g classifier returns false → §5f apply runs | `ef8381355` |
| SC-6 | NO sales = all edits apply freely | §4g blocks gated on `v_total_sold>0` | `ef8381355` |
| SC-7 | On `ok:false`, banner stays open, reason + edit state preserved, submitting clears | FORK-1: `onReject` only; banner not closed; `finally setSubmitting(false)` | `636043196` |
| SC-8 | During submit editors non-interactive (0.6 opacity, pointerEvents:none), Switch disabled; network error → inline "Couldn't save. Try again." | FORK-2 wrappers + native `disabled={submitting}`; catch→`reasonError` | `636043196` |
| SC-9 | Android opaque ≥0.92 `GlassCard` fallback; web preview editable | Banners use `GlassCard` (policy owned inside it); same RN component on web — deferred to tester for visual proof | `636043196` (UNVERIFIED-visual — tester) |

Parity is automatic (one shared RN component + one RPC) — SCs not split per surface.

---

## 3. Files changed (8 files, +1855 / −77)

| File | Δ | Commit |
|------|---|--------|
| `supabase/migrations/20260929000000_orch_1120_trip_settings_refund_deadline.sql` (NEW) | +758 | `ef8381355` |
| `supabase/migrations/__tests__/orch_1120_trip_settings_refund_deadline.test.sql` (NEW) | +186 | `ef8381355` |
| `.github/scripts/strict-grep/i-proposed-1120-published-refund-via-gated-rpc.mjs` (NEW) | +113 | `ef8381355` |
| `.github/workflows/strict-grep-mingla-business.yml` | +11 | `636043196` |
| `mingla-business/src/components/trip/EditPublishedTripSettingsAccordion.tsx` (NEW) | +508 | `636043196` (+ lint `8bed59509`) |
| `mingla-business/src/components/trip/__tests__/EditPublishedTripSettings_orch_1120_regression.test.ts` (NEW) | +185 | `636043196` (+ harden `b9e7990a4`) |
| `mingla-business/src/services/tripsService.ts` | +20 / −2 | `7252076c7` |
| `mingla-business/src/components/trip/EditPublishedTripScreen.tsx` | +151 / −77 | `62e6b0b90` |

Every claimed-changed file has a commit on this branch; working tree clean for all 8.

---

## 4. Data-model changes applied

**None (DDL).** No new tables/columns/constraints/indexes. The migration is a `CREATE OR REPLACE FUNCTION public.biz_update_live_trip(uuid, jsonb, text)` (scalar `jsonb` return, UNCHANGED — no `DROP FUNCTION`, no `RETURNS TABLE` widening). The 3 columns (`refund_policy`, `booking_deadline`, `bookings_closed`) + `bookings_closed_at` already exist from TR4 migration `20260612000000` (read-only remote probe confirmed all 4 present + `validate_refund_policy` + `events_refund_policy_valid` CHECK live). RLS unchanged — the function is `SECURITY DEFINER`, gates on `biz_brand_effective_rank >= event_manager`.

**Function behavior added (verbatim re-emission of 1075 + insertions):**
- **§4g** gate (NEW): refund_policy realized-% classifier (mirrors `biz_compute_refund_for_cancel` tier selection: largest `days_before_start <= d` wins, else 0; unfavorable iff new<old at any threshold in `old∪new∪{0}`); booking_deadline earlier-direction check; bookings_closed false→true harmful-flip check. Each HARD-BLOCKS only when `v_total_sold>0`. Defensive past-deadline clamp (no 5th reason, per SPEC §4.1.2 LOCKED).
- **§5f** apply (NEW): writes the 3 columns + `bookings_closed_at` (now() on false→true close, NULL on any →false open) only when present in the post-gate patch.
- **§6** severity: the 3 new keys OR-in as `material`.
- GRANT + COMMENT re-emitted (GRANT after the closing `$$;`).

**Verbatim-fidelity verified:** diffed §1-Auth..§4f, §5a..§5e, and §7-§8+END against the 1075 body — byte-identical (ignoring blank lines). Only deltas: added DECLARE locals + §4g + §5f + §6 OR-in + COMMENT append.

---

## 5. Edge functions touched

**None.** No edge function added or modified. (The RPC lives in Postgres, not an edge function.) `verify_jwt` N/A.

---

## 6. Regression tests added

### 6.1 Implementor happy-path jest test (source-assertion, mirrors the existing `EditPublishedTripScreen.refundGate.test.ts` pattern)
`mingla-business/src/components/trip/__tests__/EditPublishedTripSettings_orch_1120_regression.test.ts` — **22 tests, all PASS.** Covers: gated-RPC routing (SC-3), no-refundPolicyService on the published path (comment-stripped), live Switch + dirty-only patch (SC-1/2), FORK-1 `onReject` in the `ok:false` branch, FORK-2 editor wrappers, the 3 LiveTripPatch keys + 4 reasons, all 4 `buildRejectDialog` cases ("Refund first"+"Open Orders"), the exhaustive `_exhaust:never`, dead-end hint gone + dead styles removed + accordion mounted + `settingsDirty` wiring.

**fails-on-revert verified at `b9e7990a4`** (test) against component commit `8bed59509`:
- Fix present → FORK-1 test PASSES.
- True LINE DELETION of `onReject(result);` (line 170 of the accordion) → FORK-1 test FAILS (`1 failed`).
- Restore → PASSES again.
- *(Additionally, an involuntary mid-session reversion of the two tracked files — see §10 — independently demonstrated 14 assertions failing when the screen/service edits were absent, then all 22 passing once re-applied.)*

### 6.2 Migration SQL probe
`supabase/migrations/__tests__/orch_1120_trip_settings_refund_deadline.test.sql` — write-safe (BEGIN/ROLLBACK + temp functions), `\set ON_ERROR_STOP on`. M-10 body-marker check (fails-on-revert: deleting the §4g gate RAISEs "gate missing"); M-11..M-16 exercise the realized-% classifier + deadline/bookings-closed direction logic against the SPEC §7 refund shapes (T-1 Flexible→Strict=unfavorable, T-2 raise=favorable, T-3 add-tier=favorable, T-4 remove-tier-lowers=unfavorable, NULL boundaries, T-6..T-10 deadline/close direction). **Hand-run AFTER `db push`** (auth-gated full-RPC drive is the tester's E2E layer).

---

## 7. Old → New receipts

### `biz_update_live_trip` (migration)
**Before:** validated auth/reason/type/status/permission + 1075 paid-publish guards + the 8-path refund-gate (capacity/dates/days/inclusions/2×pricing/intake) + applied patch; did NOT accept refund_policy/booking_deadline/bookings_closed (those fell through unwritten).
**After:** + §4g buyer-protection gate for the 3 Settings fields (realized-%-aware, sales-gated) + §5f apply block + material severity for them + 3 new reject reasons + updated COMMENT. All 1075 logic re-emitted verbatim.
**Why:** SPEC §2.1 LOCKED decision — close the last 2 buyer-relied-upon fields that escaped the sales-gate (ENUMERATE (d)). **Lines:** +~155 over the 1075 body.

### `tripsService.ts`
**Before:** `LiveTripPatch` had no refund/deadline/closed keys; `UpdateLiveTripRejectReason` ended at `offering_date_past`.
**After:** +3 optional patch keys (pass-through to the RPC, `null`→JSON null); +4 reject reasons (`refund_tier_removed_with_sales` RESERVED per Q-1 default).
**Why:** SPEC §4.2 — type the new contract + keep `buildRejectDialog` exhaustive. **Lines:** +20/−2.

### `EditPublishedTripSettingsAccordion.tsx` (NEW)
**Before:** did not exist.
**After:** Settings sibling of the intake accordion — server-seeded local state, both editors (FORK-2 wrapped), live Switch, proactive sales banner, intake reason-save-toast chassis, FORK-1 reject routing via `onReject`, gated save via `useUpdateLiveTripFields`.
**Why:** SPEC §4.3 + embedded design. **Lines:** +508.

### `EditPublishedTripScreen.tsx`
**Before:** `case "settings"` rendered a read-only snapshot + dead-end "use the wizard" hint + disabled Switch; `buildRejectDialog` had no Settings cases; `editedSectionKeys` ignored settings; `Switch` imported.
**After:** `case "settings"` renders the new accordion (wired `onReject`/`onDirtyChange`/`affectedOrderCount=totalConfirmedOrders`); `buildRejectDialog` +4 "Refund first" cases; `settingsDirty` state ORs into `editedSectionKeys`; dead styles + `Switch` import removed.
**Why:** SPEC §4.4. **Lines:** +151/−77 (net structural).

---

## 8. Cross-surface impact

| # | Surface | Affected | Note |
|---|---------|----------|------|
| 1 | Consumer iOS | NO | no trip authoring |
| 2 | Consumer Android | NO | — |
| 3 | Buyer/anon Web (`/t/...`) | NO | refund policy *displayed* read-only; correctness preserved (gate only blocks worsening edits) |
| 4 | Business iOS | YES | the editable Settings tab + sales-gate |
| 5 | Business Android | YES | identical; Android glass via `GlassCard` opaque fallback (automatic) |
| 6 | Admin Web | NO | no trip editor |
| 7 | Business Web preview | YES (adjacent) | same RN component; editable; iOS translucent glass path (acceptable per design §8) |

Parity automatic (one shared RN component + one RPC). The only per-surface delta (glass fill) is owned inside `GlassCard` — no work here.

---

## 9. Gate results (real output)

- **Strict-grep gate** `i-proposed-1120-published-refund-via-gated-rpc.mjs` → **PASS** (`EXIT=0`). Self-checks: no `updateRefundPolicy`/`updateBookingDeadline` on the published path (comment-stripped); accordion calls `updateLiveTripFields`/`useUpdateLiveTripFields`.
- **Workflow YAML** → job `orch-1120-published-refund-via-gated-rpc` registered + indent-validated.
- **jest** (my suite) → **22 passed, 22 total.**
- **jest** (full `src/components/trip/__tests__/`) → 27 failed / 282 passed. **Baseline (my changes reverted): 27 failed / 260 passed** — IDENTICAL failure count; my changes added 22 passing tests and broke ZERO. The 10 pre-existing failing suites are unrelated (TripCreatorWizard/PaymentPlanEditor/VisualParity timeouts + 2 stale-assertion EditPublishedTripScreen suites — see §12).
- **tsc --noEmit** → 257 repo-wide errors, **ZERO in my 4 files** (baseline with my tracked files reverted: 260). The exhaustive `_exhaust:never` switch compiles, proving all 4 reasons are handled.
- **eslint** (my 4 files) → clean after the apostrophe fix (`8bed59509`); remaining warnings are all pre-existing on untouched lines.
- **Migration dollar-quote balance** → one `AS $$`…`$$;` pair, GRANT after the close; test.sql `$fn$`/`$$` balanced.

---

## 10. Known issues / deferred

- **`[TRANSITIONAL]`** — the "Open Orders" CTA reuses the existing `closeAndOpenOrders` toast stub ("Trip orders ledger is coming soon… refund via Stripe dashboard"). Exit condition: the trip-orders ledger ORCH ships (SPEC N-2). Not introduced by 1120 — inherited.
- **iCloud/linter reversion hazard (recovered).** Mid-session, the harness reverted my edits to the two *tracked* files (`tripsService.ts`, `EditPublishedTripScreen.tsx`) AND the workflow YAML back to origin state (the 5 NEW untracked files survived). Recovered by re-applying all edits and **committing incrementally** (per `feedback_icloud_desktop_sync_corrupts_git_anchor`). Final state verified: all 8 files committed, clean tree, 22/22 green. This is why there are 6 commits rather than 4.
- **SC-9 Android opaque-glass visual + business-web editable render** → UNVERIFIED at source; deferred to the tester's device/emulator pass.
- **Migration `.test.sql` full-RPC E2E** → the auth-gated end-to-end drive (real trip fixture + paid order + `auth.uid()`) is the tester's adversarial layer; this file proves the gate is present (fails-on-revert) + the classifier math is correct.
- **COMMS-0024 (WARN/ALL)** — factored, NOT appended to `acked_by`: the anchor `main` has pre-existing unstaged multi-session changes that block the ledger's `pull --rebase` procedure; editing the dirty anchor risks the documented anchor-corruption hazard. The WARN content was honored (ORCH-1120 owns its number cleanly; migration version re-scanned and still free). Orchestrator can append the ack at REVIEW.

---

## 11. Operator action required (orchestrator/operator — NOT the implementor)

**Migration `db push` (after REVIEW + tester PASS, from the worktree):**
```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/orch-1120-[trip-settings-refund-deadline]" && /Users/sethogieva/bin/supabase db push --linked
```
- Version `20260929000000` re-confirmed free at IMPLEMENT time: remote head is `20260928000002` (ORCH-1116 merged since SPEC; the chosen version is strictly greater). On origin/main the newest migration touching `biz_update_live_trip` is STILL `20260911000000_orch_1075` — **re-emission from the 1075 body is correct; no clobber.** ORCH-1118 has NOT merged a `biz_update_live_trip` rewrite.
- Read-only remote probe ran: 4 event columns + 4 helper fns + the CHECK constraint all present → no guard/backfill hazard. Safe to push.
- **Hand-run the SQL probe** after push: `psql … -f supabase/migrations/__tests__/orch_1120_trip_settings_refund_deadline.test.sql` (expects `ALL PASS (M-10..M-16)`).

**Edge functions to deploy:** NONE (no edge function touched).

**No deploy / merge / OTA performed by the implementor.** Route to REVIEW → tester.

---

## 12. Discoveries for Orchestrator

1. **2 pre-existing trip jest suites fail on origin/main (NOT 1120-introduced, append-only protected — I did NOT touch them):**
   - `EditPublishedTripScreen.save.test.ts` — asserts exactly 6 sections `[basics,itinerary,inclusions,pricing,cover,settings]` but ORCH-0880 added `intake` (7 sections). Stale ORCH-0880 regression.
   - `EditPublishedTripScreen.refundGate.test.ts` — asserts a single-line `import { UpdateLiveTripPermissionError } from "../../services/tripsService"` that is actually a multi-line import; never matched. Stale brittle assertion.
   These need an orchestrator-approved `[TEST-MOD-APPROVED ORCH-NNNN]` to fix (out of 1120 scope).
2. **Repo-wide typecheck has 257 pre-existing errors** (checkout buyer files, marketing ComposerV2, `@mingla/payments-native` module resolution, packages/brand-rendering) — none in 1120's scope. Flagging the baseline rot.
3. **Q-1 resolved with the SPEC default** (single `refund_policy_downgrade_with_sales` reason for all refund downgrades; `refund_tier_removed_with_sales` RESERVED-but-unused — added to the type + dialog for exhaustiveness/design-table fidelity, not emitted by the RPC). Documented in the migration COMMENT + the type comment. If Seth wants the literal-tier-count branch, it's a one-block follow-up.
4. **Q-2 resolved favorably without scope-widen:** the proactive sales banner consumes the parent's existing `totalConfirmedOrders` (derived from `soldCountByTier`) — no new query. Graceful-hide when 0/undefined.

---

## REWORK — consolidated to a single standard Save button (Seth device feedback, 2026-06-12)

**Why:** the device build showed **TWO** "Save changes" buttons on the published-trip Edit screen — the new Settings accordion had its OWN save button + its OWN reason dialog (a duplicate save path) on top of the screen's standard bottom "Save changes". Seth's locked rework: ONE save button (the standard bottom one), ONE reason prompt (the screen's `ChangeSummaryModal`), ONE gate. The Settings tab becomes a pure CONTROLLED EDITOR.

**Changes (client wiring only — RPC/migration UNCHANGED):**

1. **`EditPublishedTripSettingsAccordion.tsx`** — rewritten as a pure controlled editor. DELETED: its `useUpdateLiveTripFields` mutation, `onSavePressed`/`onConfirmSave`, the reason dialog/banner + both internal "Save changes" buttons, the `reason`/`reasonDialogVisible`/`reasonError`/`submitting`/`toast` state, the `onReject`/`onDirtyChange`/`eventId` props, the now-dead imports (`Button`, `Toast`, `TextInput`, `useUpdateLiveTripFields`, `UpdateLiveTripPermissionError`, `LiveTripPatch`/`UpdateLiveTripResult` types) and the dead reason/save/toast styles. ADDED: controlled props `refundPolicy`/`onRefundPolicyChange`, `bookingDeadline`/`onBookingDeadlineChange`, `bookingsClosed`/`onBookingsClosedChange` + `submitting` (display/disable only). The 3 editors stay mounted; the sales banner stays as read-only context. ~510 → ~250 lines.

2. **`EditPublishedTripScreen.tsx`** — `refund_policy`/`booking_deadline`/`bookings_closed` added to `LocalTripEditState` + `tripToLocalEditState` (seeded from `trip`) + `buildLiveTripPatch` (carry-only-dirty diff). New `handleRefundPolicyChange`/`handleBookingDeadlineChange`/`handleBookingsClosedChange` lift edits into `editState`. `editedSectionKeys` derives the Settings badge from the patch diff; the `settingsDirty` state is removed. `case "settings"` now renders the accordion with controlled props + `submitting`. The single bottom Save (`handleSavePress` → `ChangeSummaryModal` → `handleConfirmSave` → `validateLiveTripFieldUpdate` → `biz_update_live_trip` → `buildRejectDialog`) now covers the three fields. Added `import type { RefundPolicy }`. ~+45 lines net.

3. **`utils/tripAdapter.ts`** — `FIELD_LABELS` + `MATERIAL_KEYS` extended with `refund_policy`/`booking_deadline`/`bookings_closed` (all MATERIAL per SPEC §6); `computeRichTripFieldDiffs` emits MATERIAL diffs for the three (so they show in the modal). `classifyTripSeverity` returns `material` automatically via `MATERIAL_KEYS`. `import type { RefundPolicy }` added.

4. **`utils/publishedTripEditGuards.ts`** — `validateLiveTripFieldUpdate` pre-blocks the two unambiguous unfavorable settings edits (earlier `booking_deadline` with sales → `booking_deadline_earlier_with_sales`; false→true `bookings_closed` with sales → `bookings_closed_harms_active`). Refund-policy realized-% downgrades are NOT mirrored client-side (money-math; server is canonical per SPEC §4.1.A) → they surface via `!result.ok` → `buildRejectDialog`.

5. **`.github/scripts/strict-grep/i-proposed-1120-published-refund-via-gated-rpc.mjs`** — the required gated-save assertion moved from the ACCORDION to the SCREEN (the gated save was consolidated into the parent). The banned-direct-writer ban (`updateRefundPolicy`/`updateBookingDeadline`) stays on BOTH files. Gate PASSES.

6. **`EditPublishedTripSettings_orch_1120_regression.test.ts`** — rewritten (net-new vs origin/main, so append-only `A` status, no `[TEST-MOD-APPROVED]` needed) to pin the consolidated contract: accordion has NO internal save/reason/mutation/onReject; parent diffs the three fields into the single RPC; the three fields are MATERIAL; the 4 reject reasons still render the "Refund first" copy via the single `buildRejectDialog`. **27/27 pass.**

**Gates (post-REWORK):**
- `tsc --noEmit` — ZERO errors in the 4 touched product files (`EditPublishedTripScreen`, `EditPublishedTripSettingsAccordion`, `tripAdapter`, `publishedTripEditGuards`). Repo-wide 255 pre-existing errors unrelated (marketing/payments-native/DraftEvent fixtures).
- `eslint` (4 files) — 0 errors (7 pre-existing warnings, none on new code).
- Strict-grep `i-proposed-1120-published-refund-via-gated-rpc.mjs` — PASS.
- Jest `EditPublishedTripSettings_orch_1120_regression.test.ts` — 27/27 PASS.
- **fails-on-revert (true line-deletion):** deleted `patch.refund_policy = state.refundPolicy` in `buildLiveTripPatch` → regression test FAILED (1 failed / 26 passed: "buildLiveTripPatch diffs the three settings fields into the patch"); restored → 27/27 PASS. **fails-on-revert verified at commit `<see closing branch HEAD>`** (test: `mingla-business/src/components/trip/__tests__/EditPublishedTripSettings_orch_1120_regression.test.ts`).
- `publishedTripEditGuards` suite (14/14) + `ORCH-0876.adversarial` (PASS) unaffected.

**The two-button duplication is GONE** — there is now exactly one save button (the screen's bottom `edit-trip-save`), one reason prompt (`ChangeSummaryModal`), one gate (`biz_update_live_trip`), one reject path (`buildRejectDialog`). The published path STILL writes only through `biz_update_live_trip`; DISC-1120-A landmine stays closed.

**Pre-existing test failures re-confirmed (NOT introduced by the REWORK, NOT in scope):** `EditPublishedTripScreen.save.test.ts` (asserts 6 sections; ORCH-0880 made it 7 by adding `intake`) and `EditPublishedTripScreen.refundGate.test.ts` (asserts a single-line `UpdateLiveTripPermissionError` import that is multi-line — broken since the ORCH-1006 import merge). Both fail identically on the pre-REWORK branch baseline. Orchestrator should register a `[TEST-MOD-APPROVED]` follow-up to refresh them.
