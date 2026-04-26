# SPEC — ORCH-0678 — Two-Pass Bouncer

**Author:** mingla-forensics (SPEC mode)
**Source investigation:** [`reports/INVESTIGATION_ORCH-0678_LAGOS_BOUNCER_MASS_REJECT.md`](../reports/INVESTIGATION_ORCH-0678_LAGOS_BOUNCER_MASS_REJECT.md) (REVIEW APPROVED 2026-04-25)
**Source dispatch:** [`prompts/SPEC_ORCH-0678_PHOTO_PIPELINE_DEADLOCK.md`](../prompts/SPEC_ORCH-0678_PHOTO_PIPELINE_DEADLOCK.md) (design APPROVED by user 2026-04-25)
**Severity:** S1 — blocks every future city seed
**Estimated effort:** 1 migration + 1 new edge fn + 1 shared lib opts flag + 1 backfill gate change + 1 admin UI component + invariants + tests = ~3-5 hours implementor time.

---

## Layman summary

Today the Bouncer rejected all 4,222 Lagos places because the photo download step was supposed to run first but couldn't — its eligibility gate requires `is_servable=true`, which only the Bouncer sets, which requires photos. **Deadlock.**

This spec reshapes the pipeline into **two distinct Bouncer passes** with photo download in between:

1. **Pre-Photo Bouncer** — runs every rule except B8 (the stored-photo check). Weeds out places that lack websites, hours, valid types, google-photo metadata, etc. Writes a NEW column `passes_pre_photo_check`.
2. **Photo Backfill** — gates on `passes_pre_photo_check=true` instead of the broken `is_servable=true`. Downloads photos only for survivors (~75% Google API cost savings).
3. **Final (Post-Photo) Bouncer** — the existing `run-bouncer` edge function, completely unchanged. Now its only job is catching photo-download failures and producing the final `is_servable` verdict.

Each pass writes its own column. Single-writer purity is preserved by design, not by gates. A single migration auto-promotes existing healthy cities (Raleigh, London, etc.) so they don't need re-bouncing.

---

## Scope

1. New schema columns + migration backfill on `place_pool`.
2. New edge function `run-pre-photo-bouncer`.
3. Single `_shared/bouncer.ts` opts flag (`skipStoredPhotoCheck`) — single source of truth for rules.
4. Modified `backfill-place-photos` action-based mode rename + gate change.
5. Retire `handleLegacy` path in `backfill-place-photos` + drop the two RPCs (`get_places_needing_photos`, `count_places_needing_photos`) — Constitutional #8 subtraction; legacy curl is undocumented dead code that would diverge from the new flow.
6. Admin UI: replace single `RunBouncerButton` with three-button sequential component on `SignalLibraryPage.jsx`.
7. Three new invariants registered in `INVARIANT_REGISTRY.md` + one CI gate.
8. Unit + integration tests.

---

## Non-goals

- ❌ Bouncer rule logic changes (B1–B9 bodies). Only the rule-evaluation TRIGGER changes (skip B8 in pre-photo).
- ❌ International market policy (RC-2 / ORCH-0681 territory). Cluster A_COMMERCIAL B4/B5/B6 unchanged.
- ❌ Operational recovery of Lagos + 8 stuck cities (ORCH-0682 territory). This spec does not write curl scripts or run-orders.
- ❌ Auto-enqueue of photo backfill from `admin-seed-places` (HF-3 / future hardening ORCH).
- ❌ Address-parser cleanup for orphan Nigeria rows with `city_id=NULL` (D-3 / separate cleanup).
- ❌ `transformGooglePlaceForSeed` lat/lng `?? 0` fix (D-5 / separate ORCH).
- ❌ Mobile changes — zero impact.
- ❌ `run-bouncer/index.ts` writer changes — `is_servable` single-writer is preserved verbatim.

---

## Assumptions

- Bouncer rules in `_shared/bouncer.ts` are pure (no IO, no side effects). Verified by file read.
- `run-bouncer` is sole writer of `is_servable + bouncer_reason + bouncer_validated_at` on `place_pool`. Verified by codebase grep.
- `place_pool` has no row-count blockers for `ALTER TABLE ADD COLUMN` (Postgres NULL-default ADD is metadata-only on PG 11+; gqnoajqerqhnvulmnyvv is on PG 17). Migration is fast.
- The admin UI is the only consumer of the Bouncer + Photo Backfill edge functions. Mobile does not call either. Verified by grep across `app-mobile/src/`.
- The two RPCs `get_places_needing_photos` + `count_places_needing_photos` have ZERO consumers other than `backfill-place-photos/index.ts` lines 104, 111. Verified by repo grep. Safe to drop.

---

## Architecture (locked)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Edge fn count** | **Two** — new `run-pre-photo-bouncer` + existing `run-bouncer` (unchanged) | Single-writer per column is structurally enforced (impossible to leak via mode parameter). ~80 LOC duplication accepted. |
| **Bouncer opts flag** | `bounce(place: PlaceRow, opts?: { skipStoredPhotoCheck?: boolean }): BouncerVerdict` | Single source of truth for rule logic. Backward-compatible with all existing callers (default behavior unchanged). |
| **Migration backfill** | `is_servable=true` rows auto-promote to `passes_pre_photo_check=true`; everything else stays NULL | Strict superset relationship: passing all rules ⟹ passing all-minus-B8. Preserves cross-city idempotency for Raleigh / London / etc. |
| **Admin UI** | Three always-enabled buttons with status text ("last run: never" / "last run: 14m ago — 1715 pass / 1197 reject") | State-machine enablement breaks on re-seed scenarios. Always-enabled + honest status is more robust. |
| **Mode rename** | `'initial'` → `'pre_photo_passed'`; `'refresh_servable'` unchanged | Self-documenting names that state the gate column. `'pre_photo_passed'` gates on `passes_pre_photo_check=true`; `'refresh_servable'` gates on `is_servable=true`. |
| **Legacy retirement** | DELETE `handleLegacy` route + DROP both RPCs in same migration | Constitutional #8 subtraction. Legacy curl is undocumented, admin-UI-unreachable, would diverge from new flow if kept. Zero non-`backfill-place-photos` consumers verified by grep. |

---

## Per-Layer Specification

### Layer 1: Database

**Migration file:** `supabase/migrations/<next_timestamp>_orch_0678_pre_photo_bouncer.sql` (implementor picks next free timestamp slot).

**Exact SQL:**

```sql
-- ORCH-0678 — Two-Pass Bouncer schema + migration backfill + legacy RPC retirement.
--
-- Adds three columns to place_pool for pre-photo Bouncer verdict, mirroring the
-- existing is_servable / bouncer_reason / bouncer_validated_at shape.
--
-- I-PRE-PHOTO-BOUNCER-SOLE-WRITER: only run-pre-photo-bouncer writes these columns
-- (plus this migration's one-time backfill).
-- I-IS-SERVABLE-SINGLE-WRITER: unchanged — only run-bouncer writes is_servable.

ALTER TABLE place_pool
  ADD COLUMN passes_pre_photo_check BOOLEAN,
  ADD COLUMN pre_photo_bouncer_reason TEXT,
  ADD COLUMN pre_photo_bouncer_validated_at TIMESTAMPTZ;

COMMENT ON COLUMN place_pool.passes_pre_photo_check IS
  'ORCH-0678 — true if place clears all Bouncer rules EXCEPT B8 (stored photos). '
  'Set by run-pre-photo-bouncer. NULL = never pre-bounced. Photo backfill gates on this.';
COMMENT ON COLUMN place_pool.pre_photo_bouncer_reason IS
  'ORCH-0678 — semicolon-joined rejection reasons from pre-photo pass. NULL when passing.';
COMMENT ON COLUMN place_pool.pre_photo_bouncer_validated_at IS
  'ORCH-0678 — timestamp of last pre-photo Bouncer run for this row.';

-- Backfill: existing is_servable=true rows passed the FULL rule set (including B8),
-- which is a strict superset of pre-photo rules. They trivially pass pre-photo.
-- This preserves cross-city idempotency — operators don't need to re-pre-bounce
-- already-healthy cities (Raleigh, London, Washington, Brussels, Baltimore, Cary,
-- Durham, Fort Lauderdale).
UPDATE place_pool
   SET passes_pre_photo_check = true,
       pre_photo_bouncer_reason = NULL,
       pre_photo_bouncer_validated_at = bouncer_validated_at
 WHERE is_servable = true;

-- Index for photo-backfill queries that filter on passes_pre_photo_check + city_id.
-- Partial index keeps it small; only indexes rows that have actually passed.
CREATE INDEX IF NOT EXISTS idx_place_pool_pre_photo_passed
  ON place_pool (city_id, passes_pre_photo_check)
  WHERE passes_pre_photo_check = true;

-- Retire legacy backfill RPCs (HF-1 in investigation; only consumed by the soon-to-be-deleted
-- handleLegacy route in backfill-place-photos). Constitutional #8 subtraction.
DROP FUNCTION IF EXISTS get_places_needing_photos(integer);
DROP FUNCTION IF EXISTS count_places_needing_photos();
```

**RLS:** No new policies needed. `place_pool` RLS is admin-only and the new columns inherit table-level policy.

**Schema invariant:** all three new columns are nullable. NULL means "not yet pre-bounced for this row." After the backfill UPDATE, every row in healthy cities has a non-NULL value; rows in stuck cities (Lagos, Paris, NYC, etc.) have NULL.

---

### Layer 2: Shared library — `_shared/bouncer.ts`

**Exact change:** add `opts` parameter to `bounce()`. The B8 check becomes conditional on `!opts?.skipStoredPhotoCheck`. Every other rule unchanged.

**Diff (target shape):**

```diff
-export function bounce(place: PlaceRow): BouncerVerdict {
+export function bounce(
+  place: PlaceRow,
+  opts?: { skipStoredPhotoCheck?: boolean },
+): BouncerVerdict {
   const cluster = deriveCluster(place.types);
   const reasons: string[] = [];

   // B1 ... B9 unchanged through B7

   // B7: Google photos required (universal — applies to all clusters including Natural)
   if (!hasGooglePhotos(place)) reasons.push('B7:no_google_photos');

-  // B8: stored (downloaded) photos required (universal)
-  if (!hasStoredPhotos(place)) reasons.push('B8:no_stored_photos');
+  // B8: stored (downloaded) photos required (universal in final pass; skipped in
+  // pre-photo pass per ORCH-0678 two-pass design — pre-photo runs B1-B7+B9 only,
+  // so a place can clear pre-photo, get its photos downloaded, then clear final).
+  if (!opts?.skipStoredPhotoCheck && !hasStoredPhotos(place)) {
+    reasons.push('B8:no_stored_photos');
+  }

   // Cluster-specific rules unchanged
   ...
 }
```

**Return contract:** `BouncerVerdict.is_servable` is interpreted by callers:
- Final pass (`bounce(place)`) → caller writes to `place_pool.is_servable`.
- Pre-photo pass (`bounce(place, { skipStoredPhotoCheck: true })`) → caller writes to `place_pool.passes_pre_photo_check`.

The field name `is_servable` in `BouncerVerdict` is local to the verdict object and accurately means "passed the rule set evaluated in this call." Do NOT rename — minimizes blast radius.

**Test coverage required (in `_shared/__tests__/bouncer.test.ts`):**

```ts
Deno.test('bounce({skipStoredPhotoCheck:true}) — clean place with no stored photos passes', () => {
  const place = makePlaceRow({
    types: ['restaurant'], website: 'https://x.com', /* not in SOCIAL_DOMAINS */
    opening_hours: { someKey: 'value' }, photos: [{ name: 'a' }],
    stored_photo_urls: null,  // ← key: no stored photos
    business_status: 'OPERATIONAL', name: 'x', lat: 1, lng: 1,
  });
  const verdict = bounce(place, { skipStoredPhotoCheck: true });
  assertEquals(verdict.is_servable, true);
  assertEquals(verdict.reasons, []);
});

Deno.test('bounce(place) — same place fails B8', () => {
  const place = /* same as above */;
  const verdict = bounce(place);
  assertEquals(verdict.is_servable, false);
  assertEquals(verdict.reasons, ['B8:no_stored_photos']);
});

Deno.test('bounce({skipStoredPhotoCheck:true}) — place with no website still fails B4', () => {
  const place = /* no website, otherwise clean */;
  const verdict = bounce(place, { skipStoredPhotoCheck: true });
  assertEquals(verdict.is_servable, false);
  assertEquals(verdict.reasons, ['B4:no_website']);  // B8 NOT in list
});

Deno.test('bounce({skipStoredPhotoCheck:true}) — B7 still fires (no point queueing zero-photo-metadata rows)', () => {
  const place = /* photos: [], otherwise clean */;
  const verdict = bounce(place, { skipStoredPhotoCheck: true });
  assertEquals(verdict.reasons, ['B7:no_google_photos']);  // B7 in pre-photo too
});
```

---

### Layer 3: New edge function — `supabase/functions/run-pre-photo-bouncer/index.ts`

**Shape:** mirror `run-bouncer/index.ts` exactly. Same request/response contract, same batching, same logging — only differences:

| Aspect | `run-bouncer` (final) | `run-pre-photo-bouncer` (new) |
|--------|----------------------|--------------------------------|
| Calls bouncer with | `bounce(place)` | `bounce(place, { skipStoredPhotoCheck: true })` |
| Writes to columns | `is_servable`, `bouncer_reason`, `bouncer_validated_at` | `passes_pre_photo_check`, `pre_photo_bouncer_reason`, `pre_photo_bouncer_validated_at` |
| Log prefix | `[run-bouncer]` | `[run-pre-photo-bouncer]` |

**Request schema** (identical to run-bouncer):
```ts
{
  city_id?: string;       // UUID; either this or all_cities=true required
  all_cities?: boolean;   // run against every place_pool row
  dry_run?: boolean;      // compute summary; do not write
}
```

**Response schema** (identical shape to run-bouncer):
```ts
{
  success: true,
  pass_count: number,         // count of places that pass pre-photo rules
  reject_count: number,
  written: number,
  by_cluster: Record<Cluster, { pass: number; reject: number }>,
  by_reason: Record<string, number>,  // keyed by reason atom
  duration_ms: number,
}
```

Or on error:
```ts
{ error: string, partial_summary?: BouncerSummary, written?: number }
```

**Auth:** same as `run-bouncer` — service-role-key required; no public access. Inherit from `run-bouncer`'s auth pattern.

**Implementation pattern:** copy `supabase/functions/run-bouncer/index.ts` verbatim into the new directory, then change:
1. The bouncer call: `bounce(place)` → `bounce(place, { skipStoredPhotoCheck: true })`.
2. The UPDATE column names (3 columns).
3. The log prefix.
4. The header comment to reference ORCH-0678 + I-PRE-PHOTO-BOUNCER-SOLE-WRITER.

**Critical:** the new edge fn MUST NOT write `is_servable` under any circumstance. Single-writer enforcement.

---

### Layer 4: Modified `backfill-place-photos/index.ts`

**Change 1 — Drop `handleLegacy` route entirely.**

Lines 36-38 currently:
```ts
if (!body.action) {
  return handleLegacy(supabaseAdmin, body, apiKey);
}
```

Replace with:
```ts
if (!body.action) {
  return json({ error: "Missing 'action'. Use action='preview_run', 'create_run', etc." }, 400);
}
```

Then DELETE the entire `handleLegacy` function (lines 95-164) and any imports it uniquely needed. Constitutional #8 subtraction.

**Change 2 — Mode rename `'initial'` → `'pre_photo_passed'`.**

`parseBackfillMode` at line 177-179:
```diff
-type BackfillMode = 'initial' | 'refresh_servable';
-
-function parseBackfillMode(raw: unknown): BackfillMode {
-  return raw === 'refresh_servable' ? 'refresh_servable' : 'initial';
+type BackfillMode = 'pre_photo_passed' | 'refresh_servable';
+
+function parseBackfillMode(raw: unknown): BackfillMode {
+  // 'pre_photo_passed' is the default — it's the first-pass mode used after a
+  // city is seeded and pre-photo Bouncer has run (writes passes_pre_photo_check=true
+  // for survivors). 'refresh_servable' is for re-downloading photos for already-
+  // is_servable=true places (admin maintenance).
+  return raw === 'refresh_servable' ? 'refresh_servable' : 'pre_photo_passed';
}
```

Update the comment block at lines 174-175:
```diff
-// ORCH-0598.11: I-PHOTO-FILTER-EXPLICIT — exactly two named modes.
-//   'initial'           — first-time city setup; filter ai_approved=true AND no real photos
-//   'refresh_servable'  — Bouncer-approved maintenance; filter is_servable=true (no photo prereq)
+// ORCH-0598.11 + ORCH-0678: I-PHOTO-FILTER-EXPLICIT — exactly two named modes.
+//   'pre_photo_passed'  — first-time city setup AFTER pre-photo Bouncer has run.
+//                         Gate: passes_pre_photo_check=true AND no real photos.
+//                         This is the new-city path post-ORCH-0678.
+//   'refresh_servable'  — admin maintenance for already-final-bouncer-approved places.
+//                         Gate: is_servable=true (regardless of photo state).
+//                         Use case: forcing photo re-download for a healthy city.
```

**Change 3 — Eligibility gate change (lines 240-289 in `buildRunPreview`).**

The `mode === 'initial'` branch currently checks `place.is_servable === true`. Replace with `place.passes_pre_photo_check === true`. The `mode === 'refresh_servable'` branch unchanged (still checks `is_servable === true`).

Specifically:

```diff
   for (const place of places) {
-    // ORCH-0640 ch06: ai_approved replaced by is_servable (Phase-5 retirement per
-    // run-bouncer:7 + DEC-043). Bouncer is the one quality gate.
-    if (place.is_servable === true) analysis.approvedPlaces++;
+    // ORCH-0678 two-pass: 'pre_photo_passed' mode gates on passes_pre_photo_check;
+    // 'refresh_servable' mode keeps the is_servable gate.
+    const passesGate = mode === 'pre_photo_passed'
+      ? place.passes_pre_photo_check === true
+      : place.is_servable === true;
+    if (passesGate) analysis.approvedPlaces++;
     const storedState = getStoredPhotoState(place.stored_photo_urls);

-    if (mode === 'initial') {
+    if (mode === 'pre_photo_passed') {
       // INITIAL: skip places that already have real photos
       if (storedState === 'real') {
         analysis.withRealPhotos++;
         continue;
       }
       analysis.withoutStoredPhotos++;
       if (storedState === 'failed') analysis.failedPlaces++;

-      if (place.is_servable !== true) {
-        analysis.blockedByAiApproval++;  // field name kept for backward compat in report
+      if (place.passes_pre_photo_check !== true) {
+        analysis.blockedByPrePhoto++;
         continue;
       }
     } else {
       // REFRESH_SERVABLE: include all is_servable=true places, regardless of photo state.
       ...
       if (place.is_servable !== true) {
         analysis.blockedByNotServable++;
         continue;
       }
     }
     ...
   }
```

**Change 4 — Update `RunPreviewAnalysis` interface (lines 190-202).**

Rename `blockedByAiApproval` → `blockedByPrePhoto`. Keep `blockedByNotServable`. Subtract obsolete name (Constitutional #8). Update all consumers within the same file.

**Change 5 — `loadCityPlacesForRun` SELECT (line 305).**

Add `passes_pre_photo_check` to the column list:
```diff
-      .select('id, google_place_id, photos, stored_photo_urls, is_servable')
+      .select('id, google_place_id, photos, stored_photo_urls, is_servable, passes_pre_photo_check')
```

Also update the `CityPlaceRow` interface at line 181-188 — note the duplicated `is_servable` field at lines 186-187 is a pre-existing typo; fix it as a ride-along (Constitutional #8). Add `passes_pre_photo_check?: boolean | null`.

**Change 6 — `processBatch` per-row gate (line 642-649).**

Currently:
```ts
const { data: place } = await db
  .from('place_pool')
  .select('id, google_place_id, photos, stored_photo_urls')
  .eq('id', placeId)
  .eq('is_active', true)
  .eq('is_servable', true)  // ← THIS IS THE BUG
  .maybeSingle();
```

The processBatch function does not currently know which mode it's running under. **It must be made mode-aware.** Two options:

- (a) Pass `mode` from the run row (looked up from `photo_backfill_runs.mode`) into `processBatch` as a parameter.
- (b) Always read both gate columns and apply the right one.

**Choose (a)** for clarity: change `processBatch(db, batch, apiKey)` to `processBatch(db, batch, apiKey, mode)`. The runner-level handlers (`handleRunNextBatch`, `handleRetryBatch`) read `run.mode` from the DB row and pass it through. Inside processBatch:

```ts
const gateColumn = mode === 'pre_photo_passed' ? 'passes_pre_photo_check' : 'is_servable';
const { data: place } = await db
  .from('place_pool')
  .select('id, google_place_id, photos, stored_photo_urls')
  .eq('id', placeId)
  .eq('is_active', true)
  .eq(gateColumn, true)
  .maybeSingle();
```

**Change 7 — Empty-result clarity (Constitutional #3).**

`handleCreateRun` currently returns `{ status: 'nothing_to_do', totalPlaces: 0, analysis }` when no eligible places. After the gate change, this can fire for two genuinely different reasons in `pre_photo_passed` mode:

1. Pre-photo Bouncer hasn't been run yet for this city (every row has `passes_pre_photo_check=NULL`).
2. Pre-photo Bouncer ran but rejected everything.

Distinguish in the response:
```ts
const allNullPrePhoto = analysis.totalPlaces > 0 && analysis.approvedPlaces === 0
  && places.every(p => p.passes_pre_photo_check === null);
return json({
  status: 'nothing_to_do',
  totalPlaces: 0,
  analysis,
  reason: allNullPrePhoto
    ? 'Run pre-photo Bouncer for this city first — no rows have been pre-bounced yet'
    : 'No pre-photo-passing rows lack stored photos in this city',
});
```

This lets the admin UI show a clear next-step prompt instead of a confusing silent zero.

---

### Layer 5: `run-bouncer/index.ts` — UNCHANGED

Verify no diff. The Final Bouncer keeps writing `is_servable` + `bouncer_reason` + `bouncer_validated_at` exactly as today. Its only behavioral difference from before is that it now operates after pre-photo Bouncer + photo backfill have run, so most of its B8 rejections will have already been pre-rejected — the small remaining set is photo-download failures.

---

### Layer 6: Admin UI — `mingla-admin/src/pages/SignalLibraryPage.jsx`

**Replace** the existing `RunBouncerButton` component (currently at lines 128-180) with a new `BouncerPipelineButtons` component that renders three sequential buttons. The single Bouncer-run section at lines 864-873 is updated to render `<BouncerPipelineButtons cityId={...} cityName={...} onComplete={...} />` instead of `<RunBouncerButton ... />`.

**`BouncerPipelineButtons` component contract:**

```jsx
function BouncerPipelineButtons({ cityId, cityName, onComplete }) {
  // Each button has its own running state + lastResult state.
  // All three are always enabled when cityId is set.
  // Status text shows last-run summary per button.

  return (
    <div className="flex flex-col gap-3">
      <PipelineStep
        step={1}
        label="Pre-Photo Bouncer"
        edgeFnName="run-pre-photo-bouncer"
        helpText="Weeds out places that lack websites, hours, valid types, or google photo metadata. Run this FIRST after seeding."
        cityId={cityId}
        cityName={cityName}
      />
      <PipelineStep
        step={2}
        label="Photo Backfill"
        edgeFnName="backfill-place-photos"
        edgeFnPayload={{ action: 'create_run', cityId, city, country, mode: 'pre_photo_passed' }}
        helpText="Downloads photos from Google for places that survived the pre-photo Bouncer."
        cityId={cityId}
        cityName={cityName}
      />
      <PipelineStep
        step={3}
        label="Final Bouncer"
        edgeFnName="run-bouncer"
        helpText="Sets is_servable. Catches photo-download failures."
        cityId={cityId}
        cityName={cityName}
        onComplete={onComplete}
      />
    </div>
  );
}
```

**`PipelineStep` sub-component:** wraps a single button with running state, result display (cluster + reason breakdown for Bouncer steps; success/fail counts for backfill step), and last-run timestamp. Reuse the existing `lastResult` rendering shape from `RunBouncerButton` for steps 1 and 3.

**State display:** each button shows below it either:
- "Last run: never"
- "Last run: 14m ago — 1715 pass / 1197 reject (cluster A=820/591 B=140/63 C=755/3 X=540)" (for Bouncer steps)
- "Last run: 8m ago — 1039 succeeded / 12 failed / 0 skipped" (for backfill step)

**Step 2 (Photo Backfill) UX detail:** unlike Bouncer steps which run synchronously (the edge fn does it all), photo backfill creates a run + processes batches via repeated `run_next_batch` calls. The button kicks off `create_run` then loops `run_next_batch` until `done: true`. Show progress as it ticks ("batch 14 of 26: 132 succeeded so far"). This pattern likely already exists somewhere in the admin codebase for the legacy backfill UI — search for it and reuse.

**Auth and error handling:** identical to existing `RunBouncerButton` (uses `invokeWithRefresh`, `useToast`, error toasts on failure).

**On step 3 success → fire `onComplete?.(data)` so the parent page refreshes its city stats (existing pattern).**

---

### Layer 7: Tests

**Unit tests** — `supabase/functions/_shared/__tests__/bouncer.test.ts`:
- `bounce(place, {skipStoredPhotoCheck:true})` — clean place with no stored photos → `is_servable=true`, `reasons=[]`.
- `bounce(place)` — same place → `is_servable=false`, `reasons=['B8:no_stored_photos']`.
- `bounce(place, {skipStoredPhotoCheck:true})` — Cluster A place with no website → fails B4 (B8 NOT in reasons).
- `bounce(place, {skipStoredPhotoCheck:true})` — place with photos=[] → fails B7 (B7 still fires in pre-photo).
- `bounce(place, {skipStoredPhotoCheck:true})` — excluded type → still B1 short-circuits identically.
- Parity test: for 50 randomized places, `bounce(p)` and `bounce(p, {skipStoredPhotoCheck:true})` differ ONLY by presence of `B8:no_stored_photos` in reasons.

**Edge function smoke** — manual or via deno test against dev DB:
- POST `/run-pre-photo-bouncer` with `dry_run: true, city_id: '<lagos>'` → returns summary with by_reason hash; no DB writes.
- POST `/run-pre-photo-bouncer` with `city_id: '<lagos>'` (no dry_run) → writes `passes_pre_photo_check` for all Lagos rows; pass count ≈ 1039.

**Integration / live-fire** (post-deploy):
- T-04 in test table below: full Lagos pipeline.
- T-08 in test table below: Raleigh regression — `is_servable=true` count unchanged ± 3.

**Migration backfill verification:**
```sql
-- Pre-migration:
SELECT count(*) FROM place_pool WHERE is_servable = true;
-- Post-migration:
SELECT count(*) FROM place_pool WHERE is_servable = true AND passes_pre_photo_check = true;
-- Must equal pre-migration count exactly.
```

**Single-writer enforcement (static):**
```bash
# Must return ZERO hits outside run-pre-photo-bouncer + the migration:
grep -rn 'passes_pre_photo_check' supabase/functions/ | grep -v 'run-pre-photo-bouncer/'
# Must return ZERO hits outside run-bouncer + the migration:
grep -rn '\.update.*\bis_servable\b' supabase/functions/ | grep -v 'run-bouncer/'
```

CI gate this in `scripts/ci-check-invariants.sh` — see Regression Prevention.

---

## Success Criteria

| # | Criterion | How to verify |
|---|-----------|---------------|
| **SC-1** | Migration adds 3 nullable columns + index + drops 2 RPCs without error | `supabase db push` succeeds; `\d place_pool` shows new columns; `pg_proc` no longer lists the dropped RPCs |
| **SC-2** | Migration backfill: every existing `is_servable=true` row also has `passes_pre_photo_check=true` post-migration | SQL count comparison (pre vs post) is exactly equal |
| **SC-3** | `bounce(place, {skipStoredPhotoCheck:true})` returns identical verdict to `bounce(place)` for every rule except B8 | 6 unit tests in `bouncer.test.ts` |
| **SC-4** | New edge fn `run-pre-photo-bouncer` writes ONLY the three pre-photo columns; never `is_servable` | Code review + grep gate |
| **SC-5** | `run-bouncer/index.ts` is byte-identical to pre-spec state | `git diff supabase/functions/run-bouncer/index.ts` shows zero hunks |
| **SC-6** | `backfill-place-photos` mode `'pre_photo_passed'` gates eligibility on `passes_pre_photo_check=true`, NOT on `is_servable` | Code review at lines 240-289 + 642-649 |
| **SC-7** | `backfill-place-photos` mode `'refresh_servable'` continues to gate on `is_servable=true` | Code review same lines |
| **SC-8** | `handleLegacy` route deleted; `POST /backfill-place-photos {batchSize: N}` (no `action`) returns HTTP 400 with clear message | curl test |
| **SC-9** | Two RPCs `get_places_needing_photos` + `count_places_needing_photos` no longer exist in DB | `SELECT proname FROM pg_proc WHERE proname IN (...)` returns zero rows |
| **SC-10** | Admin UI shows three buttons sequentially with always-enabled state and per-button last-run status text | Manual visual check on `SignalLibraryPage` |
| **SC-11** | Live-fire on Lagos: pre-photo Bouncer pass count = 1039 ± 5 (matches forensics projection of 1039 rows whose only rejection was B8) | SQL count after `run-pre-photo-bouncer` |
| **SC-12** | Live-fire on Lagos: photo backfill in `pre_photo_passed` mode downloads photos for ~1039 places (not 4222) | Run summary `total_succeeded` |
| **SC-13** | Live-fire on Lagos: final Bouncer post-backfill produces `is_servable=true` count ≈ pre-photo pass count minus photo download failures | SQL count after `run-bouncer` |
| **SC-14** | Regression: live-fire on Raleigh — `is_servable=true` count unchanged ± 3 from pre-spec baseline | SQL count comparison |
| **SC-15** | Three new invariants registered in INVARIANT_REGISTRY.md with descriptions + verification steps | File diff |
| **SC-16** | CI gate `scripts/ci-check-invariants.sh` enforces I-PRE-PHOTO-BOUNCER-SOLE-WRITER + I-PHOTO-DOWNLOAD-GATES-ON-PRE-PHOTO + I-TWO-PASS-BOUNCER-RULE-PARITY | CI run + negative-control test |
| **SC-17** | Cost gate: photo backfill on Lagos costs ≈ $36 (1039 × $0.035), not $148 (4222 × $0.035) — 75% savings | `actual_cost_usd` from photo backfill run summary |

---

## Invariants

### Preserved (verified-not-broken)

| Invariant | How preserved |
|-----------|--------------|
| **I-BOUNCER-DETERMINISTIC (ORCH-0588)** | Rule body in `_shared/bouncer.ts` unchanged; new `opts` flag is a deterministic switch. Both passes are pure functions of input. |
| **I-IS-SERVABLE-SINGLE-WRITER** | `run-bouncer` remains sole writer of `is_servable`. The new edge fn never touches that column. |
| **I-PHOTO-FILTER-EXPLICIT (ORCH-0598.11)** | Modes still exactly two and named after their gate column. Stronger than before — names are self-documenting. |
| **I-THREE-GATE-SERVING (ORCH-0598.11)** | Final Bouncer still sets `is_servable`, signal RPCs still gate on it. The pre-photo column is upstream of the three-gate serving path; consumers don't read it. |

### New (registered in INVARIANT_REGISTRY.md)

**I-PRE-PHOTO-BOUNCER-SOLE-WRITER**
- **Statement:** Only `supabase/functions/run-pre-photo-bouncer/index.ts` writes to `place_pool.passes_pre_photo_check`, `place_pool.pre_photo_bouncer_reason`, and `place_pool.pre_photo_bouncer_validated_at`. The one-time backfill in the ORCH-0678 migration is the only other writer (and it runs exactly once).
- **Verification:** CI gate greps for `passes_pre_photo_check` writes outside the new edge fn. Negative-control: introduce a synthetic write in another file → CI fails + names file path.
- **Why:** Constitutional #2 (one owner per truth). If a second writer appears, the column's correctness drifts from the deterministic rule logic.

**I-PHOTO-DOWNLOAD-GATES-ON-PRE-PHOTO**
- **Statement:** `backfill-place-photos` action-based modes gate eligibility on `passes_pre_photo_check=true` (mode `'pre_photo_passed'`) or `is_servable=true` (mode `'refresh_servable'`). NEVER on raw `is_servable IS NULL` or any other ad-hoc predicate. The legacy non-action route is forbidden — POSTing without an `action` field returns HTTP 400.
- **Verification:** code review at gate sites + grep for `is_servable` in `backfill-place-photos/index.ts` (must only appear in the `'refresh_servable'` branch).
- **Why:** prevents recurrence of the ORCH-0640 ch06 deadlock. The gate column must be one that's set BEFORE photos exist.

**I-TWO-PASS-BOUNCER-RULE-PARITY**
- **Statement:** The rule body in `_shared/bouncer.ts` is the single source of truth for both Bouncer passes. The only difference between `bounce(place)` and `bounce(place, { skipStoredPhotoCheck: true })` is whether B8 (`B8:no_stored_photos`) appears in `reasons`. No other rule may differ between passes.
- **Verification:** unit test asserts that for 50 randomized places, the two verdicts differ only by presence/absence of B8 in `reasons`. CI gate: grep for hand-rolled rule duplication outside `_shared/bouncer.ts`.
- **Why:** prevents rule drift. If pre-photo and final ever diverge in any other rule, places could pass pre-photo + photo-download but fail final for a NEW reason — silent breakage.

---

## Test Cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 | Migration applies cleanly | `supabase db push` | New columns exist; 2 RPCs dropped; index created | DB |
| T-02 | Migration backfill | Pre-state: `n` rows with `is_servable=true` | Post-state: same `n` rows have `passes_pre_photo_check=true` | DB |
| T-03 | Pre-photo unit parity | 50 randomized PlaceRows | `bounce(p)` and `bounce(p, {skipStoredPhotoCheck:true})` differ only by B8 | Unit |
| T-04 | Lagos full pipeline | Step 1: pre-photo Bouncer; Step 2: backfill `pre_photo_passed`; Step 3: final Bouncer | Pre-photo pass ≈ 1039; backfill downloads ~1039 photos; final servable ≈ 1039 minus DL failures | E2E live-fire |
| T-05 | Pre-photo Bouncer dry_run | `{ dry_run: true, city_id: '<lagos>' }` | Returns summary; zero DB writes | Edge fn |
| T-06 | Pre-photo Bouncer idempotency | Run twice on same city | Pass/reject counts identical ± 0 | Edge fn |
| T-07 | Backfill mode `'pre_photo_passed'` gate | Place with `passes_pre_photo_check=NULL`, `is_servable=NULL` | Excluded from preview; counted as `blockedByPrePhoto` | Edge fn |
| T-08 | Raleigh regression | Run all three steps on Raleigh | Final `is_servable=true` count = 1715 ± 3 (pre-spec baseline) | E2E live-fire |
| T-09 | Backfill `'refresh_servable'` gate unchanged | `is_servable=true` row, photos populated | Picked up; processBatch runs | Edge fn |
| T-10 | Empty-result clarity | Photo backfill on Lagos BEFORE pre-photo Bouncer runs | Returns `nothing_to_do` with `reason: 'Run pre-photo Bouncer for this city first…'` | Edge fn |
| T-11 | Legacy curl deprecation | `POST /backfill-place-photos {batchSize: 50}` (no action) | HTTP 400 with clear error message | Edge fn |
| T-12 | Final Bouncer untouched | `git diff supabase/functions/run-bouncer/index.ts` | Zero hunks | Static |
| T-13 | Single-writer grep — pre-photo | `grep -rn passes_pre_photo_check supabase/functions/` excluding `run-pre-photo-bouncer/` and migrations | Zero hits | Static / CI |
| T-14 | Single-writer grep — is_servable | `grep -rn '\.update.*\bis_servable\b' supabase/functions/` excluding `run-bouncer/` | Zero hits | Static / CI |
| T-15 | Admin UI three buttons render | Visit SignalLibraryPage with a city selected | Three buttons visible with status text under each | UI |
| T-16 | Admin UI runs each step | Click Pre-Photo → Backfill → Final, sequentially | Each completes; status text updates | UI E2E |
| T-17 | Cost gate | Lagos backfill `actual_cost_usd` post-run | ≤ $40 (vs naive ~$148) | Live-fire |
| T-18 | CI gate negative-control | Introduce synthetic `passes_pre_photo_check` write in `discover-cards/index.ts` | CI fails + names file path; revert restores green | CI |

---

## Implementation Order

1. **Migration** — create `supabase/migrations/<timestamp>_orch_0678_pre_photo_bouncer.sql` with the SQL in §Layer 1. Run `supabase db push` against dev branch first. Verify SC-1 + SC-2 + T-01 + T-02 pass.
2. **`_shared/bouncer.ts` opts flag** — add `opts` parameter; update B8 conditional. Run unit tests (`deno test _shared/__tests__/bouncer.test.ts`). Verify SC-3 + T-03 pass.
3. **New edge function** `supabase/functions/run-pre-photo-bouncer/index.ts` — copy run-bouncer pattern; swap in `bounce(place, {skipStoredPhotoCheck:true})`; swap column writes. Local Deno smoke test. Deploy to dev branch.
4. **Modified `backfill-place-photos`** — apply Changes 1-7 from §Layer 4. Local TS check. Deploy to dev branch.
5. **`run-bouncer` verification** — `git diff` confirms zero changes (T-12).
6. **CI gates** — add three new gates to `scripts/ci-check-invariants.sh` (one per new invariant).
7. **INVARIANT_REGISTRY.md** — register three new invariants with verification steps.
8. **Admin UI** — replace `RunBouncerButton` with `BouncerPipelineButtons` + `PipelineStep`. Visual smoke in dev.
9. **Live-fire dev branch** — run T-04 (Lagos) end-to-end. Capture exact pass counts. Compare to forensics projection (1039 ± 5).
10. **Regression check** — run T-08 (Raleigh) end-to-end. Confirm `is_servable=true` count within ±3 of baseline.
11. **Production push** — apply migration on prod; deploy edge fns; ship admin commit.
12. **Production live-fire** — repeat T-04 + T-08 on prod. Capture report.

---

## Regression Prevention

1. **CI gate I-PRE-PHOTO-BOUNCER-SOLE-WRITER** in `scripts/ci-check-invariants.sh`:
   ```bash
   echo "[invariant] I-PRE-PHOTO-BOUNCER-SOLE-WRITER"
   leaks=$(grep -rln 'passes_pre_photo_check' supabase/functions/ \
     | grep -v 'supabase/functions/run-pre-photo-bouncer/' \
     | grep -v 'supabase/functions/_shared/' || true)
   if [ -n "$leaks" ]; then
     echo "FAIL: passes_pre_photo_check written outside run-pre-photo-bouncer:"
     echo "$leaks"
     exit 1
   fi
   ```

2. **CI gate I-PHOTO-DOWNLOAD-GATES-ON-PRE-PHOTO** — assert `backfill-place-photos/index.ts` references `passes_pre_photo_check` exactly N times (where N is the expected count after the spec ships) and ZERO references to `is_servable` outside the `refresh_servable` branch:
   ```bash
   echo "[invariant] I-PHOTO-DOWNLOAD-GATES-ON-PRE-PHOTO"
   bad=$(grep -n 'is_servable' supabase/functions/backfill-place-photos/index.ts \
     | grep -v 'refresh_servable' | grep -v '^[[:space:]]*//' || true)
   if [ -n "$bad" ]; then
     echo "FAIL: is_servable referenced outside refresh_servable branch:"
     echo "$bad"
     exit 1
   fi
   ```

3. **CI gate I-TWO-PASS-BOUNCER-RULE-PARITY** — assert the bouncer rule body exists in exactly one place:
   ```bash
   echo "[invariant] I-TWO-PASS-BOUNCER-RULE-PARITY"
   # Bouncer rule keywords should ONLY appear in _shared/bouncer.ts
   leaks=$(grep -rln "B8:no_stored_photos\\|B7:no_google_photos\\|B5:social_only" supabase/functions/ \
     | grep -v '_shared/bouncer.ts' \
     | grep -v '_shared/__tests__/' \
     | grep -v 'run-bouncer/' \
     | grep -v 'run-pre-photo-bouncer/' \
     | grep -v 'backfill-place-photos/' || true)
   if [ -n "$leaks" ]; then
     echo "FAIL: Bouncer rule strings appear outside the canonical files"
     echo "$leaks"
     exit 1
   fi
   ```

4. **Protective comment** at top of `_shared/bouncer.ts` (existing comment block, extend it):
   ```ts
   // ORCH-0588 Slice 1 — Bouncer v2 pure logic.
   // ORCH-0678 — extended with opts.skipStoredPhotoCheck for two-pass design.
   //
   // Imported by:
   //   - run-bouncer/index.ts          → calls bounce(place); writes is_servable
   //   - run-pre-photo-bouncer/index.ts → calls bounce(place, {skipStoredPhotoCheck:true});
   //                                       writes passes_pre_photo_check
   //
   // I-TWO-PASS-BOUNCER-RULE-PARITY: rule body must remain identical across both passes.
   // The skipStoredPhotoCheck flag is the ONLY allowed difference. Adding any other
   // pass-specific branch is a violation — file a new ORCH instead.
   ```

5. **Protective comment** at top of `run-bouncer/index.ts` and the new `run-pre-photo-bouncer/index.ts`:
   ```ts
   // [CRITICAL — ORCH-0678 + Constitutional #2] This function is the SOLE writer of
   // {is_servable | passes_pre_photo_check} for the place_pool table. NEVER add an
   // is_servable / passes_pre_photo_check write anywhere else in the codebase.
   // CI gate I-{IS-SERVABLE | PRE-PHOTO-BOUNCER}-SOLE-WRITER enforces this.
   ```

---

## Cost Analysis

**Naive flow (current pre-fix behavior on a freshly-seeded city):**
- Photo backfill runs against ALL `is_active=true AND photos populated AND stored_photo_urls IS NULL` rows.
- Lagos: 4,222 places × $0.035/place = **$147.77** Google photo API spend.
- Of those 4,222, only ~1,039 (24.6%) would ever pass full Bouncer rules. The other 3,183 photos are wasted spend.

**Two-pass flow (this spec):**
- Pre-photo Bouncer rejects 3,183 places upfront (no API call cost — pure rule evaluation).
- Photo backfill runs only on 1,039 survivors × $0.035 = **$36.37**.
- **Savings: $111.40 per Lagos-class city = 75.4%.**

**Multiplied across ORCH-0682's 9-city recovery wave:**
- Naive total: 4222 + 7476 + 5720 + 5686 + 4040 + 3599 + 3469 + 2541 + 6100 = ~42,853 places × $0.035 = **$1,499**.
- Two-pass projected total (assuming similar 25% survival rates for non-US markets and 50%+ for US/EU): **~$400-600**.
- **Savings: ~$900-1,100.**

(Lagos-specific projection is high-confidence per investigation. Other-city projections assume similar rule-fail distributions; tighten after first city is recovered.)

---

## Commit Message Templates

Two commits — DB+backend separate from admin UI for safe rollback granularity. No `Co-Authored-By` lines per memory rule.

**Commit 1 (DB + backend):**
```
feat(bouncer): ORCH-0678 — two-pass Bouncer (pre-photo + final)

Adds Pre-Photo Bouncer pass that runs all rules except B8 (stored photos).
Photo backfill now gates on the new passes_pre_photo_check column instead
of the broken is_servable gate that was added by ORCH-0640 ch06 and created
the deadlock proven by ORCH-0678 forensics.

Schema (new migration):
- ALTER place_pool ADD passes_pre_photo_check + pre_photo_bouncer_reason
  + pre_photo_bouncer_validated_at (all nullable)
- Backfill: existing is_servable=true rows auto-promote to passes_pre_photo_check=true
- Partial index on (city_id, passes_pre_photo_check) WHERE true
- DROP RPCs get_places_needing_photos + count_places_needing_photos (legacy)

Code:
- _shared/bouncer.ts: bounce() gains optional { skipStoredPhotoCheck } flag.
  Single source of truth for rule logic; pre-photo and final use the same body.
- NEW supabase/functions/run-pre-photo-bouncer/: writes passes_pre_photo_check
  + pre_photo_bouncer_reason + pre_photo_bouncer_validated_at. Mirrors run-bouncer
  shape exactly.
- backfill-place-photos: mode 'initial' renamed to 'pre_photo_passed' and gate
  switched from is_servable to passes_pre_photo_check. mode 'refresh_servable'
  unchanged. handleLegacy route deleted.
- run-bouncer: byte-unchanged.

Invariants (3 new):
- I-PRE-PHOTO-BOUNCER-SOLE-WRITER
- I-PHOTO-DOWNLOAD-GATES-ON-PRE-PHOTO
- I-TWO-PASS-BOUNCER-RULE-PARITY

CI gates added in scripts/ci-check-invariants.sh.

Cost win: ~75% Google photo API savings on freshly-seeded cities (Lagos:
$148 → $36) because photos download only for places that survive pre-photo
rules.

Closes ORCH-0678 RC-1.
```

**Commit 2 (admin UI):**
```
feat(admin): ORCH-0678 — three-button BouncerPipelineButtons replaces single Bouncer

SignalLibraryPage now renders three sequential always-enabled buttons:
1. Pre-Photo Bouncer
2. Photo Backfill
3. Final Bouncer

Each shows last-run timestamp + summary. Operators see the pipeline state
directly instead of guessing which step needs running.

Closes ORCH-0678 RC-1 admin UI.
```

---

## Rollback Plan

If post-deploy live-fire fails or produces unexpected pass-rate deltas:

1. **Revert commits** in order: admin UI commit, then backend commit.
2. **Drop new columns** (data loss is acceptable — they're recomputable):
   ```sql
   ALTER TABLE place_pool
     DROP COLUMN passes_pre_photo_check,
     DROP COLUMN pre_photo_bouncer_reason,
     DROP COLUMN pre_photo_bouncer_validated_at;
   DROP INDEX IF EXISTS idx_place_pool_pre_photo_passed;
   ```
3. **Recreate dropped RPCs** from `pg_proc.prosrc` text captured in the investigation report (§Phase 3 Schema layer):
   ```sql
   CREATE OR REPLACE FUNCTION get_places_needing_photos(p_batch_size integer)
   RETURNS TABLE (id uuid, google_place_id text, photos jsonb)
   LANGUAGE sql STABLE AS $$
     SELECT pp.id, pp.google_place_id, pp.photos
     FROM place_pool pp
     WHERE pp.is_active = true
       AND pp.photos IS NOT NULL
       AND jsonb_array_length(pp.photos) > 0
       AND pp.stored_photo_urls IS NULL
     ORDER BY pp.created_at ASC LIMIT p_batch_size;
   $$;
   CREATE OR REPLACE FUNCTION count_places_needing_photos()
   RETURNS bigint
   LANGUAGE sql STABLE AS $$
     SELECT COUNT(*)
     FROM place_pool
     WHERE is_active = true
       AND photos IS NOT NULL
       AND jsonb_array_length(photos) > 0
       AND stored_photo_urls IS NULL;
   $$;
   ```
4. **Redeploy old `backfill-place-photos`** (revert commit auto-restores `handleLegacy` and the `'initial'` mode name).
5. **Lagos remains stuck** — the original deadlock is back. Operators must use the legacy curl path until a v2 fix ships.

The new `run-pre-photo-bouncer` edge fn is a new directory and trivially deletable; no rollback impact.

---

## Discoveries for Orchestrator

None new — this spec was scope-locked by the dispatch. All open discoveries (D-3 orphan Nigeria rows, D-5 lat/lng `?? 0`, HF-3 auto-enqueue post-seed) remain as separate ORCHs per the dispatch's explicit forbiddens.

One observation worth noting (no action required from this spec): the existing `CityPlaceRow` interface in `backfill-place-photos/index.ts:181-188` has a duplicated `is_servable` field at lines 186-187 — pre-existing typo. This spec fixes it as a ride-along when adding `passes_pre_photo_check` to the same interface. No new ORCH needed.

---

## After implementation

Implementor delivers:
- One commit covering DB migration + edge fn + shared lib + CI gate + invariants + admin UI + tests (or two-commit split per templates above).
- Live-fire results captured in the implementation report (T-04 + T-08 numerical results, plus T-17 cost gate confirmation).

Tester verifies:
- All 18 test cases.
- Invariant CI gates fire correctly + pass on the new code.
- Lagos pipeline produces predicted ~1039 servable count.
- Raleigh regression check unchanged ± 3.

On PASS → orchestrator CLOSE protocol → ORCH-0678 closes Grade A, ORCH-0681 + ORCH-0682 remain queued for separate decisions.
