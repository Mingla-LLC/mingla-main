# SPEC — ORCH-0950 [Trip capacity dual-source-of-truth bug]

**Spec author:** Claude `mingla-forensics` (SPEC mode)
**Date:** 2026-05-24
**Working tree:** `~/Desktop/mingla-orchs/ORCH-0950-[trip-capacity-single-source]/` on branch `ORCH-0950-trip-capacity-single-source`
**Operator-locked direction:** Option D — `ticket_types.quantity_total` becomes the single canonical column; `events.theme.business_trip.capacity` is stripped from the schema and forbidden by CI gate.
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0950_TRIP_CAPACITY_DUAL_SOURCE.md`
**Pipeline:** SPEC (this) → IMPLEMENT (Codex `implementor-mingla`) → operator-applied DB push → TEST (Claude `mingla-tester`) → CLOSE.

---

## 1. Cross-Surface Impact Declaration

### Surfaces IN scope

| Surface | User-visible behaviour the spec demands | Files touched | Parity |
|---|---|---|---|
| **Business iOS** (planner edits live trip capacity) | After editing "Max travelers" on a published trip and tapping Save, the new value is enforced by buyer checkout immediately. No drift. | `mingla-business/src/services/tripsService.ts`, `mingla-business/src/components/trip/EditPublishedTripScreen.tsx`, `mingla-business/src/components/trip/TripCreatorWizard.tsx` | Automatic — shared RN code |
| **Business Android** (same) | Same | Same | Automatic — shared RN code |
| **Business Web preview** (same) | Same | Same | Automatic — shared RN code |
| **Buyer-anonymous Web** (`/checkout-trip/{tripEventId}/*`) | Checkout RPC enforces the up-to-date capacity. No 409 `ticket_capacity_exceeded` thrown when the planner has just raised capacity. | (no code change — checkout RPC unchanged; it already reads `ticket_types.quantity_total`) | Automatic |
| **Backend (Postgres RPCs + migration)** | `biz_update_live_trip` writes `ticket_types.quantity_total` for capacity changes; `events.theme.business_trip.capacity` column is stripped from all rows and never written again. | `supabase/migrations/<new>_orch_0950_trip_capacity_single_source.sql` | n/a |

### Surfaces NOT in scope

| Surface | Reason |
|---|---|
| Consumer iOS | Consumer app does not edit business trips. |
| Consumer Android | Same. |
| Admin Web | No trip-capacity editing surface in admin. |

Parity across the three business surfaces (iOS / Android / Web preview) is automatic via shared RN code paths. No per-surface success criteria needed beyond the shared one.

---

## 2. Goal

Eliminate the dual-source-of-truth bug for trip capacity by making `ticket_types.quantity_total` the single canonical column. Strip `capacity` from `events.theme.business_trip` JSONB on every existing row, rewrite the edit-live-trip RPC to write the integer column, rewrite the service-layer reader to source from the integer column (via join), and add a strict-grep CI gate that prevents future code from re-introducing the dual storage.

---

## 3. Scope and Non-Goals

### Scope
- Trip capacity column unification only.
- The single migration that performs: pre-flight drift probe → backfill reconciliation → JSONB key strip → RPC rewrite → comment update.
- The service-layer reader rewrite (`tripsService.ts`) and the writer rerouting in `updateTripBasics` / wizard autosave.
- One new strict-grep CI gate + self-test fixtures.
- Two regression tests (implementor happy-path + tester adversarial) per ORCH-0840 [Regression-test enforcement + append-only CI].
- One new invariant + one new DECISION_LOG entry.

### Non-goals
- ORCH-0946 [Buyer-web sold-out gate `quantityTotal` vs remaining mismap] — independent root cause; separate ORCH.
- ORCH-0947 [Trip dashboard KPI "spots" tile counts orders not tickets] — independent root cause; separate ORCH.
- Multi-tier trip support — current trip model is single-ticket-type; spec assumes 1:1 `events ↔ trip_pricing_tiers ↔ ticket_types` and the join is single-row.
- Event-side (`event_type = 'event'`) capacity — only trip events touched.
- Refactoring `business_publish_trip_draft` beyond the necessary validation comment update (it already does not write capacity to `ticket_types`; capacity validation continues to read from theme during draft validation BEFORE this spec ships — see §6.2 for the post-spec change).
- Any UI redesign of the capacity input. Only data wiring changes.

### Assumptions (called out for verification at IMPLEMENT)
- Every published trip event has exactly one row in `trip_pricing_tiers` and exactly one row in `ticket_types` (joined via `trip_pricing_tiers.ticket_type_id`). Verified by inspection of `tripsService.createTripDraft` (always inserts one) and `updateTripPricing` (always operates on `maybeSingle()` tier row). The pre-flight drift probe in the migration MUST also assert this invariant per-row and FAIL the migration if any trip has 0 or >1 ticket_types.
- "Capacity" in JSONB has only ever been an integer or NULL. The backfill rule treats `NULL` JSONB capacity as "no JSONB value" (use `quantity_total` as-is).

---

## 4. Schema changes

### 4.1 Migration filename

`supabase/migrations/20260725000000_orch_0950_trip_capacity_single_source.sql`

(Use the next available timestamp at implement time if `20260725000000` is taken; bump by 1 second.)

### 4.2 Migration structure (single file, atomic transaction)

The migration must execute in this order, inside one implicit transaction:

#### 4.2.1 Pre-flight invariant probe (raise if violated)

```sql
DO $$
DECLARE
  v_bad_trip_count int;
BEGIN
  -- Every trip event must have exactly one ticket_types row joined via trip_pricing_tiers.
  SELECT count(*) INTO v_bad_trip_count
  FROM public.events e
  WHERE e.event_type = 'trip'
    AND e.deleted_at IS NULL
    AND (
      SELECT count(*) FROM public.trip_pricing_tiers tpt
      WHERE tpt.event_id = e.id
    ) <> 1;

  IF v_bad_trip_count > 0 THEN
    RAISE EXCEPTION 'ORCH-0950 migration aborted: % trip events have != 1 trip_pricing_tiers row. Fix data before applying.', v_bad_trip_count;
  END IF;
END;
$$;
```

#### 4.2.2 Drift report (informational `RAISE NOTICE`, never aborts)

```sql
DO $$
DECLARE
  v_drift record;
  v_drift_count int := 0;
BEGIN
  FOR v_drift IN
    SELECT
      e.id AS event_id,
      e.title,
      NULLIF((e.theme->'business_trip'->>'capacity'), '')::int AS theme_capacity,
      tt.id AS ticket_type_id,
      tt.quantity_total AS ticket_capacity
    FROM public.events e
    JOIN public.trip_pricing_tiers tpt ON tpt.event_id = e.id
    JOIN public.ticket_types tt ON tt.id = tpt.ticket_type_id
    WHERE e.event_type = 'trip'
      AND e.deleted_at IS NULL
      AND NULLIF((e.theme->'business_trip'->>'capacity'), '')::int IS DISTINCT FROM tt.quantity_total
  LOOP
    v_drift_count := v_drift_count + 1;
    RAISE NOTICE 'ORCH-0950 drift: event=% title=% theme_capacity=% ticket_capacity=% — reconciling to MAX',
      v_drift.event_id, v_drift.title, v_drift.theme_capacity, v_drift.ticket_capacity;
  END LOOP;
  RAISE NOTICE 'ORCH-0950 drift report complete: % rows will be reconciled.', v_drift_count;
END;
$$;
```

#### 4.2.3 Backfill (reconcile drift — rule: MAX of the two values)

Operator-confirmed rule: trip capacities only grow in practice (the bug surfaced when operator bumped 55→100). Take `MAX(theme_capacity, ticket_capacity)`, ignoring NULL inputs (`GREATEST` returns NULL if any input is NULL; coalesce both to 0 for the comparison, then back to the original non-null value).

```sql
UPDATE public.ticket_types tt
SET
  quantity_total = GREATEST(
    COALESCE(NULLIF((e.theme->'business_trip'->>'capacity'), '')::int, tt.quantity_total, 0),
    COALESCE(tt.quantity_total, 0)
  ),
  updated_at = now()
FROM public.events e
JOIN public.trip_pricing_tiers tpt ON tpt.event_id = e.id
WHERE tpt.ticket_type_id = tt.id
  AND e.event_type = 'trip'
  AND e.deleted_at IS NULL
  AND NULLIF((e.theme->'business_trip'->>'capacity'), '')::int IS DISTINCT FROM tt.quantity_total;
```

#### 4.2.4 Strip `capacity` from theme JSONB on every trip row

```sql
UPDATE public.events
SET
  theme = jsonb_set(
    theme,
    '{business_trip}',
    (theme->'business_trip') - 'capacity'
  ),
  updated_at = now()
WHERE event_type = 'trip'
  AND deleted_at IS NULL
  AND theme ? 'business_trip'
  AND (theme->'business_trip') ? 'capacity';
```

#### 4.2.5 Post-strip verification probe

```sql
DO $$
DECLARE
  v_residue_count int;
BEGIN
  SELECT count(*) INTO v_residue_count
  FROM public.events
  WHERE event_type = 'trip'
    AND deleted_at IS NULL
    AND (theme->'business_trip') ? 'capacity';

  IF v_residue_count > 0 THEN
    RAISE EXCEPTION 'ORCH-0950 strip failed: % trip rows still have theme.business_trip.capacity', v_residue_count;
  END IF;
END;
$$;
```

#### 4.2.6 RPC rewrite — `biz_update_live_trip`

Rewrite via `CREATE OR REPLACE FUNCTION` matching the existing signature in `supabase/migrations/20260616000000_orch_0876_trip_published_edit.sql`. Two behavioural changes; everything else byte-preserved.

**Change A — capacity write target:** when `p_patch` includes a capacity value (current shape: `p_patch->'theme'->'business_trip'->>'capacity'`), DO NOT merge it into `events.theme`. INSTEAD, UPDATE `ticket_types.quantity_total` on the joined row.

The capacity refund-gate check (existing logic comparing `v_old_capacity` to `v_new_capacity`, blocking edits that would drop below sold count) MUST be preserved. The `v_old_capacity` source changes from `(v_business_trip->>'capacity')::int` to `(SELECT tt.quantity_total FROM public.ticket_types tt JOIN public.trip_pricing_tiers tpt ON tpt.ticket_type_id = tt.id WHERE tpt.event_id = p_event_id LIMIT 1)`.

**Change B — strip capacity from `p_patch` before the `events.theme` merge:** the input shape from clients is unchanged (the service still sends `patch.theme.business_trip.capacity` for backward source-compat in this same PR — see §6.1 for the simultaneous service-layer change). The RPC reads the capacity value, applies it to `ticket_types`, then removes the key from the patch before the theme merge so it does not silently land in JSONB even if a stale client sends it.

Pseudocode for the relevant block (full SQL is the implementor's deliverable):

```sql
-- … existing destination + dates handling above …

-- ORCH-0950: capacity now writes to ticket_types.quantity_total, NOT theme.
v_new_business_trip := COALESCE(p_patch->'theme'->'business_trip', '{}'::jsonb);
IF v_new_business_trip ? 'capacity' THEN
  v_new_capacity := NULLIF(v_new_business_trip->>'capacity', '')::int;

  IF v_new_capacity IS NULL OR v_new_capacity <= 0 THEN
    RAISE EXCEPTION 'trip_capacity_required';
  END IF;

  -- Look up current ticket_types.quantity_total for the refund gate
  SELECT tt.quantity_total, tt.id
  INTO v_old_capacity, v_ticket_type_id
  FROM public.ticket_types tt
  JOIN public.trip_pricing_tiers tpt ON tpt.ticket_type_id = tt.id
  WHERE tpt.event_id = p_event_id
  LIMIT 1;

  IF v_ticket_type_id IS NULL THEN
    RAISE EXCEPTION 'trip_pricing_tier_missing';
  END IF;

  -- Preserve the existing refund-gate check (v_old_capacity vs v_new_capacity vs sold_count).
  -- (Keep the existing logic verbatim — only the source of v_old_capacity changes.)

  UPDATE public.ticket_types
  SET quantity_total = v_new_capacity, updated_at = v_now
  WHERE id = v_ticket_type_id;

  -- Strip capacity from the patch so it does not land in theme JSONB.
  p_patch := jsonb_set(
    p_patch,
    '{theme,business_trip}',
    (p_patch->'theme'->'business_trip') - 'capacity'
  );
END IF;

-- … existing theme merge UPDATE on events follows, now capacity-free …
```

#### 4.2.7 RPC rewrite — `business_publish_trip_draft` (validation source change)

Defined in `supabase/migrations/20260608000100_orch_0859_publish_rpc_trip.sql:138-142`. The publish validator currently reads capacity from `theme.business_trip.capacity`. Post-strip, this key won't exist on any new draft either (the wizard autosave change in §7 stops writing it). The validation MUST be re-rooted to `ticket_types.quantity_total`.

Replace lines 138-142 with:

```sql
SELECT tt.quantity_total INTO v_capacity
FROM public.ticket_types tt
JOIN public.trip_pricing_tiers tpt ON tpt.ticket_type_id = tt.id
WHERE tpt.event_id = p_event_id
LIMIT 1;

IF v_capacity IS NULL OR v_capacity <= 0 THEN
  RAISE EXCEPTION 'trip_capacity_required'
    USING HINT = 'Trips must have a positive capacity in ticket_types.quantity_total before publish.';
END IF;
```

(The `v_business_trip := COALESCE(v_theme->'business_trip', ...)` line earlier in the function MAY remain — `v_business_trip` is read for `destinationLocationText`, `startAt`, `endAt`, etc. Only the capacity-specific lookup is rerouted.)

#### 4.2.8 Comment update

Update the `COMMENT ON FUNCTION public.biz_update_live_trip(...)` to append `' / ORCH-0950: trip capacity is canonical in ticket_types.quantity_total; theme.business_trip.capacity stripped.'`. Same for `business_publish_trip_draft`.

---

## 5. RPC contract summary

| RPC | Input shape | Behaviour |
|---|---|---|
| `biz_update_live_trip(p_event_id uuid, p_patch jsonb, p_expected_revision int)` | Unchanged (still accepts `patch.theme.business_trip.capacity` for backward source compatibility this PR) | Capacity write rerouted to `ticket_types.quantity_total`; capacity key stripped from `p_patch.theme.business_trip` before merge. All other patch behaviour byte-preserved. |
| `business_publish_trip_draft(p_event_id uuid, p_draft_payload jsonb, p_client_revision int)` | Unchanged | `trip_capacity_required` validator now sources from `ticket_types.quantity_total`. No other change. |
| `biz_ticket_checkout_create_session` | Unchanged | NO CHANGE. Already reads `ticket_types.quantity_total`. |

---

## 6. Service-layer changes

### 6.1 `mingla-business/src/services/tripsService.ts`

#### 6.1.1 `readBusinessTrip()` at line 328-342 — change capacity source

Currently:

```ts
const bt = (theme?.business_trip as Record<string, unknown> | undefined) ?? {};
return {
  // ...
  capacity: typeof bt.capacity === "number" ? bt.capacity : null,
  // ...
};
```

Post-spec: `readBusinessTrip` MUST accept a new optional argument `ticketCapacity: number | null` and use it for the `capacity` field. The callers of `readBusinessTrip` (i.e., `mapTrip` and any other consumer in this file) must thread the first `ticket_types.quantity_total` value through.

```ts
function readBusinessTrip(
  theme: Record<string, unknown> | null | undefined,
  ticketCapacity: number | null,
): TripBusinessTrip {
  const bt = (theme?.business_trip as Record<string, unknown> | undefined) ?? {};
  return {
    // ... other fields unchanged ...
    capacity: ticketCapacity,  // ORCH-0950: source of truth is ticket_types.quantity_total, not theme.
    // ...
  };
}
```

The caller `mapTrip` already receives `tickets: TicketTypeRow[]` (verified at line 583-584). Pass `tickets[0]?.quantity_total ?? null` as the new argument. If `tickets` is empty (a draft mid-create), pass `null` — UI must already tolerate `null` because the existing return type is `number | null`.

#### 6.1.2 `updateTripBasics()` at line 590-638 — strip capacity from `patch.businessTrip` before theme merge

Trip capacity must NEVER be sent via this function post-spec. Add a defensive check: if `patch.businessTrip?.capacity !== undefined`, throw a clear error so any caller still attempting the old path fails loudly during dev.

```ts
if (patch.businessTrip !== undefined) {
  if ((patch.businessTrip as Record<string, unknown>).capacity !== undefined) {
    throw new Error(
      "ORCH-0950: trip capacity must be routed through updateTripPricing, not updateTripBasics. " +
      "Remove `capacity` from the businessTrip patch and call updateTripPricing instead."
    );
  }
  // ... existing theme merge logic, unchanged ...
}
```

#### 6.1.3 `updateTripPricing()` at line 708-798 — no behavioural change

Already writes `ticket_types.quantity_total = patch.capacity`. Verified at line 749. KEEP as-is.

#### 6.1.4 `createTripDraft()` placeholder `quantity_total: 1` at line 463 — no behavioural change

The placeholder remains. Capacity is still set to its real value via `updateTripPricing` during Step 4 of the wizard.

### 6.2 No edge function deploys required

This spec is migration + RPC + client TS only. Zero edge function code touched. The orchestrator's edge-function deploy step does NOT apply. The operator owns the `supabase db push` for the migration.

---

## 7. Wizard autosave routing decision (resolves Hard Guard #8)

**Decision:** Trip capacity is owned by `updateTripPricing` (writes `ticket_types.quantity_total`). The Step 1 capacity input remains visible as the user-facing entry point, but its onChange/autosave handler routes through the SAME pathway as Step 4 — `updateTripPricing` — NOT `updateTripBasics`.

**Justification (one sentence):** Centralizing the writer at the canonical column's owner eliminates the dual-write entirely, makes the wizard's existing Step1↔Step4 sync effect (`TripCreatorWizard.tsx:424-429`) purely a UI mirror with no data-correctness role, and ensures any code path that ever sets trip capacity must route through `updateTripPricing` (which the strict-grep gate enforces).

### 7.1 Files to change

- **`mingla-business/src/components/trip/TripCreatorWizard.tsx:512-534`** — Step 1 autosave handler. When the change set includes `capacity`, route to `updateTripPricing({ capacity: newCapacity, /* other tier fields pulled from current step4 draft */ })` instead of `updateTripBasics({ businessTrip: { capacity: newCapacity } })`. The other Step 1 fields (title, description, destination, dates, etc.) still go through `updateTripBasics` as before.
- **`mingla-business/src/components/trip/TripCreatorWizard.tsx:424-429`** — keep the sync effect as a UI mirror. No code change required.
- **`mingla-business/src/components/trip/EditPublishedTripScreen.tsx:301-304, 989-1005`** — the edit-screen capacity input MUST also route through a function that writes `ticket_types.quantity_total`. For the live-trip case, that means the `useUpdateLiveTripFields` mutation (which calls `biz_update_live_trip` RPC) STILL receives `patch.theme.business_trip.capacity` in this PR — the RPC handles the rerouting on the SQL side (§4.2.6) so the client surface is unchanged. The `updateTripBasics` defensive throw (§6.1.2) does NOT apply to the live-edit path because live-edit goes through `tripsService.updateLiveTripFields` → `biz_update_live_trip` RPC, not through `updateTripBasics`. Verify this routing during implement.

### 7.2 Hook layer — `useUpdateLiveTripFields` (`mingla-business/src/hooks/useTrips.ts:339-373`)

No change. The hook is RPC-shape-agnostic. Cache invalidation already invalidates the trip query key on success — verify it does, and add the invalidation if missing.

---

## 8. Strict-grep CI gate

### 8.1 New file: `.github/scripts/strict-grep/i-proposed-trip-capacity-single-source.mjs`

Mirror the pattern of `i-proposed-finalize-callers-pass-installment-params.mjs`. Behaviour:

- **Forbidden pattern A** (literal substring, case-sensitive): `business_trip.capacity` and `business_trip'.capacity` and `business_trip"->>'capacity'` inside ANY file matching `**/*.{ts,tsx,js,jsx,sql}` under `mingla-business/src/`, `app-mobile/src/`, `supabase/functions/`, `supabase/migrations/`, `mingla-admin/src/`. Catches: TS property access, SQL JSONB extraction in both syntaxes.
- **Forbidden pattern B**: any `update` payload containing `theme.business_trip.capacity` (TS spread shape) outside the allowlist — covered by Pattern A.

### 8.2 Allowlist

- **The migration file itself** (`supabase/migrations/20260725000000_orch_0950_trip_capacity_single_source.sql`) — it must reference the key to strip it. Allowlist by exact filename.
- **`updateTripBasics` defensive throw** (`mingla-business/src/services/tripsService.ts`) — references `capacity` inside a string literal in the error message. Allowlist via inline tag comment: `// orch-strict-grep-allow trip-capacity-defensive-throw` on the lines that mention the forbidden token. The gate must skip lines tagged within 5 lines above.
- **Migrations PRIOR to the cutover migration** (anything before `20260725000000_*`) — historical SQL is preserved as audit trail; CI gate scans only files >= cutover timestamp OR uses an explicit exclusion list of pre-cutover migration filenames. Implementor's choice; prefer explicit exclusion list for stability.

### 8.3 Self-test file: `.github/scripts/strict-grep/i-proposed-trip-capacity-single-source.test.mjs`

Test cases:
- Fixture file under a `__fixtures__/` dir containing `theme.business_trip.capacity` → gate exits 1.
- Fixture file containing the allowlist tag above the forbidden line → gate exits 0.
- Allowlisted migration filename → gate exits 0.
- File with `business_trip.destination_location_text` (unrelated key) → gate exits 0.

### 8.4 Workflow plug-in

Add ONE job to `.github/workflows/strict-grep-mingla-business.yml` per `feedback_strict_grep_registry_pattern.md`. Do NOT create a parallel workflow file.

```yaml
  trip-capacity-single-source:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Run I-PROPOSED-TRIP-CAPACITY-SINGLE-SOURCE gate
        run: node .github/scripts/strict-grep/i-proposed-trip-capacity-single-source.mjs
      - name: Self-test
        run: node .github/scripts/strict-grep/i-proposed-trip-capacity-single-source.test.mjs
```

### 8.5 Strict-grep ORCH-allowlist registry update

Per `feedback_close_commit_precommit_checks.md`, the touched files under `supabase/migrations/` and the new gate must be added to `ORCH_NNNN_BACKEND_ALLOWLIST` in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` in the SAME CLOSE commit. List for the implementor:
- `supabase/migrations/20260725000000_orch_0950_trip_capacity_single_source.sql`

(No edge function under `supabase/functions/` is touched, so no further allowlist entries.)

---

## 9. Invariant codification

Add to `Mingla_Artifacts/INVARIANT_REGISTRY.md`:

> **I-PROPOSED-TRIP-CAPACITY-SINGLE-SOURCE** (DRAFT → ACTIVE on ORCH-0950 CLOSE):
> Trip capacity is stored ONLY in `ticket_types.quantity_total`. Code that writes
> or reads `events.theme.business_trip.capacity` for trip-capacity purposes is
> forbidden. Service-layer aliases (e.g. `TripBusinessTrip.capacity` TypeScript
> field) are permitted ONLY when they source the value from
> `ticket_types.quantity_total` via join. Enforced by
> `.github/scripts/strict-grep/i-proposed-trip-capacity-single-source.mjs` CI gate.
> Established by ORCH-0950 [Trip capacity dual-source-of-truth bug].

---

## 10. Decision log entry

Add to `Mingla_Artifacts/DECISION_LOG.md` (next DEC#):

> **DEC-XXX (ORCH-0950, 2026-05-24):** `ticket_types.quantity_total` is the canonical
> trip-capacity column. `events.theme.business_trip.capacity` is decommissioned —
> stripped from all rows, write paths removed, CI gate forbids reintroduction.
> **Rationale:** dual-source storage drifted silently on every post-publish edit
> because `biz_update_live_trip` wrote only to JSONB while
> `biz_ticket_checkout_create_session` read only from the integer column. Buyer-web
> hit `ticket_capacity_exceeded` 409s on trips whose planner thought capacity had
> been raised. Operator chose root-cause unification (Option D) over a soft-cutover
> column. Supersedes the implicit dual-write pattern from ORCH-0824 [Trip publish] /
> ORCH-0859 [Trip publish RPC fork] / ORCH-0876 [Trip published-edit].

---

## 11. Test plan (satisfies ORCH-0840 [Regression-test enforcement + append-only CI])

### 11.1 Implementor happy-path regression test

**File:** `supabase/functions/_test/orch_0950_trip_capacity_canonical.test.ts`
(Implementor may choose a different deno-test path under `supabase/functions/` if a better-located equivalent exists; the canonical pattern is per-RPC tests under `_test/`. Confirm at implement time.)

**Behaviour to assert:**
1. Seed a trip with `ticket_types.quantity_total = 50` and zero sold tickets.
2. Call `biz_update_live_trip` with `p_patch = {"theme": {"business_trip": {"capacity": 100}}}`.
3. Assert `ticket_types.quantity_total` is now `100`.
4. Assert `events.theme.business_trip` does NOT contain a `capacity` key (verifies strip-on-write).
5. Assert `biz_ticket_checkout_create_session` for the same trip with `quantity = 80` returns success (would have thrown `ticket_capacity_exceeded` pre-fix).

**Fails-on-revert proof:** the implementor MUST capture `fails-on-revert verified at <commit hash>` in the implementation report. To verify: revert the migration's RPC rewrite section (§4.2.6) locally, re-run the test, confirm it FAILS at assertion (3) or (5).

### 11.2 Tester adversarial regression test (DIFFERENT angle)

**File:** `mingla-business/src/services/__tests__/tripsService.updateTripBasics.capacity_throws.test.ts`

**Different angle:** the implementor test verifies the SQL-side reroute works. The tester adversarial test verifies the CLIENT-side guardrail in `updateTripBasics` (§6.1.2): any code that still tries to write capacity through the wrong service path MUST fail loudly.

**Behaviour to assert:**
1. Mock the supabase client.
2. Call `updateTripBasics(eventId, { businessTrip: { capacity: 99 } })`.
3. Assert it throws an Error whose message contains `ORCH-0950: trip capacity must be routed through updateTripPricing`.
4. Confirm no `supabase.from("events").update(...)` call was made (the throw happens before the network call).

This is adversarial because it attacks the OTHER direction (client-side enforcement, not server-side reroute) and would NOT be caught by the implementor's RPC test even if the client throw were missing.

### 11.3 No `.github/workflows/tests-append-only.yml` exception needed

Both tests are net-new files. They land green and become immutable per the append-only gate.

---

## 12. Success criteria (numbered, falsifiable)

| # | Criterion | Verification |
|---|---|---|
| SC-01 | After applying the migration, zero trip rows have a `capacity` key inside `theme.business_trip` JSONB. | SQL probe: `SELECT count(*) FROM events WHERE event_type='trip' AND deleted_at IS NULL AND (theme->'business_trip') ? 'capacity'` returns 0. |
| SC-02 | After applying the migration, every trip row's `ticket_types.quantity_total` equals `MAX(prior_theme_capacity, prior_quantity_total)` for rows that drifted. | Captured in pre-flight drift report + post-backfill probe in the migration. |
| SC-03 | Calling `biz_update_live_trip` with a capacity patch writes `ticket_types.quantity_total` and does NOT add `capacity` to `events.theme.business_trip`. | Implementor regression test (§11.1) assertions 3 and 4. |
| SC-04 | After a planner edits capacity on a published trip via the iOS/Android/web-preview UI, a buyer attempting checkout for any quantity ≤ new-capacity-minus-sold succeeds (no 409). | Tester live-fire on DC Adventure successor or any seeded trip. iOS sim + Android emu + web. |
| SC-05 | `business_publish_trip_draft` rejects a new trip publish if `ticket_types.quantity_total` is null or ≤ 0, with `trip_capacity_required`. | Implementor unit test on the publish RPC. |
| SC-06 | Calling `updateTripBasics(eventId, { businessTrip: { capacity: N } })` throws the ORCH-0950 error before any network call. | Tester adversarial test (§11.2). |
| SC-07 | The strict-grep gate `i-proposed-trip-capacity-single-source` fails CI on a fixture line containing `theme.business_trip.capacity` and passes on the allowlisted migration. | Self-test (§8.3) green. |
| SC-08 | The trip dashboard KPI tile (`mingla-business/app/trip/[id]/index.tsx:298-301`) renders `${travelersCount} / ${trip.businessTrip.capacity}` with `capacity` resolving to the current `ticket_types.quantity_total` after a planner edit. | Tester live-fire — edit capacity → reload dashboard → tile updates. |
| SC-09 | Trip-create wizard Step 1 capacity input change autosaves via `updateTripPricing` (writes `ticket_types.quantity_total`), not `updateTripBasics`. | Tester live-fire — create a fresh draft trip, watch network panel for `ticket_types` UPDATE after typing in Step 1 capacity. |
| SC-10 | No regression to other trip-publish or trip-edit flows: trip title, description, destination, dates, inclusions, days, pricing tier name + price all continue to behave as before. | Tester regression sweep on trip CRUD. |

---

## 13. Implementation order

1. Write the migration file (§4.2.1 → §4.2.8) end-to-end. Do NOT apply it.
2. Write the strict-grep gate (§8.1) + self-test (§8.3) + workflow plug-in (§8.4).
3. Update `tripsService.ts` (§6.1.1, §6.1.2).
4. Update `TripCreatorWizard.tsx` autosave routing (§7.1).
5. Write the implementor happy-path regression test (§11.1).
6. Write the adversarial test scaffold (§11.2) — implementor scaffolds, tester re-authors the actual adversarial assertions in their own pass.
7. Run `node .github/scripts/strict-grep/i-proposed-trip-capacity-single-source.mjs` and `.test.mjs` locally → green.
8. Run all existing strict-grep gates locally → green (`bash .github/scripts/strict-grep/run-all.sh` or equivalent).
9. Run touched-file TS type-check → green.
10. Write `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0950_TRIP_CAPACITY_SINGLE_SOURCE.md` with old→new receipts, file list, commit hash, fails-on-revert hash.
11. Add the migration filename to `ORCH_NNNN_BACKEND_ALLOWLIST` in `orch-0863-marketing-hub-phase-b.mjs` (§8.5).
12. Hand back to orchestrator. Do NOT run `supabase db push`. Do NOT deploy any edge function.

---

## 14. Regression prevention

- **CI gate:** strict-grep `i-proposed-trip-capacity-single-source` blocks future code that writes or reads `theme.business_trip.capacity` for trip purposes.
- **Migration completeness:** §4.2.4 strip + §4.2.5 verification probe guarantee no row escapes the cutover, even in CI test environments restoring from older dumps.
- **Service-layer throw:** `updateTripBasics` throws if any caller still tries the old path (§6.1.2) — catches dev-time regressions before they ship.
- **Memory record:** at CLOSE, add `feedback_trip_capacity_canonical_in_ticket_types.md` to Claude memory (orchestrator owns this Step 5a action under the Deprecation CLOSE Protocol Extension — capacity column is decommissioned from JSONB).

---

## 15. Out of scope (do NOT touch)

- ORCH-0946 [Buyer-web sold-out gate `quantityTotal` vs remaining mismap] — separate root cause; separate PR.
- ORCH-0947 [Trip dashboard KPI "spots" tile counts orders not tickets] — separate root cause; separate PR.
- Event-side (`event_type = 'event'`) capacity columns or RPCs — only `trip` events touched.
- Multi-tier trip pricing — not a current product reality; the join assumes 1:1.
- UI redesign of any capacity input — only data wiring changes.
- Service-layer field name changes — `TripBusinessTrip.capacity` (TypeScript) stays as-is; only its source changes.
- Any `supabase db push` from implementor or orchestrator — operator owns DB push.

---

## 16. Blast radius reconfirmation

Re-walked the investigation report's blast radius map during spec-writing. One clarification surfaced:

- The publish RPC named in the investigation as `biz_publish_event` at `20260604000001_orch_0824_publish_rpc.sql:423-426` is actually the EVENT publish RPC. The TRIP publish RPC is `business_publish_trip_draft` at `20260608000100_orch_0859_publish_rpc_trip.sql`. Trip publish does NOT write `quantity_total` directly — ticket_types is maintained pre-publish via `updateTripPricing`. The validation source change in §4.2.7 is the correction. This refinement does NOT widen scope; it locates the existing scope correctly. No discovery to escalate.

Nothing else new emerged. Scope holds.

---

## 17. Confidence

**HIGH.** Investigation evidence is complete, operator direction is locked, all RPC and service-layer file locations confirmed against current code in the worktree. The single clarification (publish RPC location) sharpens the spec without changing its shape.

---

## Next-Handoff target

After orchestrator REVIEW + APPROVE: dispatch IMPLEMENT to Codex `implementor-mingla` (default per Canonical Pipeline Routing — operator may redirect to Claude `mingla-implementor`).

## Where we were

Orchestrator dispatched SPEC for ORCH-0950 [Trip capacity dual-source-of-truth bug] into the just-spawned worktree. Investigation was already complete with operator-locked direction Option D (strip JSONB, make `ticket_types.quantity_total` canonical). My job was to turn that into a contract the implementor can execute without judgment calls.

## What we just did

- Read the implicated migrations to confirm exact RPC signatures and capacity sites: `business_publish_trip_draft` (trip publish — ORCH-0859), `biz_update_live_trip` (edit live trip — ORCH-0876), `biz_ticket_checkout_create_session` (checkout gate — already correct).
- Read `tripsService.ts:328-798` to confirm reader (`readBusinessTrip`), writer (`updateTripBasics` theme path, `updateTripPricing` ticket_types path), and the placeholder `quantity_total: 1` in `createTripDraft`.
- Surfaced one investigation refinement: investigation cited `biz_publish_event` (events RPC) as the publish dual-writer; the actual TRIP publish RPC is `business_publish_trip_draft` and it does NOT write `quantity_total` (ticket_types is maintained pre-publish via `updateTripPricing`). Scope unchanged; spec locates the validation source change correctly.
- Resolved Hard Guard #8 (wizard autosave routing): Step 1 capacity input autosaves through `updateTripPricing`, not `updateTripBasics`. Justification one-sentence in §7.
- Wrote the spec at `Mingla_Artifacts/specs/SPEC_ORCH-0950_TRIP_CAPACITY_SINGLE_SOURCE.md` — 17 sections: Cross-Surface Declaration, atomic migration (pre-flight invariant probe + drift report + MAX backfill + JSONB strip + post-strip verification + two RPC rewrites + comment update), service-layer changes with defensive client-side throw, wizard autosave reroute, new strict-grep gate `i-proposed-trip-capacity-single-source` with self-test fixtures, ORCH-0840 regression-test pair (implementor happy-path + tester adversarial attacking the DIFFERENT angle of client-side guardrail), 10 numbered success criteria, 12-step implementation order, regression prevention, explicit out-of-scope list, blast radius reconfirmation.

## Outcome for the user + how to smoke-test on the app

**Outcome for the user:** no user-visible change yet — this is the spec; the implementor builds it next. Once shipped, planners bumping a published trip's capacity will see buyer checkout accept the new ceiling immediately, and the DC-Adventure-style 409 `ticket_capacity_exceeded` mismatch becomes structurally impossible (CI gate forbids the dual-storage pattern).

**Review steps (no app build yet):**
1. Skim §1 Cross-Surface Declaration — confirm the surface scope matches your intent (business iOS/Android/web preview + buyer-web; consumer + admin NOT in scope).
2. Skim §4.2 migration structure — confirm the MAX backfill rule, the atomic ordering (probe → report → reconcile → strip → verify → RPC rewrites), and the `business_publish_trip_draft` validation reroute in §4.2.7.
3. Skim §7 wizard autosave routing decision — confirm you want Step 1 capacity to autosave through `updateTripPricing` (the canonical-owner path), with the sync effect at line 424-429 staying as a pure UI mirror.
4. Skim §11 test plan — confirm the implementor's happy-path test (server-side reroute proof) and tester's adversarial test (client-side guardrail throw) attack distinct angles per ORCH-0840.
5. Skim §15 out-of-scope — confirm ORCH-0946 and ORCH-0947 stay carved out (independent ORCHs, separate PRs).

## Exact handoff message

NEXT HANDOFF — paste into Codex `implementor-mingla`:

Implement the spec at `Mingla_Artifacts/specs/SPEC_ORCH-0950_TRIP_CAPACITY_SINGLE_SOURCE.md` for ORCH-0950 [Trip capacity dual-source-of-truth bug] following the investigation at `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0950_TRIP_CAPACITY_DUAL_SOURCE.md`. Working tree: `~/Desktop/mingla-orchs/ORCH-0950-[trip-capacity-single-source]/` on branch `ORCH-0950-trip-capacity-single-source`. Execute the 12-step implementation order in §13 exactly: write the atomic migration (`supabase/migrations/20260725000000_orch_0950_trip_capacity_single_source.sql`) with pre-flight invariant probe + drift report + MAX backfill + JSONB strip + post-strip verification + `biz_update_live_trip` rewrite + `business_publish_trip_draft` validation reroute + comment updates per §4.2; create the strict-grep gate `i-proposed-trip-capacity-single-source.mjs` + self-test + workflow plug-in per §8; update `tripsService.ts` per §6.1 (thread `tickets[0]?.quantity_total` into `readBusinessTrip`; add the defensive throw in `updateTripBasics` when `patch.businessTrip.capacity !== undefined`); reroute `TripCreatorWizard.tsx` Step 1 capacity autosave to `updateTripPricing` per §7.1; write the happy-path regression test under `supabase/functions/_test/` per §11.1 with fails-on-revert proof captured in your report; scaffold the adversarial test per §11.2 (tester re-authors assertions later); add the migration filename to `ORCH_NNNN_BACKEND_ALLOWLIST` in `orch-0863-marketing-hub-phase-b.mjs`. Hard guards: do NOT run `supabase db push` (operator owns DB push), do NOT deploy any edge function (none touched), do NOT touch ORCH-0946 or ORCH-0947 scope, do NOT alter checkout RPC (already correct), do NOT widen beyond the 10 success criteria in §12. Produce `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0950_TRIP_CAPACITY_SINGLE_SOURCE.md` with old→new receipts, file list, commit hash, and the `fails-on-revert verified at <commit hash>` line. Downstream: operator applies migration via `supabase db push --linked` → orchestrator verifies via `mcp__supabase__list_migrations` → Claude `mingla-tester` for QA with mandatory iOS sim + Android emu + buyer-web parity + DC-Adventure-style live-fire on a seeded trip → Claude `mingla-orchestrator` for CLOSE via PR on this per-ORCH branch to main → reap.
