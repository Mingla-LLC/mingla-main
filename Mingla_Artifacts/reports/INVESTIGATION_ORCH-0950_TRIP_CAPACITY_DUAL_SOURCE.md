# INVESTIGATION — ORCH-0950 [Trip capacity dual-source-of-truth bug]

**Investigator:** Claude `mingla-forensics` (INVESTIGATE mode)
**Date:** 2026-05-24
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Mode:** Source-only code-trace investigation (the bug fires on a production data path; live-fire reproduction was the operator's INTAKE evidence — not the investigator's).
**Operator-chosen fix direction:** Option D (root cause — single canonical column).

---

## Symptom summary (expected vs actual)

**Expected:** when a trip planner edits the trip's "max travelers" / capacity field on the edit-published-trip screen, the new capacity takes effect immediately for buyer checkout. The planner dashboard and the buyer-web checkout gate agree on the same number.

**Actual:** the planner UI's edit lands in one storage location; the checkout RPC reads from a different location. The two diverge silently on every post-publish capacity edit. Planner dashboard shows the new value (e.g. 100); buyer checkout still enforces the old value (e.g. 55) and throws HTTP 409 `ticket_capacity_exceeded` for any purchase quantity once the old cap is hit.

**Live-fire evidence (production, 2026-05-24):**
- Trip "The DC Adventure" (event_id `060d0483-50db-48d1-840b-73d9fc59356a`)
- `events.theme -> 'business_trip' -> 'capacity'` = **100** (updated 2026-05-24 16:28 UTC via planner UI by operator)
- `ticket_types.quantity_total` (ticket_type_id `d9ec94b7-e1ee-42ad-aeca-cd9c1d8b440e`) = **55** (untouched since 2026-05-18 publish)
- 55 tickets currently with status `valid` (sold).
- Buyer attempts to purchase 6 Standard tickets → checkout returns 409 `ticket_capacity_exceeded` (the misleading "Edge Function returned a non-2xx status code" in the buyer-web UI).

**Immediate prod unblock (one-off; applied this session):**
```sql
UPDATE ticket_types
SET quantity_total = 100, updated_at = NOW()
WHERE id = 'd9ec94b7-e1ee-42ad-aeca-cd9c1d8b440e';
```
Applied 2026-05-24 16:47 UTC. DC Adventure now 100 capacity / 55 sold / 45 remaining. Root-cause fix follows in SPEC + IMPLEMENT.

---

## Investigation manifest (files read, in trace order)

| File | Layer | Read for |
|---|---|---|
| `mingla-business/src/components/trip/TripCreatorStep1Basics.tsx:373-386` | Component | Trip-creation capacity input field + onChange handler |
| `mingla-business/src/components/trip/TripCreatorStep4Pricing.tsx:181-188` | Component | Trip-creation Step 4 capacity display (confirmed read-only mirror) |
| `mingla-business/src/components/trip/TripCreatorWizard.tsx:424-429, 512-534, 558-569` | Component | Wizard state sync + autosave handlers per step |
| `mingla-business/src/services/tripsService.ts:342, 590-638, 708-798, 942-1005` | Service | `readBusinessTrip`, `updateTripBasics`, `updateTripPricing`, `updateLiveTripFields` |
| `mingla-business/src/components/trip/EditPublishedTripScreen.tsx:180, 301-304, 482, 989-1005` | Component | Edit-published-trip capacity input + patch building + mutation hook |
| `mingla-business/src/hooks/useTrips.ts:339-373` | Hook | `useUpdateLiveTripFields` mutation wrapper |
| `supabase/migrations/20260604000001_orch_0824_publish_rpc.sql:423-426` | RPC | `biz_publish_event` capacity write — confirmed dual write at publish time |
| `supabase/migrations/20260616000000_orch_0876_trip_published_edit.sql:215-388, 417-435` | RPC | `biz_update_live_trip` — confirmed single write to theme JSONB only |
| `supabase/migrations/20260610000002_tr3_ticket_checkout_session_installment_aware.sql:180-260` | RPC | `biz_ticket_checkout_create_session` capacity gate — confirmed reads `ticket_types.quantity_total` only |
| `mingla-business/app/trip/[id]/index.tsx:290-301` | Component | Trip dashboard KPI tile reading `trip.businessTrip.capacity` — downstream consumer |

---

## 5-layer cross-check

| Layer | What it sees | Source of truth used |
|---|---|---|
| **Docs** | No spec explicitly names which column is canonical. Implicit assumption in ORCH-0824 [Trip publish] spec was that publish RPC's dual-write keeps them in sync; no spec covers post-publish edits' obligation to maintain that sync. | (gap) |
| **Schema** | TWO columns exist: `events.theme -> 'business_trip' -> 'capacity'` (JSONB, declared by trip-feature migrations) AND `ticket_types.quantity_total` (integer, top-level). No constraint, no trigger, no foreign-key relationship binds them. | Both exist independently. |
| **Code (trip-create wizard)** | Step 1 autosave → `updateTripBasics` → writes `events.theme.business_trip.capacity` ONLY. Step 4 autosave → `updateTripPricing` → writes `ticket_types.quantity_total` ONLY. Sync via wizard UI effect (`TripCreatorWizard.tsx:424-429`) keeps the two drafts visually equal but does NOT guarantee both autosaves complete. The publish RPC at finalize-time writes BOTH from the canonical event-level source, masking any intermediate drift. | Publish-time RPC is the implicit reconciliation point. |
| **Code (edit-published-trip)** | Capacity input on edit screen builds `patch.theme.business_trip.capacity` only (`EditPublishedTripScreen.tsx:301-304`); patch never includes anything ticket-type level. Service routes to `biz_update_live_trip` RPC which merges `p_patch.theme` into `events.theme` (lines 355-388) and updates pricing-tier fields (lines 417-435) — but pricing-tier section only writes `tier_name`, `tier_metadata`, and `ticket_types.price_cents`. **Never writes `ticket_types.quantity_total`.** | Edit RPC drops the dual-write entirely. |
| **Code (checkout RPC)** | `biz_ticket_checkout_create_session` capacity gate at lines 217-238 reads `v_ticket_type.quantity_total` (from `ticket_types`) + sums `tickets.status IN ('valid','used','transferred')` + sums active session reservations. Throws `ticket_capacity_exceeded` if `sold + reserved + requested > quantity_total`. **Never reads `events.theme.business_trip.capacity`.** | Checkout enforces `ticket_types.quantity_total`. |
| **Runtime** | Operator's edit at 16:28 UTC: PATCH on event row → `events.theme` JSONB merge → success. `ticket_types.quantity_total` untouched. Next buyer checkout attempt at 16:31 UTC: capacity gate sees 55 sold + 0 reserved + 6 requested = 61 > 55 → 409. | Drift confirmed. |
| **Data** | Production query 2026-05-24 16:35 UTC confirmed: `events.theme.business_trip.capacity = 100`, `ticket_types.quantity_total = 55`. After manual UPDATE at 16:47: both = 100. | Two columns can diverge arbitrarily; manual sync required. |

**Contradictory layers:** Code (edit-published-trip) and Code (checkout RPC) reference different columns for what should be the same logical concept ("trip capacity"). No layer reconciles them. The dual-write at publish-time is the only thing that ever made them match at all.

---

## Findings

### 🔴 Root Cause — Edit RPC writes ONLY to `events.theme.business_trip.capacity`; checkout RPC reads ONLY `ticket_types.quantity_total`

| Field | Value |
|---|---|
| **File + line** | `supabase/migrations/20260616000000_orch_0876_trip_published_edit.sql:215-388` (the `biz_update_live_trip` RPC); checkout-side at `supabase/migrations/20260610000002_tr3_ticket_checkout_session_installment_aware.sql:217-238` |
| **Exact code (edit RPC)** | ```sql\nv_new_business_trip := COALESCE(p_patch->'theme'->'business_trip', '{}'::jsonb);\nIF v_new_business_trip ? 'capacity' THEN\n  v_old_capacity := NULLIF(v_business_trip->>'capacity', '')::int;\n  v_new_capacity := NULLIF(v_new_business_trip->>'capacity', '')::int;\n  -- ... refund-gate check ...\nEND IF;\n-- ... later, the actual write:\nUPDATE events SET\n  theme = CASE WHEN p_patch ? 'theme' THEN theme || (p_patch->'theme') ELSE theme END,\n  -- ... no ticket_types update for capacity anywhere\n;\n```|
| **Exact code (checkout RPC)** | ```sql\nIF v_ticket_type.quantity_total IS NOT NULL\n   AND v_sold + v_reserved + v_qty > v_ticket_type.quantity_total THEN\n  RAISE EXCEPTION 'ticket_capacity_exceeded';\nEND IF;\n```|
| **What it does** | Edit RPC merges the new capacity into `events.theme` JSONB only. Checkout RPC reads `ticket_types.quantity_total` only. The two columns drift on every edit; checkout enforces the stale value. |
| **What it should do** | A single canonical column (Option D: `ticket_types.quantity_total`) read + written by all paths. No JSONB blob storage of capacity; no dual-write. |
| **Causal chain** | (1) Planner taps capacity input on edit screen → (2) `EditPublishedTripScreen.tsx:993-997` calls `updateBasics({ capacity: n })` → (3) `EditPublishedTripScreen.tsx:301-304` builds `patch.theme.business_trip.capacity = n` → (4) `tripsService.updateLiveTripFields()` posts patch to `biz_update_live_trip` RPC → (5) RPC merges `p_patch.theme` into `events.theme` (JSONB blob) → (6) `ticket_types.quantity_total` is never touched → (7) buyer attempts checkout → (8) checkout RPC's capacity gate reads stale `ticket_types.quantity_total` → (9) 409 `ticket_capacity_exceeded`. |
| **Verification step** | (a) Query both columns before edit; (b) edit via planner UI; (c) re-query — `events.theme.business_trip.capacity` reflects edit, `ticket_types.quantity_total` does not. (d) Attempt buyer checkout for any quantity ≥ remaining-against-old-cap → 409. Performed live on DC Adventure 2026-05-24 16:28-16:31 UTC. |

### 🟠 Contributing Factor — Publish RPC's dual-write masks the design flaw during the trip's first lifecycle phase

The publish RPC (`biz_publish_event` at `supabase/migrations/20260604000001_orch_0824_publish_rpc.sql:423-426`) writes capacity to BOTH locations. This means freshly-published trips always start in sync. The drift only appears on the FIRST post-publish capacity edit. Long-lived trips that get edited multiple times accumulate divergence. Trips that are published and never edited never exhibit the bug — which probably explains why it survived undetected until today.

**Why this matters for the fix:** the publish RPC's dual-write must also collapse to a single write (writing only to `ticket_types.quantity_total`), otherwise Option D leaves a vestigial JSONB key that future code might trip over.

### 🟡 Hidden Flaw — Trip dashboard KPI tile (Q3 in operator's earlier inquiry) reads `trip.businessTrip.capacity` via `readBusinessTrip()` at `tripsService.ts:342`

The dashboard KPI tile at `mingla-business/app/trip/[id]/index.tsx:298-301` displays `${travelersCount} / ${trip.businessTrip.capacity}`. After Option D ships, `trip.businessTrip.capacity` must continue to resolve correctly — either by joining `ticket_types.quantity_total` into the trip query, or by renaming the TypeScript field to make the new source obvious. If we don't account for this in the SPEC, the dashboard tile will display stale data (or null) post-migration.

### 🔵 Observation — The trip-create wizard's "sync via effect" pattern (`TripCreatorWizard.tsx:424-429`) is a UI-level concern only

```typescript
useEffect(() => {
  if (step4Draft.capacity !== step1Draft.capacity) {
    setStep4Draft((s) => ({ ...s, capacity: step1Draft.capacity }));
  }
}, [step1Draft.capacity, step4Draft.capacity]);
```

This effect keeps Step 4's display in sync with Step 1's input — but it does NOT control which autosave handler fires. Both Step 1 and Step 4 autosaves are scheduled independently. The publish RPC reconciles the two writes at finalize time. After Option D ships, this effect can stay (still useful for UI sync) or be removed (if Step 4 simply reads the canonical state from a single source). SPEC writer's call.

---

## Blast radius map

| Direct change targets (Option D) | File / RPC | Type |
|---|---|---|
| `biz_update_live_trip` RPC | `supabase/migrations/<future>_orch_0950_capacity_canonical.sql` | rewrite — when patch includes capacity, write `ticket_types.quantity_total` |
| `biz_publish_event` RPC (trip path) | same migration | rewrite — drop the `events.theme.business_trip.capacity` write; keep only `ticket_types.quantity_total` |
| Backfill | same migration | UPDATE: reconcile divergent rows (operator-defined rule — recommend: take MAX of the two values, since capacity grows over time and divergence is always "JSONB ahead, integer behind") |
| Strip capacity from theme JSONB | same migration | one-time `UPDATE events SET theme = theme #- '{business_trip,capacity}'` |
| `tripsService.ts` `readBusinessTrip` | `mingla-business/src/services/tripsService.ts:342` | service-layer change — join `ticket_types.quantity_total` (or first ticket-type's value) and surface as `TripBusinessTrip.capacity` |
| Strict-grep gate | `.github/scripts/strict-grep/i-proposed-trip-capacity-single-source.mjs` (new) | block future code that writes `theme.business_trip.capacity` or reads it for the buyer-checkout gate |

| Downstream consumers (must continue to resolve correctly) | File | Notes |
|---|---|---|
| Trip dashboard KPI tile | `mingla-business/app/trip/[id]/index.tsx:298-301` | reads `trip.businessTrip.capacity`; works if service-layer change in `readBusinessTrip` is correct |
| Trip list cards | (per-card capacity display, where rendered) | same surface — relies on the service-layer transform |
| Trip-create wizard Step 1 input | `TripCreatorStep1Basics.tsx:373-386` | no change needed; still writes `capacity: n` to local draft |
| Trip-create wizard autosave Step 1 | `TripCreatorWizard.tsx:512-534` | needs to route capacity to `updateTripPricing` (not `updateTripBasics`) OR `updateTripBasics` needs to also write `ticket_types.quantity_total` |
| Trip-create wizard autosave Step 4 | `TripCreatorWizard.tsx:558-569` | already writes `ticket_types.quantity_total` via `updateTripPricing` — keep |
| Buyer-web sold-out badge | (related ORCH-0946) | unaffected by this ORCH; ORCH-0946 fixes a parallel reader |

| Solo / collab parity | n/a — this is a trip-publish/edit/checkout flow, no consumer-app collab dimension. |
| Cache impact | React Query keys for trip queries — invalidation already correct; no key changes. |
| State boundaries | No Zustand state involved. |

---

## Invariant violations (existing + proposed)

**Existing invariants violated:**
- **I-SINGLE-SOURCE-OF-TRUTH** (implicit, not codified): every datum has exactly one canonical write site. Violated by capacity having two writers (publish RPC + edit RPC) writing to two different columns.

**New invariants this ORCH should codify:**
- **I-PROPOSED-TRIP-CAPACITY-SINGLE-SOURCE (DRAFT → ACTIVE post-CLOSE):** trip capacity is stored ONLY in `ticket_types.quantity_total`. Code that writes or reads `events.theme.business_trip.capacity` for trip-capacity purposes is forbidden. Enforced by `.github/scripts/strict-grep/i-proposed-trip-capacity-single-source.mjs` CI gate. Service-layer aliases (e.g. `TripBusinessTrip.capacity` TypeScript field) are permitted as derived/read-through-join surfaces.

---

## Fix strategy (direction only — not a spec, not code)

**Option D — operator-chosen — root cause:** make `ticket_types.quantity_total` the canonical single source of truth.

High-level steps (SPEC will formalize):

1. **Migration phase A — backfill + strip:**
   - For every event with `event_type = 'trip'` where `(theme->'business_trip'->>'capacity')::int` ≠ first child `ticket_types.quantity_total`: reconcile (recommended rule: take MAX, since capacity edits only grow in practice).
   - UPDATE every `events.theme` row to strip the `capacity` key from the `business_trip` JSONB.
2. **Migration phase B — RPC rewrites in the same migration:**
   - `biz_update_live_trip`: when `p_patch` includes capacity in any shape, write to `ticket_types.quantity_total` (locate the row via `p_event_id`'s child ticket_types). Stop merging capacity into `events.theme`.
   - `biz_publish_event` (trip path): drop the `events.theme.business_trip.capacity` write; keep only the `ticket_types.quantity_total` write.
3. **Service-layer rewrite:**
   - `tripsService.ts:342` `readBusinessTrip`: stop reading `bt.capacity` from JSONB. Instead, the trip query joins `ticket_types` (first child or aggregate per design choice) and surfaces `quantity_total` as `TripBusinessTrip.capacity` for backward-compat with the existing TypeScript surface.
4. **Strict-grep gate:**
   - New file `.github/scripts/strict-grep/i-proposed-trip-capacity-single-source.mjs` + self-test.
   - Forbid: any `.ts/.tsx/.sql` line containing `theme.business_trip.capacity` outside of the backfill migration itself.
5. **Tests:**
   - Implementor regression: edit a published trip's capacity → confirm `ticket_types.quantity_total` reflects new value within the same RPC call; checkout RPC sees the new value on the next request.
   - Tester adversarial: directly UPDATE `events.theme` with a stray `capacity` key (simulate bad migration / data drift) → confirm next checkout still reads from `ticket_types.quantity_total` correctly (no fallback to JSONB).
   - Implementor edge case: confirm publish + immediate edit + checkout all see a consistent value.

---

## Regression prevention

- **CI gate:** strict-grep `i-proposed-trip-capacity-single-source` blocks any reintroduction.
- **Migration completeness:** the migration must include the strip-from-theme UPDATE so that fresh-environment restores don't leave stray `capacity` keys.
- **Documentation:** add an entry to `Mingla_Artifacts/INVARIANT_REGISTRY.md` for `I-PROPOSED-TRIP-CAPACITY-SINGLE-SOURCE` (DRAFT → ACTIVE at CLOSE).
- **DECISION_LOG.md:** add a DEC entry naming `ticket_types.quantity_total` as the canonical trip-capacity column post-ORCH-0950, with rationale.

---

## Discoveries for orchestrator

- **None new in this investigation.** ORCH-0946 (buyer-web sold-out gate) and ORCH-0947 (trip KPI tile counts orders not tickets) — both already registered as separate ORCHs — are parallel/adjacent bugs that surface the same end-user symptom (buyer hits sold-out wall unexpectedly) but have independent root causes. ORCH-0950's fix does NOT subsume them.
- The KPI tile (ORCH-0947) is the natural "operator-facing canary" that would have detected this bug earlier if it counted real ticket sales instead of order count. Worth sequencing ORCH-0947 alongside or before ORCH-0950 in any future polish wave.

---

## Confidence Level

**HIGH.** Every layer traced; every code path quoted; live-fire evidence from production matches the trace exactly. The bug mechanism is fully understood. The proposed fix direction (Option D) is operator-locked. SPEC writer can begin formalization without further investigation.

---

## Pipeline Status

- **INVESTIGATE:** ✅ COMPLETE (this report).
- **SPEC:** ⏳ DEFERRED — pending operator sequencing decision (sits behind ORCH-0945 close + worktree-per-ORCH cutover per the plan at `~/.claude/plans/cosmic-swimming-teacup.md`).
- **IMPLEMENT / TEST / CLOSE:** future sessions, on a per-ORCH worktree once cutover lands.
