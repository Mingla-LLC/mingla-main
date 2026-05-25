# SCOPE EXPANSION — ORCH-0950 Trip Capacity Single Source

**Date:** 2026-05-24
**Source:** ORCH-0947 [Trip dashboard Spots tile counts tickets, not orders] close session (PR #199 merged)
**Author:** Claude `mingla-orchestrator`
**Operator directive:** "expand 0950" — fold these newly-surfaced symptoms into the existing ORCH-0950 fix so the planner dashboard ends up end-to-end coherent in one PR.

## Why this addendum exists

After ORCH-0947 merged and the EAS OTA shipped, live-fire on DC Adventure (event `060d0483-50db-48d1-840b-73d9fc59356a`, business iOS) revealed that the existing ORCH-0950 implementation has NOT fully closed the dashboard-side gap. The numerator (tickets sold) is now canonical via ORCH-0947's `biz_trip_tickets_sold(p_event_id)` RPC, but the denominator (capacity) is still read from the JSONB blob, and that blob is currently empty on DC Adventure. Result: `71` shows with no `/ 100` suffix.

This addendum enumerates every symptom observed in that session so the next ORCH-0950 implementation pass (or its tester) fixes them in one consolidated PR, instead of three follow-up patches.

## Symptoms to fold into ORCH-0950 scope

### Symptom A — Spots KPI denominator missing on dashboard

**Observed:** Business iOS dashboard for DC Adventure renders `SPOTS 71` with no `/ N` suffix.
**Cause:** Dashboard at `mingla-business/app/trip/[id]/index.tsx:298-302` renders the null-branch of `trip.businessTrip.capacity !== null ? \`${ticketsSold} / ${capacity}\` : \`${ticketsSold}\``. The capacity field is null because `readBusinessTrip(theme)` in `mingla-business/src/services/tripsService.ts:327-345` reads `theme -> business_trip -> capacity`, and that blob is empty.
**Fix required:** route the dashboard's denominator through the canonical `ticket_types.quantity_total` column (per ORCH-0950's direction) instead of the JSONB path.

### Symptom B — `events.theme.business_trip` JSONB blob completely wiped on DC Adventure

**Observed:** SQL probe 2026-05-24 17:36 UTC:
```sql
SELECT theme->'business_trip' FROM events WHERE id = '060d0483-50db-48d1-840b-73d9fc59356a';
-- returns: {}
```
The entire blob is `{}`, not just `capacity`. This means `bookingDeadline`, `startAt`, `endAt`, and every other field that lives inside that JSONB key is also lost on this trip.
**Cause hypothesis:** a writer somewhere is doing `jsonb_set(theme, '{business_trip}', '{}'::jsonb)` (wholesale replace) instead of merging in only the changed keys, OR the edit RPC has a regression that strips siblings during a capacity write. Needs forensics on the writer chain.
**Fix required:** investigate every writer that touches `events.theme -> business_trip`; ensure none wholesale-replace. If ORCH-0950's "strip capacity from JSONB" migration also strips the orphaned blob entirely, that's the cleanest end state.
**Migration consideration:** the data-migration step that moves any remaining capacity values out of JSONB should be defensive enough to handle the case where the blob is already empty or missing (don't error on null).

### Symptom C — Trip header shows "Date TBD" on an upcoming trip

**Observed:** Business iOS dashboard for DC Adventure shows "Date TBD" as the subtitle under the trip title.
**Cause hypothesis:** likely downstream of Symptom B — `startAt`/`endAt` live inside the wiped JSONB blob. Needs SQL verification:
```sql
SELECT theme->'business_trip'->'startAt' AS bt_start,
       theme->'business_trip'->'endAt'   AS bt_end,
       starts_at, ends_at,
       theme
FROM events WHERE id = '060d0483-50db-48d1-840b-73d9fc59356a';
```
If `theme.business_trip.startAt` is null but `events.starts_at` (column) has a value, the dashboard's date reader is reading the wrong path — same architectural bug class as capacity.
**Fix required:** if confirmed, route the dashboard's date reader through `events.starts_at`/`events.ends_at` columns instead of the JSONB blob. Same single-source-of-truth principle as capacity. Folds naturally into ORCH-0950's reader-canonicalization pass.

### Symptom D — Standard tier card shows `0 / 100` but DB says `quantity_total = 102`, and 71 sold means `31 remaining`

**Observed:** Business iOS dashboard "PRICING TIERS" section renders Standard tier as `0 / 100`. DB SQL says `quantity_total = 102` for that ticket_type. With 71 tickets sold, remaining = 31. Neither number on screen matches reality.
**Two sub-bugs:**
- **D-1 (denominator):** Card shows `100`, DB says `102`. Source of the `100` is unknown — likely a stale client cache, a hardcoded fallback, or a different reader path. **Folds into ORCH-0950 scope** — canonicalize this reader through `ticket_types.quantity_total`.
- **D-2 (numerator):** Card shows `0` remaining instead of `31`. This is ORCH-0946 planner-side mirror territory — ORCH-0946 added `ticketsRemaining` plumbing for buyer-web; the planner-side tier card may be reading it wrong or not reading it at all. **Investigation required** to decide if this folds into ORCH-0950 or spins off as new ORCH-0958.

**Recommended investigation step (5 min):** read `mingla-business/app/trip/[id]/index.tsx` or whichever file renders the Pricing Tiers section, identify which field the tier card consumes, and probe whether it's reading `ticketsRemaining` (from ORCH-0946) or a stale field. If the bug is "uses a stale field" → fold into 0950 (same reader-canonicalization). If the bug is "ticketsRemaining is fetched but planner-side mapper drops it" → spin off as ORCH-0958 [planner tier card remaining count].

### Observation (not in scope) — DC Adventure `quantity_total` drift

**Observed:** Operator manually `UPDATE ticket_types SET quantity_total = 100` at 16:47 UTC. SQL probe at 17:36 UTC returned `102`. Drifted by +2 with no operator action in between.
**Cause hypothesis:** either operator nudged the capacity slider again, or there's an automated writer (refund unwinding capacity? rebalance trigger?) bumping it. Low priority. Not in ORCH-0950 scope unless investigation surfaces a real bug.

## Consolidated ORCH-0950 scope (after expansion)

The single PR for ORCH-0950 should now cover:

1. **Original scope** (already specced): edit RPC + publish RPC + service-layer reader all unified on `ticket_types.quantity_total`; strip `capacity` from `theme.business_trip` JSONB; `I-PROPOSED-TRIP-CAPACITY-SINGLE-SOURCE` strict-grep gate.
2. **Symptom A fix:** dashboard `readBusinessTrip()` / `trip.businessTrip.capacity` reader plumbing — route through canonical column. Spots KPI shows `${ticketsSold} / ${canonicalCapacity}` end-to-end.
3. **Symptom B investigation + fix:** identify the writer wholesale-replacing `theme.business_trip`. Either fix that writer to merge instead of replace, or — better — eliminate the JSONB key entirely as part of the canonicalization migration.
4. **Symptom C fix (if SQL confirms):** date reader on dashboard moves to `events.starts_at` / `events.ends_at` columns.
5. **Symptom D-1 fix:** tier card denominator reader routes through canonical column.
6. **Symptom D-2:** decision pending after 5-min investigation. Folds in if it's a stale-reader bug; spins off as ORCH-0958 if it's an ORCH-0946 plumbing bug.

## Test plan additions

- **DC Adventure live-fire post-merge:** Spots KPI reads `71 / 102` (or whatever the live numbers are at merge time, with denominator non-null). Standard tier card reads accurate remaining.
- **JSONB blob check:** post-migration, `events.theme -> business_trip` should not contain `capacity`. Optionally the entire `business_trip` key should be removed if it has no remaining fields after symptoms B + C are resolved.
- **Regression test for wholesale-replace bug:** a test that exercises the edit RPC, then asserts that OTHER theme.business_trip fields are preserved (if the blob is kept) or doesn't exist (if the blob is removed entirely).

## Cross-references

- **ORCH-0947 close commit:** `9097ce61` on main (`Close ORCH-0947 [TEST-MOD-APPROVED ORCH-0947] [deploy]: trip dashboard Spots tile counts tickets, not orders`).
- **ORCH-0947 QA report:** `Mingla_Artifacts/reports/QA_ORCH-0947_TRIP_SPOTS_TICKETS_NOT_ORDERS.md` on main.
- **ORCH-0947 invariant established:** `I-TRIP-SPOTS-MIRRORS-CAPACITY-GATE` — extends naturally to ORCH-0950's canonical-capacity principle.
- **Live verification SQL** (use to re-confirm post-0950-merge):
  ```sql
  SELECT id, title, theme->'business_trip' AS bt_blob,
         (SELECT json_agg(json_build_object('id', id, 'quantity_total', quantity_total))
          FROM public.ticket_types WHERE event_id = '060d0483-50db-48d1-840b-73d9fc59356a') AS ticket_types
  FROM public.events
  WHERE id = '060d0483-50db-48d1-840b-73d9fc59356a';
  ```

## Routing

Next dispatch on ORCH-0950: SPEC update (or implementor REWORK if the existing implementation is close enough to extend) covering symptoms A, B, C, D-1, plus the 5-min D-2 investigation that decides folding vs spinning off. Target: Claude `mingla-forensics` (SPEC) or Codex `implementor-mingla` (REWORK) — operator's call.
