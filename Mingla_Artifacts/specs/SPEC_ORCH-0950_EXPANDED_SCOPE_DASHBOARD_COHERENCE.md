# SPEC — ORCH-0950 [Trip capacity + dashboard coherence — EXPANDED SCOPE]

**Spec author:** Claude `mingla-forensics` (SPEC mode)
**Date:** 2026-05-24
**Working tree:** `~/Desktop/mingla-orchs/ORCH-0950-[trip-capacity-single-source]/` on branch `ORCH-0950-trip-capacity-single-source`
**Supersedes:** `Mingla_Artifacts/specs/SPEC_ORCH-0950_TRIP_CAPACITY_SINGLE_SOURCE.md` (original scope)
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0950_EXPANDED_SCOPE_DASHBOARD_COHERENCE.md`
**Operator directive:** "we expanded the scope so we investigate deeply, spec and fix … no assumptions about what is fixed, we bundle everything expanded into one tight pass and fix it all" (2026-05-24)

---

## 1. Goal (plain English)

Three structural problems live behind the dashboard symptoms:

1. The edit RPC's JSONB merge wipes sibling keys on every partial business_trip edit.
2. Trip dates and destination read from a JSONB blob instead of canonical columns.
3. Per-tier sold counts and tier-card capacity readers haven't been canonicalized the way ORCH-0947 [Trip dashboard Spots tile counts tickets, not orders] canonicalized the Spots tile.

Ship one bundled fix that: (a) moves trip capacity, dates, and destination into canonical SQL columns (the JSONB `business_trip` blob becomes write-frozen except for fields nothing reads), (b) reroutes dashboard readers (Spots tile, hero subtitle, lifecycle status, tier card) to the canonical columns + ORCH-0947's `biz_trip_tickets_sold` RPC, (c) recovers DC Adventure's destination via operator re-entry, and (d) lands one CI gate forbidding both the dual-source pattern and the `theme || (p_patch->'theme')` shallow-merge pattern in trip RPCs.

---

## 2. Scope and Non-Goals

### Scope
- New canonical columns on `events` for trip dates (`event_dates.start_at/end_at` already exists — use it; no new column) and destination (`events.destination_text` NEW).
- Backfill from `theme.business_trip` JSONB where data still present; document data-loss recovery for already-wiped rows.
- `biz_update_live_trip` rewrite: deep-merge protection for any residual `business_trip` keys (defensive); writes destination + dates to canonical columns; strips the corresponding JSONB keys from inbound patch.
- `business_publish_trip_draft` rewrite: writes destination + dates to canonical columns at publish time; strips JSONB capacity/dates/destination from the persisted theme.
- Service-layer `readBusinessTrip` + `mapTrip` rewrites: source capacity, dates, destination from canonical columns via join.
- Dashboard render readers updated: hero subtitle, Spots tile (already done by ORCH-0947 on main; rebase brings it in), lifecycle status, tier card capacity all canonical-sourced.
- Per-tier sold count canonicalized via new `biz_trip_tickets_sold_by_tier` RPC (mirror of ORCH-0947's `biz_trip_tickets_sold` but grouped by `ticket_type_id`).
- Tier-card "remaining" computed inside `EventDetailTicketTypeRow` from `capacity - soldCount` (D-2 fold).
- Strict-grep gate expansion + ORCH-0840 regression-test pair (happy-path: partial-patch preserves siblings; adversarial: dashboard reads canonical column even when JSONB blob is empty).
- DC Adventure destination re-entry runbook for operator.

### Non-goals
- ORCH-0960 [Stripe `account_invalid` on hosted-session create] — external, separate ORCH.
- ORCH-0946 [Buyer-web sold-out gate `quantityTotal` mismap] — buyer-web side; this SPEC only touches the planner-side mirror.
- Event-side (`event_type = 'event'`) capacity/dates/destination — only trip events.
- Multi-tier trip support — assumes 1:1 trip ↔ pricing_tier ↔ ticket_type per the original ORCH-0950 SPEC.
- Rewriting `business_publish_trip_draft` validation logic beyond the field-source change.
- Removing the `business_trip` JSONB key entirely — keep for forward-compat / future fields, but read-only and write-frozen for capacity/dates/destination.

### Assumptions (verify at IMPLEMENT)
- Branch will be rebased on `main` before implementor work begins, bringing in ORCH-0947's Spots tile change and ORCH-0948's waitlist work.
- Every published trip has exactly one pricing tier (already asserted by the prior ORCH-0950 migration's pre-flight probe).
- `event_dates` table already populated correctly for all published trips (truth confirmed for DC Adventure; spec adds a verification probe for all rows).

---

## 3. Cross-Surface Impact Declaration

| Surface | In scope? | User-visible behaviour | Files touched |
|---|---|---|---|
| **Business iOS** | YES | Trip dashboard: Spots tile shows `tickets_sold / canonical_capacity`; hero subtitle shows real dates + destination; lifecycle status pill correct; tier card shows `sold / canonical_capacity` with accurate sold count | `mingla-business/app/trip/[id]/index.tsx`, `mingla-business/src/services/tripsService.ts`, `mingla-business/src/components/event/EventDetailTicketTypeRow.tsx`, `mingla-business/src/components/trip/EditPublishedTripScreen.tsx`, `mingla-business/src/components/trip/TripCreatorWizard.tsx`, `mingla-business/src/hooks/useTrips.ts` |
| **Business Android** | YES | Same as iOS | Same (shared RN code) |
| **Business Web preview** | YES | Same as iOS | Same (shared RN code) |
| **Buyer-anonymous Web** | NO direct change | Checkout RPC already canonical on capacity (ORCH-0950 v1 unchanged); destination/dates plumbing into buyer-web is separate | (unchanged) |
| **Backend (Postgres)** | YES | New column `events.destination_text`; rewrites of `biz_update_live_trip`, `business_publish_trip_draft`; new `biz_trip_tickets_sold_by_tier` RPC | `supabase/migrations/20260725000002_orch_0950_expanded_scope_dashboard_coherence.sql` (NEW; timestamp bump for ordering after ORCH-0947's `20260725000001`) |
| Consumer iOS / Consumer Android | NO | Consumer app does not edit business trips |
| Admin Web | NO | No trip dashboard in admin |

Parity automatic across all three business RN surfaces. Single success criterion per fix item (no per-surface split).

---

## 4. Schema changes

### 4.1 Migration filename + ordering

`supabase/migrations/20260725000002_orch_0950_expanded_scope_dashboard_coherence.sql`

Comes AFTER ORCH-0947's `20260725000001_orch_0947_biz_trip_tickets_sold.sql` (already on remote). Implementor MUST verify timestamp availability before bumping — per the `feedback_orchestrator_removes_registry_row_in_close_commit.md` + ORCH-0957 [spawn.sh migration-timestamp collision] sibling-worktree scan rule.

### 4.2 New column

```sql
ALTER TABLE public.events
  ADD COLUMN destination_text text;

COMMENT ON COLUMN public.events.destination_text IS
  'Trip destination text (e.g. "Washington DC, USA"). Canonical post-ORCH-0950-expanded. For event_type=event rows this is NULL. Replaces events.theme.business_trip.destinationLocationText.';
```

(Destination lat/lng/placeId stay in JSONB for now — they are read-only metadata not surfaced in any current reader path; they can migrate to columns in a follow-up if needed.)

### 4.3 Backfill destination_text from JSONB

```sql
UPDATE public.events
SET destination_text = NULLIF(btrim(theme->'business_trip'->>'destinationLocationText'), ''),
    updated_at = now()
WHERE event_type = 'trip'
  AND deleted_at IS NULL
  AND theme->'business_trip'->>'destinationLocationText' IS NOT NULL
  AND destination_text IS NULL;
```

After backfill, log how many trips remain with `destination_text IS NULL` AND `status IN ('scheduled','live')` — those are the data-loss casualties (DC Adventure is one). Operator re-enters via post-fix edit screen.

### 4.4 Strip destination + date keys from JSONB on every trip row

```sql
UPDATE public.events
SET
  theme = jsonb_set(
    theme,
    '{business_trip}',
    (theme->'business_trip')
      - 'destinationLocationText'
      - 'destinationPlaceId'
      - 'destinationLat'
      - 'destinationLng'
      - 'startAt'
      - 'endAt'
  ),
  updated_at = now()
WHERE event_type = 'trip'
  AND deleted_at IS NULL
  AND theme ? 'business_trip';
```

Post-strip verification probe: assert zero rows still have any of those keys inside `business_trip`. RAISE EXCEPTION if any survive.

### 4.5 New per-tier sold-count RPC (mirror ORCH-0947)

```sql
CREATE OR REPLACE FUNCTION public.biz_trip_tickets_sold_by_tier(p_event_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    jsonb_object_agg(tt.id::text, sold_count),
    '{}'::jsonb
  )
  FROM public.ticket_types tt
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS sold_count
    FROM public.tickets t
    WHERE t.ticket_type_id = tt.id
      AND t.status IN ('valid', 'used', 'transferred')
  ) c ON true
  WHERE tt.event_id = p_event_id
    AND tt.deleted_at IS NULL;
$$;

GRANT EXECUTE ON FUNCTION public.biz_trip_tickets_sold_by_tier(uuid) TO authenticated;

COMMENT ON FUNCTION public.biz_trip_tickets_sold_by_tier(uuid) IS
  'ORCH-0950 expanded scope: mirrors biz_trip_tickets_sold (ORCH-0947) but grouped by ticket_type_id. Returns {ticket_type_id::text: sold_count}. Sold = tickets.status IN (valid, used, transferred). Used by trip dashboard tier-card sold counts.';
```

### 4.6 Rewrite `biz_update_live_trip`

Re-issue `CREATE OR REPLACE FUNCTION public.biz_update_live_trip(uuid, jsonb, text)` preserving all existing refund-gate + ORCH-0880 intake logic. Changes:

**Change A — date writes route to canonical columns.** Currently date shifts only run refund-gate validation (lines 273-297 of current migration) and let the shallow-merge land them into JSONB. Post-spec: date shifts write to `event_dates` (`start_at`, `end_at`) AND strip `startAt`/`endAt` keys from the inbound patch.

```sql
IF v_new_business_trip ? 'startAt' OR v_new_business_trip ? 'endAt' THEN
  -- existing refund-gate logic unchanged …
  -- existing dates_shifted_with_sales check unchanged …

  -- NEW: write canonical event_dates row (single master row for trips)
  UPDATE public.event_dates
  SET start_at = COALESCE(v_new_start, start_at),
      end_at = COALESCE(v_new_end, end_at),
      updated_at = v_now
  WHERE event_id = p_event_id
    AND is_master = true;

  -- NEW: strip the now-canonicalized keys from inbound patch (defense-in-depth)
  p_patch := p_patch #- '{theme,business_trip,startAt}';
  p_patch := p_patch #- '{theme,business_trip,endAt}';
END IF;
```

**Change B — destination writes route to canonical column.** New handling block:

```sql
IF v_new_business_trip ? 'destinationLocationText' THEN
  UPDATE public.events
  SET destination_text = NULLIF(btrim(v_new_business_trip->>'destinationLocationText'), ''),
      updated_at = v_now
  WHERE id = p_event_id;

  p_patch := p_patch #- '{theme,business_trip,destinationLocationText}';
  -- also strip the metadata siblings so they cannot re-introduce JSONB drift
  p_patch := p_patch #- '{theme,business_trip,destinationPlaceId}';
  p_patch := p_patch #- '{theme,business_trip,destinationLat}';
  p_patch := p_patch #- '{theme,business_trip,destinationLng}';
END IF;
```

**Change C — cleanup empty shells (extend existing logic at lines 261-269).** After Changes A and B + existing capacity strip, the inbound patch may have `theme.business_trip = {}` or `theme = {}` and need shell cleanup. The existing cleanup at lines 261-269 already handles this — verify it runs AFTER all three strip blocks (capacity, dates, destination). If the order makes it run before, the implementor MUST move the cleanup to after the last strip block.

**Change D — replace `theme || (p_patch->'theme')` with a structural assertion** (root-cause fix for Root Cause 1). Now that capacity/dates/destination are stripped, the only remaining `business_trip` keys in a patch should be NONE for current product flows. Defensive: assert that if `p_patch->'theme'->'business_trip'` is non-empty after strips, the merge uses `jsonb_set` to deep-merge into `business_trip` rather than shallow-merge the parent `theme`.

```sql
IF p_patch ? 'theme'
   AND p_patch->'theme' ? 'business_trip'
   AND p_patch->'theme'->'business_trip' <> '{}'::jsonb THEN
  -- Deep merge: preserve sibling keys of the existing business_trip object
  UPDATE public.events
  SET theme = jsonb_set(
        theme,
        '{business_trip}',
        COALESCE(theme->'business_trip', '{}'::jsonb)
          || (p_patch->'theme'->'business_trip')
      ),
      updated_at = v_now
  WHERE id = p_event_id;

  -- Remove business_trip from the patch so the broader theme merge below does not double-write
  p_patch := p_patch #- '{theme,business_trip}';
  IF p_patch ? 'theme' AND p_patch->'theme' = '{}'::jsonb THEN
    p_patch := p_patch - 'theme';
  END IF;
END IF;

-- Existing broader UPDATE events block (lines 430-462) — the theme merge there is now SAFE
-- because business_trip has been pre-handled above. Other theme keys (e.g. business_event for events,
-- coverHue, etc.) still shallow-merge at top level which is intentional.
```

**Change E — append `business_trip → canonical columns` to function comment.** Document the new contract.

### 4.7 Rewrite `business_publish_trip_draft`

Re-issue `CREATE OR REPLACE FUNCTION public.business_publish_trip_draft(uuid, jsonb, integer)`. Changes:

**Change A — destination validation reads from JSONB at publish time (wizard still writes JSONB during draft), then writes to canonical column.** The existing validator at line 700-704 already reads `v_business_trip->>'destinationLocationText'` for validation. Add after validation (line ~705):

```sql
-- Write canonical destination column
UPDATE public.events
SET destination_text = v_destination_text
WHERE id = p_event_id;
```

**Change B — strip destination + date keys from persisted theme.** Replace line 813's `theme = jsonb_strip_nulls((v_theme #- '{business_trip,capacity}') - 'business_draft')` with:

```sql
theme = jsonb_strip_nulls(
  (v_theme
    #- '{business_trip,capacity}'
    #- '{business_trip,destinationLocationText}'
    #- '{business_trip,destinationPlaceId}'
    #- '{business_trip,destinationLat}'
    #- '{business_trip,destinationLng}'
    #- '{business_trip,startAt}'
    #- '{business_trip,endAt}'
  ) - 'business_draft'
),
```

**Change C — append note to function comment.**

### 4.8 Self-verification probe

Append a Step 8 DO block (mirroring the existing one) that asserts:
- `events.destination_text` column exists.
- `biz_trip_tickets_sold_by_tier` function exists with correct signature.
- `biz_update_live_trip` source contains `UPDATE public.event_dates` AND `UPDATE public.events\n  SET destination_text` AND `jsonb_set(\n        theme,\n        '{business_trip}'`.
- `business_publish_trip_draft` source contains `destinationLocationText` strip in the theme persistence.

RAISE EXCEPTION on any miss.

---

## 5. Service-layer changes (`mingla-business/src/services/tripsService.ts`)

### 5.1 `readBusinessTrip` (line 338-356) — signature extended

```ts
function readBusinessTrip(
  theme: Record<string, unknown> | null | undefined,
  ticketCapacity: number | null,
  canonicalStartAt: string | null,   // NEW — from event_dates.start_at
  canonicalEndAt: string | null,     // NEW — from event_dates.end_at
  canonicalDestination: string | null, // NEW — from events.destination_text
): TripBusinessTrip {
  const bt = (theme?.business_trip as Record<string, unknown> | undefined) ?? {};
  return {
    // … other fields unchanged (booking deadlines, etc., if they still exist) …
    capacity: ticketCapacity,
    startAt: canonicalStartAt,
    endAt: canonicalEndAt,
    destinationLocationText: canonicalDestination,
    // destinationPlaceId/Lat/Lng can stay JSONB-sourced for now (no reader uses them)
    destinationPlaceId: typeof bt.destinationPlaceId === "string" ? bt.destinationPlaceId : null,
    destinationLat: typeof bt.destinationLat === "number" ? bt.destinationLat : null,
    destinationLng: typeof bt.destinationLng === "number" ? bt.destinationLng : null,
  };
}
```

### 5.2 `mapTrip` / `getTrip` join updates

The trip detail query MUST now also select `events.destination_text` and join `event_dates` (`is_master = true` row). Thread the three canonical values into `readBusinessTrip`. If `event_dates` returns 0 rows for a trip (pre-publish or corrupt state), pass nulls — `readBusinessTrip` tolerates.

### 5.3 `updateTripBasics` (line 590-638) — defensive throw extended

```ts
if (patch.businessTrip !== undefined) {
  const bt = patch.businessTrip as Record<string, unknown>;
  if (bt.capacity !== undefined) {
    throw new Error("ORCH-0950: trip capacity must route through updateTripPricing, not updateTripBasics.");
  }
  if (bt.startAt !== undefined || bt.endAt !== undefined) {
    throw new Error("ORCH-0950 expanded: trip start/end must route through updateLiveTripFields (writes event_dates), not updateTripBasics.");
  }
  if (bt.destinationLocationText !== undefined) {
    throw new Error("ORCH-0950 expanded: trip destination must route through updateLiveTripFields (writes events.destination_text), not updateTripBasics.");
  }
  // … existing theme merge logic, unchanged …
}
```

The wizard's pre-publish `updateTripBasics` calls do not currently include these keys (per the existing routing); the throw is defense-in-depth.

### 5.4 New service function for tier-card sold counts

```ts
export async function readTripSoldCountsByTier(
  eventId: string,
): Promise<Map<string, number>> {
  const { data, error } = await supabase.rpc("biz_trip_tickets_sold_by_tier", {
    p_event_id: eventId,
  });
  if (error) throw error;
  const map = new Map<string, number>();
  for (const [k, v] of Object.entries(data ?? {})) {
    map.set(k, Number(v));
  }
  return map;
}
```

---

## 6. Component changes

### 6.1 `mingla-business/app/trip/[id]/index.tsx`

**Spots tile (line 298-301)** — already canonical after rebase brings in ORCH-0947's `ticketsSold` change. No additional change required from this SPEC; verify post-rebase.

**Hero subtitle (line 376-400)** — no source change needed; reader already references `trip.businessTrip.startAt/endAt/destinationLocationText`. Service-layer change in §5.1 makes those values canonical-sourced.

**`tripLifecycleStatus` (line 302-306)** — same as hero subtitle; no source change needed; `deriveTripLifecycleStatus` reads `trip.businessTrip.startAt/endAt` which become canonical.

**`soldCountByTier` (line 192-203)** — replace orders-count map with RPC-sourced map:

```tsx
const soldCountsByTierQuery = useQuery({
  queryKey: tripKeys.soldCountsByTier(eventId),
  queryFn: () => readTripSoldCountsByTier(eventId),
  staleTime: 30_000,
});
const soldCountByTier = soldCountsByTierQuery.data ?? new Map<string, number>();
```

Invalidation: add `tripKeys.soldCountsByTier(eventId)` to `useUpdateLiveTripFields` `onSuccess` invalidation list AND to any checkout-confirm realtime handler (out of scope for this turn — register as future ORCH if not already covered).

### 6.2 `mingla-business/src/components/event/EventDetailTicketTypeRow.tsx`

Current render: `${sold} / ${cap}`. No change in display format — this is correct. The bundle ensures both inputs are canonical.

**Optional D-2 refinement (operator-confirmable):** if the desired display is `${remaining} left` instead of `${sold} / ${cap}`, that's a copy change. Defer to operator at REVIEW; default = preserve current `sold / cap` shape and rely on canonical inputs.

### 6.3 `mingla-business/src/components/trip/EditPublishedTripScreen.tsx`

No patch-building change needed — the current `patch.theme = { business_trip: bt }` shape still works because the RPC now correctly strips the canonicalized keys into column writes. The client surface stays backward-compatible.

### 6.4 `mingla-business/src/components/trip/TripCreatorWizard.tsx`

No change. Step 1 capacity autosaves through `updateTripPricing` (already correct from ORCH-0950 v1). Step 1 destination/dates still write to JSONB during draft via `updateTripBasics` — that's fine because at publish time `business_publish_trip_draft` writes canonical column and strips JSONB. The wizard pre-publish flow stays untouched.

---

## 7. React Query keys + invalidation

### 7.1 New key

Add to `tripKeys` factory (in `mingla-business/src/hooks/useTrips.ts` or wherever `tripKeys` lives — implementor confirms):

```ts
soldCountsByTier: (eventId: string) => [...tripKeys.detail(eventId), 'soldCountsByTier'] as const,
```

### 7.2 Invalidation rule

`useUpdateLiveTripFields` `onSuccess` (lines 348-362 of `useTrips.ts`) MUST also invalidate `tripKeys.soldCountsByTier(eventId)`. Add one line.

Checkout-confirm Realtime handler (if it exists for planner dashboards — implementor confirms by grep) must also invalidate this key.

---

## 8. Strict-grep CI gate

Extend `i-proposed-trip-capacity-single-source.mjs` (already in the branch from ORCH-0950 v1) with two additional forbidden patterns:

- **Pattern E:** literal `theme || (p_patch->'theme')` in any file under `supabase/migrations/` whose filename does NOT match `*_orch_0876_*` (the original ORCH-0876 migration is historical evidence; preserve as-is). Catches the shallow-merge re-introduction.
- **Pattern F:** literal substrings `business_trip.startAt`, `business_trip.endAt`, `business_trip.destinationLocationText` in `mingla-business/src/`, `mingla-business/app/`, `mingla-admin/src/`, `app-mobile/src/` outside of `tripsService.ts:readBusinessTrip` definition + the strip migration itself. Force readers through canonical columns.

Rename the gate file to `i-proposed-trip-canonical-columns.mjs` (broadened scope) OR add a sibling `i-proposed-trip-canonical-dates-destination.mjs` — implementor's choice; prefer rename for one-gate-per-invariant simplicity, but renaming requires updating the existing strict-grep workflow YAML.

Self-test fixtures: add 2 new test cases for patterns E and F.

---

## 9. Invariant codification

Update `Mingla_Artifacts/INVARIANT_REGISTRY.md`:

> **I-PROPOSED-TRIP-CANONICAL-COLUMNS** (DRAFT → ACTIVE on ORCH-0950-EXPANDED CLOSE — supersedes I-PROPOSED-TRIP-CAPACITY-SINGLE-SOURCE):
> Trip capacity is stored ONLY in `ticket_types.quantity_total`. Trip start/end dates are stored ONLY in `event_dates.start_at/end_at` (single `is_master=true` row per trip). Trip destination text is stored ONLY in `events.destination_text`. Code that writes or reads `events.theme.business_trip.{capacity,startAt,endAt,destinationLocationText,destinationPlaceId,destinationLat,destinationLng}` for trip purposes is forbidden, except service-layer aliases that source from canonical columns and surface them under those field names for backward source-compat.

> **I-PROPOSED-PARTIAL-PATCH-PRESERVES-SIBLINGS** (DRAFT → ACTIVE on ORCH-0950-EXPANDED CLOSE):
> Any RPC accepting a JSONB patch where nested objects represent independent fields (e.g., `theme.business_trip`) MUST deep-merge those nested objects rather than shallow-merge the parent. SQL idiom: `jsonb_set(parent, '{nested_key}', existing_nested || patch_nested)` not `parent || patch_parent`. CI gate `i-proposed-trip-canonical-columns` forbids the shallow-merge pattern in trip RPCs.

---

## 10. Decision log entry

Add to `Mingla_Artifacts/DECISION_LOG.md` (next DEC#):

> **DEC-XXX (ORCH-0950 EXPANDED, 2026-05-24):** Trip capacity, dates, and destination are stored ONLY in canonical SQL columns (`ticket_types.quantity_total`, `event_dates.start_at/end_at`, `events.destination_text`). JSONB blob `events.theme.business_trip` retained for forward-compat but write-frozen and read-frozen for these fields. Decision driven by proven `theme || patch_theme` shallow-merge wipe bug that destroyed sibling JSONB keys on every partial business_trip edit (DC Adventure 2026-05-24 16:28 UTC incident). Supersedes original ORCH-0950 DEC.

> **DEC-XXX+1 (ORCH-0950 EXPANDED, 2026-05-24):** Per-tier sold counts source from canonical `biz_trip_tickets_sold_by_tier` RPC (mirror of ORCH-0947 [Spots tile counts tickets, not orders]), not orders-count maps. Replaces planner dashboard `soldCountByTier` Map-of-orders.

---

## 11. Test plan (satisfies ORCH-0840 [Regression-test enforcement + append-only CI])

### 11.1 Implementor happy-path

**File:** `supabase/functions/_test/orch_0950_expanded_partial_patch_preserves_siblings.test.ts`

Seed trip with:
- `theme.business_trip = {capacity:50, destinationLocationText:"Test"}` (pre-strip shape)
- `event_dates.start_at = '2026-08-01', end_at = '2026-08-05'`
- `events.destination_text = NULL` (pre-backfill)

Apply migration. Then:

Test 1: call `biz_update_live_trip` with patch `{theme: {business_trip: {capacity: 60}}}` → assert `ticket_types.quantity_total = 60` AND `events.theme.business_trip` does NOT contain `capacity` AND `events.destination_text` still NULL (untouched) AND `event_dates.start_at` still `2026-08-01` (untouched).

Test 2: call `biz_update_live_trip` with patch `{theme: {business_trip: {destinationLocationText: "New Place"}}}` → assert `events.destination_text = "New Place"` AND `events.theme.business_trip.destinationLocationText` does NOT exist AND `ticket_types.quantity_total` unchanged AND `event_dates` unchanged.

Test 3: call `biz_update_live_trip` with combined patch `{theme: {business_trip: {capacity: 70, destinationLocationText: "Another", startAt: "2026-09-01T00:00:00Z", endAt: "2026-09-05T23:59:59Z"}}}` → assert all four canonical columns updated AND `theme.business_trip` is empty (or whatever non-canonical keys remain) AND no sibling-wipe occurred.

Test 4: call `biz_trip_tickets_sold_by_tier` → returns `{ticket_type_id: 0}` initially.

**Fails-on-revert proof:** implementor must capture `fails-on-revert verified at <commit hash>` by reverting the new RPC and asserting Test 3 FAILS (would wipe siblings under old shallow-merge).

### 11.2 Tester adversarial (different angle — dashboard reader resilience)

**File:** `mingla-business/src/services/__tests__/tripsService.dashboard_reader_canonical.adversarial.test.ts`

Adversarial angle: the implementor proves the WRITER fixes the wipe. The adversarial proves the READER renders correctly EVEN IF the JSONB blob is empty/wiped/malformed.

Test 1: mock RPC to return trip row with `theme.business_trip = {}`, `events.destination_text = "DC"`, `event_dates.start_at/end_at` populated, `ticket_types.quantity_total = 100`. Assert `readBusinessTrip` returns `{capacity: 100, startAt: <canonical>, endAt: <canonical>, destinationLocationText: "DC", …}`.

Test 2: mock with `theme.business_trip = null` entirely. Assert no crash, all canonical fields render from columns.

Test 3: mock with `theme.business_trip = {capacity: 999, destinationLocationText: "OLD"}` (residual JSONB that the strip migration "missed"). Assert the canonical-column values WIN — `capacity` returns the `ticket_types.quantity_total` value (NOT 999), `destinationLocationText` returns `events.destination_text` value (NOT "OLD"). This proves canonical-column-precedence.

Test 4: mock with `event_dates = []` (corrupt trip with no dates row). Assert `startAt: null, endAt: null` (graceful degradation) and dashboard would render "Date TBD" — acceptable because root cause is real data corruption, not reader bug.

### 11.3 No append-only test exception needed

All new files; lands clean under the ORCH-0840 append-only gate.

---

## 12. Success criteria (numbered, falsifiable)

| # | Criterion | Verification |
|---|---|---|
| SC-01 | `events.destination_text` column exists post-migration | SQL probe |
| SC-02 | All pre-existing trips with `theme.business_trip.destinationLocationText` present have `destination_text` backfilled | SQL probe in migration self-verify |
| SC-03 | DC Adventure shows `destination_text IS NULL` post-migration (lost data, operator re-enters) | SQL probe + operator confirmation |
| SC-04 | `biz_update_live_trip` capacity-only patch writes ONLY `ticket_types.quantity_total`; no theme write | Test 11.1 Test 1 |
| SC-05 | `biz_update_live_trip` destination-only patch writes ONLY `events.destination_text`; sibling keys preserved | Test 11.1 Test 2 |
| SC-06 | `biz_update_live_trip` combined patch writes all four canonical fields; no sibling wipe in JSONB residue (if any) | Test 11.1 Test 3 |
| SC-07 | `business_publish_trip_draft` writes `events.destination_text` AND strips JSONB destination/dates from persisted theme | Implementor test + SQL probe |
| SC-08 | `biz_trip_tickets_sold_by_tier` returns correct per-tier ticket counts (status valid/used/transferred) | RPC unit test |
| SC-09 | `readBusinessTrip` sources `capacity` from `ticket_types`, `startAt`/`endAt` from `event_dates`, `destinationLocationText` from `events.destination_text` | Test 11.2 Tests 1-4 |
| SC-10 | Trip dashboard hero subtitle on DC Adventure (post-operator-re-entry of destination) shows real dates `Aug 17–22` and destination text | Live-fire iOS + business-web |
| SC-11 | Trip dashboard tier card shows `${ticketsSold} / ${canonicalCapacity}` with canonical sources for both | Live-fire + Jest snapshot |
| SC-12 | `tripLifecycleStatus` pill on DC Adventure shows correct lifecycle (e.g., "Upcoming") given canonical dates | Live-fire |
| SC-13 | New strict-grep gate forbids `theme || (p_patch->'theme')` in trip RPC migrations AND forbids `business_trip.{startAt,endAt,destinationLocationText}` reads outside `readBusinessTrip`/migrations | Self-test 4/4 PASS |
| SC-14 | `useUpdateLiveTripFields` invalidates `tripKeys.soldCountsByTier(eventId)` on success | Service-layer test |
| SC-15 | DC Adventure live-fire: after operator re-enters destination via edit screen, dashboard shows it on next render | Operator-assisted live-fire |

---

## 13. Implementation order

1. Rebase branch on `main` to bring in ORCH-0947's Spots tile change and ORCH-0948's waitlist work. Resolve conflicts on `WORLD_MAP.md`, `MASTER_BUG_LIST.md`, `WORKTREE_REGISTRY.md` by keeping both edits.
2. Write migration `20260725000002_orch_0950_expanded_scope_dashboard_coherence.sql` end-to-end (§4.1–4.8).
3. Update strict-grep gate file (rename to `i-proposed-trip-canonical-columns.mjs` or sibling — §8) + self-test + workflow YAML rename if applicable.
4. Update `tripsService.ts` (§5.1–5.4) — new `readBusinessTrip` signature, `mapTrip` join, defensive throws, new `readTripSoldCountsByTier`.
5. Update `useTrips.ts` (§7.1–7.2) — new query key + extended invalidation.
6. Update `app/trip/[id]/index.tsx` (§6.1) — replace `soldCountByTier` with RPC query.
7. Write implementor regression test (§11.1) + fails-on-revert proof.
8. Scaffold adversarial test (§11.2) — implementor scaffolds, tester re-authors assertions.
9. Run all strict-grep gates locally + TS type-check + Jest + Deno suite — all green.
10. Update `ORCH_NNNN_BACKEND_ALLOWLIST` in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` with the new migration filename.
11. Write `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0950_EXPANDED_SCOPE_DASHBOARD_COHERENCE.md` with old→new receipts + commit hash + fails-on-revert hash.
12. Hand back to orchestrator. Do NOT run `supabase db push`. Do NOT deploy edge functions (none touched).

---

## 14. Regression prevention

- CI strict-grep gate (rebroadened) catches reintroduction of shallow-merge OR JSONB reads.
- Migration self-verify probe catches RPC source drift.
- Implementor test + adversarial test together cover writer + reader sides.
- Service-layer defensive throws catch dev-time regressions before they ship.
- Memory record (orchestrator owns at CLOSE Step 5a): update `feedback_trip_capacity_canonical_in_ticket_types.md` → broaden to `feedback_trip_canonical_columns.md` covering capacity + dates + destination.

---

## 15. Out of scope (do NOT touch)

- ORCH-0960 [Stripe `account_invalid` on hosted-session create] — separate ORCH.
- ORCH-0946 [Buyer-web sold-out gate `quantityTotal` mismap] — buyer-web; planner-side handled via tier-card soldCount canonicalization here.
- Event-side (`event_type = 'event'`) RPCs and dashboard — no changes; the `business_publish_event_draft` RPC and event dashboard are unaffected.
- Multi-tier trip support — single-tier assumption preserved.
- Removing `theme.business_trip` JSONB key entirely — kept for forward-compat / non-canonical fields (booking deadline, etc.).
- Destination lat/lng/placeId column promotion — left in JSONB; no current reader.
- ORCH-0957 [`spawn.sh` migration-timestamp collision] — independent infrastructure ORCH.

---

## 16. Blast radius reconfirmation

Spec-writing surfaced two findings beyond the investigation's blast radius:

1. **`soldCountByTier` (planner dashboard line 192-203) counts orders not tickets** — sister bug to ORCH-0947. Folded into this SPEC via new `biz_trip_tickets_sold_by_tier` RPC + service function + dashboard rewire. Not new scope — same canonicalization principle the investigation called for.
2. **`tripLifecycleStatus` (line 302-306) reads wiped JSONB dates** — same reader bug class as the hero subtitle. Already covered by service-layer change at §5.1 (no separate code change required since `deriveTripLifecycleStatus` reads `trip.businessTrip.startAt/endAt` which become canonical-sourced).

Both consistent with the investigation's "make canonical sources end-to-end" direction. No new ORCH spin-off needed.

---

## 17. Confidence

**HIGH.** All file locations verified against current branch; live DB probes confirm DC Adventure state; investigation's root causes are six-field proven; canonical column choices (`event_dates`, new `destination_text`) are minimal and reversible. The one assumption — rebase brings ORCH-0947's `ticketsSold` Spots tile change — is mechanical and verifiable before IMPLEMENT begins.

---

## Pipeline status

- **INVESTIGATE:** ✅ COMPLETE
- **SPEC:** ✅ COMPLETE (this file)
- **IMPLEMENT:** ready for dispatch
- **TEST / CLOSE:** future passes from same per-ORCH branch
