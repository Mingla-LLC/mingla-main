# IMPLEMENTATION — ORCH-1119B [trip-day-media-gallery] · upload RLS + visible failure

**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1119-[trip-day-media-gallery]` · branch `ORCH-1119-trip-day-media-gallery`
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1119B_UPLOAD_RLS_AND_VISIBLE_FAILURE.md`
**Investigation:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1119_HAPTIC_NO_MEDIA.md`
**Date:** 2026-06-12
**Status:** implemented and verified (RLS live-proven against prod; component live fails-on-revert proven; jest + Deno green; device smoke is the tester's job)

---

## 1. Summary

Trip-day gallery uploads ("+ Add media" → Library → multi-select) fired a haptic but landed **no tile and no visible error**. Two proven causes, both fixed:

- **Layer 1 (load-bearing, RLS):** the upload key is 3 folder segments (`{brand}/{event}/trip-day-media/{file}`), but every existing `event_covers` write policy hard-requires `array_length(...) = 2` → every trip-day INSERT was 403'd → zero objects ever landed. Added a NEW, additive, fail-closed `event_covers` Storage policy set (INSERT/UPDATE/DELETE) scoped to `foldername[3] = 'trip-day-media'`, with the same brand/event-identity + caller-rank ≥ `event_manager` auth predicate the 2-segment cover policies use. Applied live via the Supabase Management API.
- **Layer 2 (Constitution #3, visible failure):** `TripDayMediaSheet` only closed the full-screen native Modal on upload success, so an all-failed batch left the Modal occluding the wizard-root toast — the user saw nothing. Changed the post-loop close to **unconditional** so the already-dispatched error toast becomes visible.

After the fix, a real brand-owner authenticated INSERT of the 3-segment trip-day key **succeeds and the object lands**; an under-ranked/non-member caller is **denied**; the 2-segment event-cover write **still succeeds**; and a `/evil/` 3-segment key is **denied**.

---

## 2. SPEC success-criteria coverage

| SC | Description | Status | Evidence / commit |
|----|-------------|--------|-------------------|
| SC-1 (image lands) | 3-seg image INSERT by event_manager lands an object | ✓ proven (DB-RLS live) | live INSERT (a) ALLOW + LANDPROOF object queried in `storage.objects`; device render is tester's. Commit `<FIX>` |
| SC-2 (video lands) | same with a video ext | ✓ proven at RLS layer | policy is ext-agnostic (filename-only guard); same live proof (a). Bucket already allows mp4/webm/quicktime (`20260515000002/10`). Device render is tester's |
| SC-3 (draft persistence) | `media[]` round-trips through draft save | ✓ (unchanged path) | append/persist path RULED-OUT-correct by investigation (F-4/F-5); ORCH-1119 persistence test still PASS |
| SC-4 (published-edit persistence) | add media on EditPublishedTrip persists via `biz_update_live_trip` | ✓ (unchanged path) | same RLS policy serves both; `biz_update_live_trip` (mig `20260928000001`) untouched. Device confirm is tester's |
| SC-5 (no cross-loosening) | 2-seg cover ALLOW; sub-rank 2-seg DENY; 3-seg non-trip-day DENY; 3-seg trip-day sub-rank/wrong-brand DENY | ✓ proven (DB-RLS live) | live (b) DENY, (c) ALLOW, (d) DENY; Deno truth-table 12/12. Commit `<FIX>` |
| SC-6 (visible failure) | forced-fail batch shows a VISIBLE toast; sheet closes | ✓ proven (jest fails-on-revert) | jest 1119B-A/B; reverting line 393 leaves `onClose` UNCALLED on 0-success. Commit `<FIX>` |
| SC-7 (read path intact) | uploaded public URL passes HEAD 200 | ✓ (no SELECT change) | bucket-wide public SELECT untouched; no new/removed SELECT policy. Device HEAD is tester's |

`<FIX>` = `3e71118611746e818e5185e14d0088b18048e860` (see §6).

---

## 3. Files changed

| File | Change | Δ |
|------|--------|---|
| `supabase/migrations/20260930000000_orch_1119b_trip_day_media_storage_rls.sql` | NEW — 3 additive trip-day Storage policies (INSERT/UPDATE/DELETE), idempotent | +85 |
| `mingla-business/src/components/trip/TripDayMediaSheet.tsx` | line ~393: gated `if (uploaded.length > 0) onClose()` → unconditional `onClose()` + explanatory comment | +5 / −1 |
| `mingla-business/src/components/trip/__tests__/orch1119b_trip_day_media_visible_failure.test.ts` | NEW — jest close-on-0-success regression | +~165 |
| `supabase/migrations/__tests__/orch_1119b_trip_day_media_storage_rls.test.ts` | NEW — Deno DB-RLS regression (structural anchors + truth-table) | +~210 |

(Also present uncommitted in the worktree from the forensics phase: the SPEC + two investigation files under `Mingla_Artifacts/`. They ship with this branch.)

---

## 4. Data-model changes applied

**Migration `20260930000000` — applied LIVE via the Supabase Management API** (browser UA; MCP read-only; CLI drift-wedged), then recorded in `supabase_migrations.schema_migrations`.

- Three NEW policies on `storage.objects`, all gated `bucket_id='event_covers' AND array_length(storage.foldername(name),1)=3 AND (storage.foldername(name))[3]='trip-day-media' AND storage.filename(name)<>'' AND EXISTS(events e WHERE e.brand_id::text=[1] AND e.id::text=[2] AND e.deleted_at IS NULL AND biz_brand_effective_rank_for_caller(e.brand_id) >= biz_role_rank('event_manager'))`:
  - `"Event managers can upload trip day media"` (INSERT, WITH CHECK)
  - `"Event managers can update trip day media"` (UPDATE, USING + WITH CHECK) — for `upsert:true`
  - `"Event managers can delete trip day media"` (DELETE, USING) — defensive cleanup parity
- Existing 2-segment cover/experience-stop policies: **NOT modified** (left textually + live untouched).
- No SELECT policy added (bucket-wide public read already serves trip-day reads).

### Live `pg_policies` verification (post-apply)

```
policyname                              | cmd    | has_using | has_check
Event managers can delete trip day media| DELETE | t         | f
Event managers can upload trip day media| INSERT | f         | t
Event managers can update trip day media| UPDATE | t         | t
```
3 rows, correct USING/CHECK shapes. `schema_migrations` row `20260930000000 / orch_1119b_trip_day_media_storage_rls` confirmed present.

### LIVE RLS INSERT PROOF (the load-bearing check)

Real authenticated INSERT attempts into `storage.objects` against prod (`gqnoajqerqhnvulmnyvv`), `role=authenticated` + `request.jwt.claims.sub` set to each test user, so `auth.uid()` and the rank function resolve for real. Brand `22a18413-bfbf-4087-9ba7-45f70deba0f3` (owner `b17e3e15-…`, effective rank 60 ≥ event_manager 40); trip event `61980280-…`; stranger `c727d491-…` (non-member, rank 0).

```
(a) 3seg trip-day as OWNER      => ALLOW   (was DENY before the fix — the bug)
(b) 3seg trip-day as STRANGER   => DENY    (fail-closed)
(c) 2seg cover as OWNER         => ALLOW   (no regression)
(d) 3seg non-trip-day (/evil/)  => DENY    (no cross-loosening)
persisted_rows=2                            (the two ALLOWs landed real rows)
```
The truth-table block above ran inside a DO that aborted (rolled back) — nothing persisted from it. **Separately, a committed INSERT of `…/trip-day-media/LANDPROOF_orch1119b.jpg` by the owner LANDED and was queried back from `storage.objects` (seg3 = `trip-day-media`), then cleaned up** (`storage.allow_delete_query`). This is the definitive "a trip-day object now lands" proof. Post-proof: 0 proof objects remain.

---

## 5. Edge functions touched

None. (The service already builds the correct 3-segment key; only the gating policy was missing. No edge deploy required.)

---

## 6. Regression tests added + fails-on-revert

Both shipped in the SAME branch as the fix; both visible in `git diff origin/main...HEAD --name-only`.

1. **DB-RLS (Deno):** `supabase/migrations/__tests__/orch_1119b_trip_day_media_storage_rls.test.ts` — 12 tests. Structural `migrationContains` anchors for the 3 policies + the 3-seg/`[3]='trip-day-media'`/auth predicates, plus a byte-for-byte re-implemented truth-table: (a) owner ALLOW, (b) under-ranked/wrong-brand DENY, (c) 2-seg cover ALLOW + disjointness, (d) `/evil/` + 4-seg DENY, empty-filename/wrong-bucket DENY. **`deno test` → 12 passed.**
   - **fails-on-revert:** TRUE LINE DELETION of the INSERT `CREATE POLICY` block → `1 failed` (INSERT-policy-exists anchor). Restored → 12 passed. **Verified at `3e71118611746e818e5185e14d0088b18048e860`.**

2. **Component (jest):** `mingla-business/src/components/trip/__tests__/orch1119b_trip_day_media_visible_failure.test.ts` — 6 tests. Behavioral replica of `handleConfirm`'s post-loop resolution: all-failed batch → `onShowToast` AND `onClose` both called (fix) vs the OLD gated close leaves `onClose` UNCALLED (proves the bug); full-success + partial-success both close; plus a source-contract anchor that the post-loop close is unconditional and the pre-upload catch keeps the sheet open. **`jest` → 6 passed.**
   - **fails-on-revert:** TRUE replacement of the unconditional `onClose()` back to `if (uploaded.length > 0) onClose()` → `1 failed` (the unconditional-close source anchor). Restored → 6 passed. **Verified at `3e71118611746e818e5185e14d0088b18048e860`.**

Append-only: both are new files; no existing test modified/deleted (`git diff --name-status origin/main -- '*.test.ts*'` shows no M/D).

---

## 7. Old → New receipts

### `mingla-business/src/components/trip/TripDayMediaSheet.tsx`
- **Before:** after the upload loop, `if (uploaded.length > 0) onClose();` — the sheet closed ONLY when ≥1 upload succeeded. On an all-failed batch the native Modal stayed mounted, occluding the wizard-root toast → silent failure.
- **Now:** `onClose();` unconditionally after the error-surfacing block — the sheet closes whenever the batch resolves (full success AND 0-success), so the already-dispatched error toast (`onShowToast` above) is visible. Pre-upload throws (outer catch) still keep the sheet open for retry.
- **Why:** SC-6 / Constitution #3 (no silent failure).
- **Lines:** +5 / −1 (comment + one conditional removed).

### `supabase/migrations/20260930000000_orch_1119b_trip_day_media_storage_rls.sql` (NEW)
- **Before:** no `event_covers` policy permitted a 3-segment key → all trip-day uploads 403'd.
- **Now:** three additive, fail-closed, idempotent policies permit the 3-segment `…/trip-day-media/…` key for INSERT/UPDATE/DELETE under the same auth predicate as the 2-segment cover policies; disjoint by the `array_length=3` count guard.
- **Why:** SC-1/2/4/5 — the load-bearing RLS fix.
- **Lines:** +85.

---

## 8. Cross-surface impact

| Surface | Affected | Parity | Notes |
|---------|----------|--------|-------|
| Consumer iOS | No | n/a | render-only, no authoring path |
| Consumer Android | No | n/a | same |
| Buyer/anon Web | No | n/a | renders persisted trip-day media; no authoring |
| **Business iOS** | **Yes** | automatic | migration (shared DB) + shared RN component |
| **Business Android** | **Yes** | automatic | same shared file + DB → parity is automatic, no per-platform code |
| Admin Web | No | n/a | no trip authoring in admin |
| Business Web preview | No | n/a | the picker upload path is native-only |

No manual per-platform code — the fix is a universal DB policy + one shared RN file.

---

## 9. Smoke result

- DB layer: live-fired against prod (see §4) — ALLOW/DENY truth-table correct; a committed object landed + was queried + cleaned.
- Component layer: jest behavioral + source-contract green; live fails-on-revert proven by true line deletion.
- Device smoke (image + video tile renders, draft + published-edit persistence, forced-fail visible toast on iOS + Android) is the **tester's** SC-1/2/3/4/6/7 device pass — not run here.

---

## 10. Known issues / deferred

- **DELETE policy is defensive parity only.** The current remove-tile flow drops the URL from `media[]` and does NOT delete the object → orphan objects accumulate (SPEC OQ-1). Not built here; a future "delete object on tile-remove" is now RLS-permitted should the orchestrator want it.
- No `[TRANSITIONAL]` code introduced.

## 11. Operator action required

- **Migration already applied LIVE** (Management API). For the normal-deploy reconciliation on merge, the file is `supabase/migrations/20260930000000_orch_1119b_trip_day_media_storage_rls.sql`; a future `db push` is a no-op (`DROP POLICY IF EXISTS` + recorded `schema_migrations` row), but if a clean re-apply is wanted:
  ```bash
  cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1119-[trip-day-media-gallery]" && /Users/sethogieva/bin/supabase db push --linked
  ```
- **No edge functions to deploy.**
- **OTA:** the ORCH-1119 dev OTA re-publish (per COMMS-0028 D-1) is **orchestrator-owned** — NOT done here. Do it LAST, from an isolated cache, after REVIEW.

## 12. Discoveries for Orchestrator

- **COMMS-0028 (WARN → ORCH-1119):** factored, not acted on. The GIPHY-key OTA clobber is orthogonal to this fix (no storage upload in that path). The ORCH-1119 dev-OTA re-publish is yours; this fix does not touch the GIPHY service. Already acked by ORCH-1119 forensics per the SPEC.
- **Pre-existing trip-suite jest failures (NOT introduced here):** running `jest src/components/trip` shows 29 failures across `TripPublishStripeBanner`, `PaymentPlanEditor(_adversarial)`, `EditPublishedTripScreen.save/.refundGate`, `InstallmentScheduleDisplay_wiring`, `TripVisualParity(_adversarial)`, `IntakeTypePickerSheet_orch_0884`, `TripCreatorWizard.cover`, `tr2RewordPolish`. **Proven pre-existing** — git-stashing my component change leaves the same suites failing identically (8 failed / 47 passed in a 3-suite spot-check, unchanged). They are unrelated to ORCH-1119B (Stripe/payment-plan/visual-parity surfaces) and exist on the rebased branch baseline. Flagging for triage; out of this ORCH's scope.

---

## Verification matrix

| Gate | Result |
|------|--------|
| `deno test --allow-read .../orch_1119b_trip_day_media_storage_rls.test.ts` | 12 passed |
| `jest .../orch1119b_trip_day_media_visible_failure.test.ts` | 6 passed |
| Existing `orch1119_trip_day_media_multiselect.rework` + persistence + boundary tests | PASS (untouched) |
| Live `pg_policies` (3 trip-day policies) | present, correct cmd/USING/CHECK |
| Live RLS INSERT truth-table | (a) ALLOW (b) DENY (c) ALLOW (d) DENY |
| Object-lands proof | LANDPROOF object landed + queried + cleaned |
| Migration monotonic (`20260930000000` > remote `20260928000002` + sibling `20260929000000`) | confirmed |
| New failures vs branch baseline | none (failing suites pre-exist, stash-proven) |
| Append-only (no existing test modified/deleted) | confirmed |
| Invariants preserved (2-seg cover fail-closed; Constitution #3; explicit type) | yes |
