# IMPLEMENTATION — ORCH-1123 [Hub multi-select draft delete]

**Mode:** mingla-implementor (single-pass execution against the binding SPEC + DESIGN)
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1123-[hub-multiselect-draft-delete]` (branch `ORCH-1123-hub-multiselect-draft-delete`)
**Commit:** `040abb870` (all ORCH-1123 scoped files in one commit)
**Date:** 2026-06-12
**Inputs read in full:** `SPEC_ORCH-1123_HUB_MULTISELECT_DRAFT_DELETE.md`, `DESIGN_ORCH-1123_HUB_MULTISELECT_DRAFT_DELETE.md`, source single-delete RPC `20260515000006_orch_0763d_draft_discard_rpc.sql`, all 3 Hub tabs, all 3 list cards + ExperienceListCard, designSystem tokens, key-factories (eventDraft/trip/experience/brand), the haptic util, ConfirmDialog/Toast props, the migration-source test pattern.
**COMMS_LEDGER:** read on entry — no OPEN row targets ORCH-1123 / implementor / ALL. No new cross-ORCH discovery requiring a write (the migration-version collision is intra-ORCH-1123, handled below).

---

## 1. Summary (plain English)

Founders can now long-press a DRAFT row on any of the three business-app Hub tabs (Events, Trips, Experiences) to enter a select mode, tap more draft rows to check them, and delete them all at once via a warm "Delete (N)" bar → red confirm dialog. Only drafts are selectable; Live/Upcoming/Past rows dim and go inert. Deletion is server-authoritative (a new batch RPC that skips-and-reports per row, rank-gated to event_manager+), so a partial failure surfaces an honest "Deleted N, M couldn't be deleted" toast instead of silently dropping the user's intent. For Events, locally-drafted (never-saved) rows are removed from the device store without ever hitting the server. Experiences gain their first-ever delete capability; Trips' bulk path now goes through the rank-checked RPC (stricter than the old client UPDATE).

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Status | Where (commit `040abb870`) |
|----|-----------|--------|----------------------------|
| Q1 | Shared `useDraftMultiSelect` + `DraftSelectBar` + `DraftSelectCheckbox` | ✓ | `src/hooks/useDraftMultiSelect.ts`, `src/components/offering/DraftSelectBar.tsx`, `DraftSelectCheckbox.tsx` |
| Q2 | Experiences: long-press gated to `status==="draft"`, NO new filter pills / tab redesign | ✓ | `app/(tabs)/hub/experiences.tsx` (selectable=isDraftRow inside `ExperienceGenerationSurface` only) |
| Q3 | Batch RPC SKIP-and-report per row (`deleted`/`skipped_not_draft`/`skipped_not_found`/`forbidden`) | ✓ | `supabase/migrations/20260928000000_…sql` |
| Q4 | Events local-only vs server partition (one confirm, one combined toast) | ✓ | `events.tsx` `handleBulkDeleteConfirm` + `useDiscardOfferingDrafts.ts` |
| Q5 | Counts invalidation (`brandKeys.offeringCounts`) all kinds | ✓ | `useDiscardOfferingDrafts.ts` onSuccess |
| Q6 | Trip bulk converges on rank-checked RPC; single path untouched | ✓ | `trips.tsx` (`kind:"trip"` → RPC); `softDeleteTrip`/`useSoftDeleteTrip` not touched |
| Q7 | Long-press sole entry; no overflow "Select" | ✓ | cards `onLongPress`+`delayLongPress={350}`; manage sheets untouched |
| Q8 | Reuse `ConfirmDialog` simple+destructive; verbatim copy | ✓ | all 3 tabs bulk dialog |
| §3.4 | Warm "Delete (N)" bar; red only on dialog; disabled at N=0; testIDs; a11y; Android opaque | ✓ | `DraftSelectBar.tsx` |
| §3.8 | Verbatim dialog + toast copy strings | ✓ | all 3 tabs (`bulkToastMessage`, dialog title/desc/labels) |
| DESIGN §5.1 | Hold-ring + persistent caption + null-shake + Medium entry haptic | ✓ | `DraftSelectOverlay.tsx`, `selectHint` in all 3 tabs, `HapticFeedback.selectionEnter()` |
| DESIGN §7 | Android opaque-glass bar (`#16181b`, overflow:hidden, no Android shadow) | ✓ | `DraftSelectBar.tsx` Platform.select |
| DESIGN §8 | Row `role="checkbox"` + `checked` state in select mode; dimmed non-draft hidden from a11y | ✓ | all 3 cards |

All criteria **implemented and verified by jest + project tsc**; the long-press/dead-tap RUNTIME proof is the tester's device deliverable (source-only caps at "suspected" per memory) — labeled `implemented, partially verified`.

---

## 3. Files changed (19 files, commit `040abb870`)

**New (9):**
1. `supabase/migrations/20260928000000_orch_1123_batch_discard_offering_drafts.sql` (+93) — batch RPC
2. `supabase/migrations/__tests__/orch_1123_batch_discard.test.sql` (+119) — SQL behavioral probe
3. `mingla-business/src/services/offeringDrafts.ts` (+43)
4. `mingla-business/src/hooks/useDiscardOfferingDrafts.ts` (+112)
5. `mingla-business/src/hooks/useDraftMultiSelect.ts` (+61)
6. `mingla-business/src/components/offering/DraftSelectBar.tsx` (+262)
7. `mingla-business/src/components/offering/DraftSelectCheckbox.tsx` (+116)
8. `mingla-business/src/components/offering/DraftSelectOverlay.tsx` (+171) — **added vs SPEC** (shared hold-ring/wash/null-shake; see Deviations)
9. `mingla-business/src/hooks/__tests__/useDraftMultiSelect.test.ts` (+200) — happy-path test
10. `mingla-business/src/utils/__tests__/orch_1123_batch_rpc_source.test.ts` (+159) — migration+wiring source test

**Edited (additive, 9):**
11. `mingla-business/src/components/event/EventListCard.tsx` (+135)
12. `mingla-business/src/components/trip/TripListCard.tsx` (+94)
13. `mingla-business/src/components/offering/OfferingListCard.tsx` (+94)
14. `mingla-business/src/components/experience/ExperienceListCard.tsx` (+13) — pass-through props
15. `mingla-business/app/(tabs)/hub/events.tsx` (+177)
16. `mingla-business/app/(tabs)/hub/trips.tsx` (+183) — incl. ADD `<Toast>`
17. `mingla-business/app/(tabs)/hub/experiences.tsx` (+198)
18. `mingla-business/src/utils/hapticFeedback.ts` (+11) — `selectionEnter()`
19. `Mingla_Artifacts/INVARIANT_REGISTRY.md` (+42) — 5 I-PROPOSED invariants

> `useBrandOfferingCounts.ts` was NOT edited: SPEC §7 file 17 said "export `brandKeys` if not already" — it is already exported from `useBrands.ts`, so the hook imports `brandKeys` from `useBrands` (corrected import path vs SPEC §3.2's stub). Additive, no behavior change.

---

## 4. Data-model changes applied

**New RPC** `public.business_discard_offering_drafts(p_event_ids uuid[]) RETURNS TABLE(event_id uuid, outcome text)`:
- `SECURITY DEFINER`, `SET search_path TO 'public','pg_temp'`.
- Per-row guards copied verbatim from `business_discard_event_draft`: auth-present (`not_authenticated`), row-exists-and-not-already-deleted, `status='draft'`, `event_manager` rank via `biz_brand_effective_rank`/`biz_role_rank`, brand-exists-and-not-deleted, `FOR UPDATE` lock, idempotent re-discard.
- SKIP-and-report: each id yields one outcome row; the batch never aborts. Empty/NULL input → empty result set.
- `$function$;` terminator BEFORE GRANT; `REVOKE ALL … FROM PUBLIC` + `… FROM anon`; `GRANT EXECUTE … TO authenticated, service_role`. `COMMENT ON FUNCTION` present.
- `RETURNS TABLE` is brand-new (no widening) → no DROP needed.

No tables/columns/constraints/indexes/RLS changed (everything stays soft-delete `deleted_at = now()`).

---

## 5. Edge functions touched

None. (`verify_jwt` N/A — no edge function in scope.)

---

## 6. Regression tests added + fails-on-revert proof

**Happy-path (implementor-owned):**
- `mingla-business/src/hooks/__tests__/useDraftMultiSelect.test.ts` — 11 tests: hook mechanics (enterWith/toggle/clear/exit), events partition (mixed `[d_x,uuid1,uuid2]` → server vs local-only; no `d_*` ever in `serverEventIds`), toast tally strings (§3.8 combos). PASS 11/11.
- `mingla-business/src/utils/__tests__/orch_1123_batch_rpc_source.test.ts` — 6 tests: RPC per-row guards + SKIP-and-report + `$function$;`-before-GRANT + REVOKE/GRANT; per-tab wiring (long-press→enterWith, drafts-only selectable, partition, RPC kind, `<Toast>` added to trips, verbatim copy, `delayLongPress={350}`, null-shake, role=checkbox). PASS 6/6.
- `supabase/migrations/__tests__/orch_1123_batch_discard.test.sql` — transactional psql probe (B-01 3 managed drafts→deleted+deleted_at set; B-02 non-draft→skipped_not_draft not deleted; B-03 missing→skipped_not_found; B-04 idempotent re-discard→skipped_not_found). Tears down all seeded rows. **Run by the orchestrator/tester against the linked remote (implementor does not apply migrations).**

**fails-on-revert verified at `040abb870`** (true line deletion, not comment-out):
- Deleted the RPC per-row rank-gate block (`biz_brand_effective_rank … < biz_role_rank('event_manager')`) → `orch_1123_batch_rpc_source.test.ts` "RPC replicates per-row…guards" FAILED.
- Replaced the events partition (`selected.filter(isLocalOnlyDraft)` / `serverIds` split) with a no-op all-server map → same suite's "events:…partition" FAILED.
- Result with both fixes deleted: `2 failed, 4 passed`. Restored both files via `git checkout -- …` → `17 passed, 0 failed`. Proof complete.

Append-only honored: all 3 test files are git A-status (new); no existing test modified.

---

## 7. Old → New receipts (per changed surface)

### `business_discard_offering_drafts` (NEW migration)
**Before:** only a single-row `business_discard_event_draft(uuid)` existed (RAISE-EXCEPTION on any bad row).
**Now:** a batch `(uuid[])` RPC that loops, locks, and yields one outcome per id (SKIP-and-report), with identical per-row guards, rank-gated.
**Why:** Q3 + no-silent-failure (§2.3) — a stale row can't silently void the whole batch.

### 3 list cards (EventListCard / TripListCard / OfferingListCard)
**Before:** static `<View>` host + body Pressable → open; manage 3-dot always shown.
**Now:** `Animated.View` host with additive `selectionMode`/`selected`/`selectable`/`onLongPress` props; body Pressable gains `onLongPress`+`delayLongPress={350}`+press-in/out hold-ring; checkbox overlay top-left of the cover when selecting a draft; selected wash + accent border; non-draft rows dim 0.4 + inert; manage 3-dot hidden during selection; row `accessibilityRole` flips to `checkbox`. All defaults are non-selection so every existing call site is unaffected.
**Why:** Q1/Q7 + DESIGN §4.2/§5.1/§8.

### 3 Hub tabs (events/trips/experiences)
**Before:** single-item flows only; trips had no Toast.
**Now:** mount `useDraftMultiSelect` + `useDiscardOfferingDrafts`; long-press a draft → `enterWith` + Medium haptic; filter-pill switch away from Drafts calls `selection.exit()` (events/trips; experiences auto-scopes); discoverability caption above the draft list; `DraftSelectBar` + bulk `ConfirmDialog`; combined toast tally; events partitions local-only vs server; trips gains a `<Toast>` mount.
**Why:** Q4/Q5/Q6/Q8 + DESIGN §6.

### `hapticFeedback.ts`
**Before:** `buttonPress()` (Light) + `success()`.
**Now:** + `selectionEnter()` (Medium impact) at the long-press fire.
**Why:** DESIGN §9.3.

---

## 8. Cross-surface impact

| Surface | Affected? | What changes / why not |
|---------|-----------|------------------------|
| Consumer iOS | No | app-mobile untouched (business-only feature) |
| Consumer Android | No | same |
| Buyer/anonymous Web | No | no buyer routes touched (drafts are founder-only) |
| Business iOS | **Yes** | long-press multi-select + bulk delete on 3 Hub tabs |
| Business Android | **Yes** | same; bar uses opaque-glass fallback |
| Admin Web (adjacent) | No | Vite admin untouched |
| Business Web preview (adjacent) | **Yes** | shared RN codebase; bar falls back to opaque `#16181b` on mobile-web via `shouldUseRealBlur` |

Parity across the 3 business surfaces is **automatic** (one shared RN codebase + shared selection primitives). No manual parity gap.

---

## 9. Smoke result

- **Project tsc (`tsc --noEmit -p tsconfig.json`):** zero errors in any ORCH-1123 file. 257 errors total are ALL pre-existing baseline noise in `../packages/phone-input/**` (24x) + unrelated files (checkout buyer, marketing composer, IconChrome, payments-native, test files with `category`) — confirmed present on clean baseline; none in my files.
- **jest (ORCH-1123 suites):** `17 passed, 0 failed`.
- **jest (adjacent — Android glass, EventListCard defensive filter, experiences hub):** PASS.
- **jest (pre-existing baseline failures, NOT caused by ORCH-1123, confirmed by stash-and-rerun):** `serverDraftLifecycleGuards.test.ts` 6 fails (reads stale `app/(tabs)/events.tsx` path that no longer exists), `OfferingParity`/`TripVisualParity` 7 fails (assert META-ORCH-1002-superseded `backgroundColor: glass.tint.profileBase` + old TripCreatorWizard chrome). Baseline = 45/52 (same 7 fail); my changes did not move that number.
- **Runtime (sim/device):** NOT run by implementor — long-press dead-tap proof + partial-failure live-fire + Zustand-consistency are the tester's device deliverables (memory: source-only caps at "suspected"). Labeled `implemented, partially verified`.

---

## 10. Known issues / deferred

- **Selected-wash z-order over the checkbox:** the `accent.tint` (28% opacity) wash is a later host sibling than the checkbox (nested in coverWrap), so it paints faintly over the checkbox. The checkbox's solid warm fill + white check remain legible through the translucent wash; if the tester finds it visually weak on device, lift the checkbox to a host-level sibling after the overlay. Not a functional defect.
- No `[TRANSITIONAL]` code introduced.

---

## 11. Operator action required

**Apply the migration (orchestrator/operator DEPLOY step — implementor did NOT apply):**
```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1123-[hub-multiselect-draft-delete]" && /Users/sethogieva/bin/supabase db push --linked
```
- Migration `20260928000000_orch_1123_batch_discard_offering_drafts.sql` is strictly monotonic (> latest local/anchor `20260926000000`; the SPEC's `20260927000000` was already claimed by sibling worktree `ORCH-1123-[booking-gate-rls]`).
- Per memory (CLI drift-wedged in this worktree; this worktree's `supabase` is not linked), the actual apply may need the Supabase Management API path. The SQL is idempotent (`CREATE OR REPLACE`); a guarded `DROP FUNCTION IF EXISTS public.business_discard_offering_drafts(uuid[]);` may be prepended if a dirty-env signature conflict occurs (additive, safe).
- **Read-only probe not run by implementor:** the RPC has no pre-flight backfill/RAISE-EXCEPTION guards against existing rows (it only acts on ids the caller passes), so no destructive-guard probe is required before `db push`. The behavioral probe `__tests__/orch_1123_batch_discard.test.sql` is for post-apply verification.

**Edge functions:** none to deploy.

**OTA:** pure-JS/RN change (no native module/config) → eligible for `eas update` per-platform after merge (orchestrator/operator call), per `project_ota_deferred_until_new_build`. The new `selectionEnter()` uses already-bundled `expo-haptics` (no native rebuild).

---

## 12. Discoveries for Orchestrator

1. **Pre-existing test rot (NOT ORCH-1123):** `serverDraftLifecycleGuards.test.ts` reads `app/(tabs)/events.tsx` (moved to `app/(tabs)/hub/events.tsx` long ago) → 6 stale-path failures; `OfferingParity`/`TripVisualParity` assert pre-META-ORCH-1002 `backgroundColor: glass.tint.profileBase` (now `Platform.select`) + old `TripCreatorWizard` chrome → 7 failures. These are on `origin/main` today. Worth registering a cleanup ORCH (append-only requires `[TEST-MOD-APPROVED]` to fix).
2. **ORCH-ID collision in flight:** three live worktrees share the `ORCH-1123-` prefix (`[hub-multiselect-draft-delete]`, `[booking-gate-rls]`, `[gif-cover-key]`), and `[booking-gate-rls]` already used migration `20260927000000`. I bumped to `20260928000000`. The orchestrator should confirm these are distinct registered ORCHs (or a numbering collision to reconcile at INTAKE) before two of them merge with the same ID.

---

**Artifact:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1123_HUB_MULTISELECT_DRAFT_DELETE.md`
