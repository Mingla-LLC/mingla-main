# SPEC — ORCH-0947 [Trip dashboard "Spots" tile counts tickets, not orders]

**Working tree:** `~/Desktop/mingla-orchs/ORCH-0947-[trip-spots-counts-tickets]/` on branch `ORCH-0947-trip-spots-counts-tickets`
**Pipeline:** INVESTIGATE complete (WORLD_MAP 2026-05-24 entry) → **SPEC (this doc)** → IMPLEMENT (Codex `implementor-mingla` default) → operator DB push → TEST (Claude `mingla-tester`) → CLOSE (orchestrator)
**Severity:** S1-high · `bug` + `data-integrity` + `ux`
**Author:** Claude `mingla-forensics` (SPEC mode)
**Date:** 2026-05-24

---

## 1. Summary (layman)

The trip dashboard's "Spots" tile and "travelers" subtitle currently count **orders** (one number per receipt) instead of **tickets** (one number per traveler). A planner sees a comforting `14/55` while checkout is already refusing new buyers because the canonical capacity gate sees `55/55 sold`. This SPEC mirrors the canonical capacity-gate query into a new SECURITY DEFINER RPC, plumbs the integer through `getTrip()` so it's part of the trip detail payload, and swaps two display lines on the dashboard so the planner's screen tells the truth.

## 2. Scope

**In scope:**
- New SQL helper `public.biz_trip_tickets_sold(p_event_id uuid) RETURNS integer` (SECURITY DEFINER) that exactly mirrors the canonical capacity-gate query (`tickets` WHERE `status IN ('valid','used','transferred')` for the trip's `ticket_types`).
- One new migration file at `supabase/migrations/<next-ts>_orch_0947_biz_trip_tickets_sold.sql`.
- Add `ticketsSoldCount: number` to `Trip` interface in [mingla-business/src/services/tripsService.ts](mingla-business/src/services/tripsService.ts).
- Extend `getTrip()` with a 5th parallel call to the new RPC inside its existing `Promise.all`.
- Update [mingla-business/app/trip/[id]/index.tsx](mingla-business/app/trip/[id]/index.tsx) lines 290–301 and 409 to render `ticketsSoldCount` instead of `travelersCount` for both the Spots KPI tile and the "N travelers" subtitle.
- Update existing parity tests at [mingla-business/app/trip/[id]/__tests__/dashboard-parity.test.tsx](mingla-business/app/trip/[id]/__tests__/dashboard-parity.test.tsx) and the adversarial sibling to assert the new string templates. CLOSE commit body MUST cite `[TEST-MOD-APPROVED ORCH-0947]` because this modifies existing tests.
- Two new regression tests per ORCH-0840 Step 0.5 (happy-path + adversarial, see §10).

**Non-goals:**
- Capacity drift between `events.theme.business_trip.capacity` and `ticket_types.quantity_total` — that's ORCH-0950's territory. This SPEC reads `trip.businessTrip.capacity` as-is.
- Checkout RPC capacity gate — it is the source of truth we mirror, not touch.
- Reworking the Travelers tab list (`travelers/index.tsx`) — it lists orders, which is the correct semantic for "buyers list". Out of scope.
- Reworking the Money tab — its tile semantics are revenue-by-currency, not spots. Out of scope.
- Existing `biz_trip_sold_count_by_tier(p_event_id) RETURNS jsonb` helper — it sums `order_line_items.quantity` filtered by `orders.payment_status NOT IN ('failed','cancelled')`, which is DIFFERENT from the canonical capacity gate (drifts on per-ticket refunds, transfers, voids). We do NOT reuse it and we do NOT modify it (it's load-bearing for `biz_update_live_trip`'s refund gate). New helper is independent.

**Assumptions:**
- `tickets.status` enum values `'valid'`, `'used'`, `'transferred'` are the canonical "counts against capacity" set. Verified against the live capacity gate in [supabase/migrations/20260610000002_tr3_ticket_checkout_session_installment_aware.sql:223-228](supabase/migrations/20260610000002_tr3_ticket_checkout_session_installment_aware.sql#L223-L228).
- `ticket_types.deleted_at IS NULL` is the correct gate for "active tier" — matches the filter in `getTrip()` at line 536.
- The brand ownership rank check `biz_brand_effective_rank(brand_id, auth.uid()) >= biz_role_rank('event_manager')` is the correct authorization gate for read-side helpers on trip data. Precedent: `biz_update_live_trip` write-side check at [supabase/migrations/20260616000000_orch_0876_trip_published_edit.sql:201-204](supabase/migrations/20260616000000_orch_0876_trip_published_edit.sql#L201-L204). For a READ helper, we accept any rank that can read the brand (rank ≥ `viewer`) — see §5 RLS section. Implementor must confirm `'viewer'` is the correct minimum rank string by reading `biz_role_rank` definition; if not, fall back to `'event_manager'` (more restrictive, matches the dashboard's edit gate).

## 3. Bug evidence (already proven, restating for SPEC self-containment)

| Field | Value |
|---|---|
| **File + line** | [mingla-business/app/trip/[id]/index.tsx:290-301](mingla-business/app/trip/[id]/index.tsx#L290-L301) |
| **Exact code** | `const travelersCount = (ordersQuery.data ?? []).filter((o) => o.paymentStatus !== "failed" && o.paymentStatus !== "cancelled").length;` |
| **Current behavior** | Counts ORDER rows, renders `${travelersCount} / ${trip.businessTrip.capacity}` |
| **Correct behavior** | Count TICKET rows with `status IN ('valid','used','transferred')` against the trip's `ticket_types`, render `${ticketsSoldCount} / ${capacity}` |
| **Causal chain** | Buyers can purchase >1 ticket per order (live data avg ~4). With 14 orders × ~4 tickets ≈ 55 tickets. The capacity gate at the checkout RPC counts tickets correctly and refuses new buyers (`ticket_capacity_exceeded`). The dashboard counts orders and reports `14/55`. Planner believes 41 spots remain; system enforces 0. |
| **Verification** | Live evidence on trip "DC Adventure" (`060d0483-50db-48d1-840b-73d9fc59356a`) 2026-05-24: 14 orders, 55 valid tickets, RPC throws `ticket_capacity_exceeded`, dashboard shows `14/55`. |

Same bug recurs at [mingla-business/app/trip/[id]/index.tsx:409](mingla-business/app/trip/[id]/index.tsx#L409) where `travelersCount` is used as the subtitle for the action grid (`"${travelersCount} travelers"`). A 4-ticket order → 4 humans traveling, not 1. Same fix applies.

## 4. Cross-Surface Impact (mandatory per orchestrator Phase 2.5)

| Surface | In scope? | Why / what |
|---|---|---|
| Consumer iOS (`app-mobile/` on iOS) | **NO** | Consumer app has no trip dashboard. No file paths under `app-mobile/`. |
| Consumer Android (`app-mobile/` on Android) | **NO** | Same — no consumer dashboard. |
| Buyer/anonymous Web (`mingla-business/` buyer routes) | **NO** | Anon buyer routes never render the planner dashboard. Capacity gate at checkout RPC unchanged. |
| Business iOS (`mingla-business/` on iOS) | **YES** | Touches [mingla-business/app/trip/[id]/index.tsx](mingla-business/app/trip/[id]/index.tsx) — same JS bundle as Android + web. **Parity automatic via shared code.** Single success criterion suffices. |
| Business Android (`mingla-business/` on Android) | **YES** | Same shared file. **Parity automatic.** |
| Business Web preview (`mingla-business/` Next.js build) | **YES** | Same shared file rendered in Next.js. **Parity automatic.** Requires `[deploy]` tag on CLOSE commit. |
| Admin Web (`mingla-admin/`) | **NO** | No trip dashboard surface. Admin reads trips via a different path; not touched. |

Parity is automatic (single source file `index.tsx` rendered across all three business surfaces). Tester verifies each surface independently per `feedback_tester_canonical_and_platform_parity.md` but no per-surface SCs are needed because there are no per-surface code paths.

## 5. Layer-by-layer specification

### Layer 1 — Database (new migration)

**File:** `supabase/migrations/<next-timestamp>_orch_0947_biz_trip_tickets_sold.sql`

Pick `<next-timestamp>` as the next sequential timestamp after `20260724000005_profile_circle_relationship_source.sql` (current tail). Use format `20260725000000_orch_0947_biz_trip_tickets_sold.sql` or later.

**Exact SQL:**

```sql
-- ORCH-0947 [Trip dashboard Spots tile counts tickets, not orders]
-- New SECURITY DEFINER helper that mirrors the canonical capacity-gate
-- query at supabase/migrations/20260610000002_tr3_ticket_checkout_session_installment_aware.sql:223-228.
-- Powers the trip dashboard's Spots KPI tile and "N travelers" subtitle so the
-- planner sees the same number the checkout RPC enforces.

CREATE OR REPLACE FUNCTION public.biz_trip_tickets_sold(
  p_event_id uuid
) RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_event   record;
  v_count   integer;
BEGIN
  -- 1. Auth gate
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required';
  END IF;

  -- 2. Event lookup + type check
  SELECT id, brand_id, event_type, deleted_at
    INTO v_event
    FROM public.events
   WHERE id = p_event_id
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'trip_not_found';
  END IF;

  IF v_event.event_type <> 'trip' THEN
    RAISE EXCEPTION 'event_not_a_trip'
      USING HINT = 'biz_trip_tickets_sold only handles event_type=trip rows.';
  END IF;

  -- 3. Ownership check — must hold viewer-or-higher rank on the brand
  IF public.biz_brand_effective_rank(v_event.brand_id, v_user_id)
       < public.biz_role_rank('viewer'::text) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- 4. Canonical sold count — mirror the capacity gate exactly.
  --    Counts tickets that hold a real seat: 'valid' (active),
  --    'used' (already attended), 'transferred' (still occupies a spot,
  --    just owned by a new wallet).
  SELECT COUNT(*)::integer
    INTO v_count
    FROM public.tickets t
    JOIN public.ticket_types tt ON tt.id = t.ticket_type_id
   WHERE tt.event_id = p_event_id
     AND t.status IN ('valid', 'used', 'transferred');

  RETURN COALESCE(v_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.biz_trip_tickets_sold(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.biz_trip_tickets_sold(uuid)
  TO authenticated;

COMMENT ON FUNCTION public.biz_trip_tickets_sold(uuid) IS
  'ORCH-0947: returns count of tickets occupying a seat (status IN (valid,used,transferred)) for a trip''s ticket_types. Mirrors the canonical capacity gate. Used by the trip dashboard Spots tile.';
```

**Implementor notes:**
- Verify `biz_role_rank('viewer')` exists by greppping prior migrations. If `'viewer'` is not a valid rank string, use the next-lowest valid rank that still allows brand-data reads. Document choice in implementation report.
- The function must NOT silently return 0 on auth failure — it raises so the dashboard surfaces the error via React Query's error UI.
- `STABLE` is correct (no writes, deterministic per snapshot).

### Layer 2 — Service layer

**File:** [mingla-business/src/services/tripsService.ts](mingla-business/src/services/tripsService.ts)

**Change 1 — `Trip` interface (around line 99):**

Add `ticketsSoldCount: number;` as a top-level field on `Trip`, NOT inside `TripBusinessTrip`. `TripBusinessTrip` mirrors stored configuration; `ticketsSoldCount` is a derived runtime count. Place it just below `bookingsClosedAt`:

```ts
  bookingsClosedAt: string | null;
  /**
   * ORCH-0947: count of tickets occupying a seat
   * (status IN ('valid','used','transferred')) for this trip's
   * ticket_types. Mirrors the checkout RPC capacity gate.
   * Server-derived via biz_trip_tickets_sold(p_event_id).
   */
  ticketsSoldCount: number;
```

**Change 2 — `getTrip()` 5th parallel call (around line 519):**

```ts
  const [daysResp, tiersResp, inclusionsResp, ticketsResp, soldResp] = await Promise.all([
    supabase.from("trip_days").select("*").eq("event_id", eventId).order("ordinal"),
    supabase.from("trip_pricing_tiers").select("*").eq("event_id", eventId),
    supabase.from("trip_inclusions").select("*").eq("event_id", eventId).order("kind").order("ordinal"),
    supabase.from("ticket_types").select("*").eq("event_id", eventId).is("deleted_at", null),
    // ORCH-0947: canonical tickets-sold count for the Spots KPI tile.
    supabase.rpc("biz_trip_tickets_sold", { p_event_id: eventId }),
  ]);
  if (daysResp.error) throw daysResp.error;
  if (tiersResp.error) throw tiersResp.error;
  if (inclusionsResp.error) throw inclusionsResp.error;
  if (ticketsResp.error) throw ticketsResp.error;
  if (soldResp.error) throw soldResp.error;
```

**Change 3 — `mapTrip()` plumbing:**

Pass `soldResp.data ?? 0` (a number, since the RPC returns `integer`) as a new last argument to `mapTrip()`. Update `mapTrip` signature to accept `ticketsSoldCount: number` and populate the new field. Implementor finds the exact `mapTrip` location (search for `function mapTrip` or `const mapTrip`); audit ALL its callsites and add the field everywhere.

**Hard guard:** do not invent a fallback that masks RPC errors. If `soldResp.error` is set, `getTrip()` throws (consistent with the other four sibling reads). The dashboard's existing error UI surfaces it.

### Layer 3 — Type-system fan-out

After Change 1 lands, TypeScript strict will surface every place that constructs a `Trip` literal without `ticketsSoldCount`. Implementor MUST audit and fix all of them:

```bash
grep -rn "businessTrip:\s*{" mingla-business/src/ mingla-business/app/ mingla-business/__tests__/ | grep -v node_modules
grep -rn ": Trip\s*=" mingla-business/src/ mingla-business/app/ mingla-business/__tests__/ | grep -v node_modules
```

Likely fixture/factory locations: `mingla-business/__tests__/factories/`, `mingla-business/src/services/__tests__/`, any storybook stories. Set fixtures to `ticketsSoldCount: 0` unless the test specifically exercises sold-count behavior. Type errors are the implementor's compass — `pnpm -F mingla-business tsc --noEmit` must pass with zero errors before commit.

### Layer 4 — Dashboard line swaps

**File:** [mingla-business/app/trip/[id]/index.tsx](mingla-business/app/trip/[id]/index.tsx)

**Change A — lines 290–292 (`travelersCount` definition):**

Delete the `travelersCount` const. Replace with:

```tsx
  // ORCH-0947: read canonical tickets-sold count from the trip detail
  // payload (server-derived via biz_trip_tickets_sold). Counting orders
  // client-side underreports because most orders carry >1 ticket.
  const ticketsSold = trip.ticketsSoldCount;
```

**Change B — lines 298–301 (`spotsLabel`):**

```tsx
  const spotsLabel =
    trip.businessTrip.capacity !== null
      ? `${ticketsSold} / ${trip.businessTrip.capacity}`
      : `${ticketsSold}`;
```

**Change C — line 409 (action grid subtitle):**

```tsx
          sub={`${ticketsSold} ${ticketsSold === 1 ? "traveler" : "travelers"}`}
```

**Hidden-flaw audit (implementor must run):**

```bash
grep -n "travelersCount" mingla-business/app/trip/[id]/index.tsx
```

Must return 0 matches after the swap. If anything else in the file still reads `travelersCount`, decide on a case-by-case basis whether that consumer wants "orders count" semantics or "people traveling" semantics. Default: switch to `ticketsSold`. Document any divergence in the implementation report.

### Layer 5 — RLS / security

The SECURITY DEFINER function IS the RLS gate. It bypasses table-level RLS by design (necessary because `tickets` RLS is buyer-scoped — the planner can't directly SELECT buyer-owned ticket rows). The function-level ownership check (rank ≥ `viewer` on the trip's owning brand) replaces RLS as the authorization boundary.

Threat model:
- **Non-brand-member calls the RPC** → `not_authorized` raised. Verified by adversarial test T-A02.
- **Unauthenticated call** → `authentication_required` raised. Verified by T-A01.
- **Caller passes a non-trip event id** → `event_not_a_trip` raised (defense-in-depth; the dashboard would never do this but malicious callers might).
- **Soft-deleted event** → `trip_not_found` raised (mirrors `getTrip()`'s `.is('deleted_at', null)` filter).

`REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO authenticated` ensures anon callers cannot even invoke the function (gets `permission denied` at PG level before the auth check runs).

### Layer 6 — Cache / React Query

No new query key. The `useTrip(eventId)` hook already caches the trip detail; `ticketsSoldCount` flows in as a field on the existing payload. The hook's existing `staleTime` controls freshness; no change needed.

**Side note (Discoveries for Orchestrator, not in scope):** the trip dashboard currently has no realtime subscription for `tickets` inserts. The KPI tile updates only on React Query refetch (manual pull-to-refresh or `staleTime` expiry). Live planners watching the dashboard during a sell-down won't see the number tick in real time. This is pre-existing behavior, not introduced by ORCH-0947, but it's a UX gap worth registering as a follow-up if Seth wants it.

### Layer 7 — Existing test updates (REQUIRES `[TEST-MOD-APPROVED ORCH-0947]`)

**File:** [mingla-business/app/trip/[id]/__tests__/dashboard-parity.test.tsx](mingla-business/app/trip/[id]/__tests__/dashboard-parity.test.tsx)

Test T-07 hard-asserts the old string template `${travelersCount} / ${trip.businessTrip.capacity}` (line 102). Update to assert `${ticketsSold} / ${trip.businessTrip.capacity}`.
Test T-08 (line 107) asserts `${travelersCount}` for null-capacity. Update to assert `${ticketsSold}`.

**File:** [mingla-business/app/trip/[id]/__tests__/dashboard-parity-adversarial.test.tsx](mingla-business/app/trip/[id]/__tests__/dashboard-parity-adversarial.test.tsx)

T-A09 (line 190) asserts `N / 0` rendering. Confirm the test still passes against `ticketsSold` semantics (it should — zero-capacity edge case is identical regardless of numerator source). If it asserts the literal `travelersCount` token, update.

The CLOSE commit body MUST include the literal token `[TEST-MOD-APPROVED ORCH-0947]` because the diff modifies existing test lines (per `feedback_close_commit_precommit_checks.md`).

## 6. Implementation order

1. Write migration `supabase/migrations/<next-ts>_orch_0947_biz_trip_tickets_sold.sql` (Layer 1).
2. Apply migration locally via `supabase migration up` (local Supabase only; remote push is operator's job at CLOSE).
3. Update `Trip` interface + `getTrip()` + `mapTrip()` (Layer 2).
4. Run `pnpm -F mingla-business tsc --noEmit` — fix every fixture/factory until zero errors (Layer 3).
5. Update dashboard line swaps (Layer 4).
6. Update existing parity tests (Layer 7).
7. Write new regression tests (§10).
8. Run full test suite — `pnpm -F mingla-business test`.
9. Manual smoke on business web preview (`pnpm -F mingla-business dev`) against any seeded trip with multi-ticket orders.
10. Write implementation report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0947_TRIP_SPOTS_TICKETS_NOT_ORDERS.md`.

## 7. Success criteria

| ID | Criterion | How verified |
|---|---|---|
| SC-01 | Migration applies cleanly on remote (`supabase db push --linked` succeeds with no errors). | Operator confirms post-push. |
| SC-02 | Authenticated brand member calling `biz_trip_tickets_sold('060d0483-50db-48d1-840b-73d9fc59356a')` against the DC Adventure trip returns `55` (current live state) or whatever value matches the live `tickets` count. | Tester runs SQL probe. |
| SC-03 | Authenticated NON-member call → RPC raises `not_authorized`. | Adversarial test T-A02. |
| SC-04 | Anon call → PG-level `permission denied` (before function body runs). | Adversarial test T-A01. |
| SC-05 | `getTrip(eventId)` returns a `Trip` object whose `ticketsSoldCount` field matches the RPC's return value. | Service-layer unit test. |
| SC-06 | Trip dashboard renders `${ticketsSoldCount} / ${capacity}` in the Spots KPI tile and `${ticketsSoldCount} traveler(s)` in the action grid subtitle. | Updated parity tests T-07, T-08 + live smoke. |
| SC-07 | On DC Adventure: dashboard renders `55 / 55` (or `55 / 100` after ORCH-0950 ships — numerator is the same). | Live smoke on business iOS, Android, web preview. |
| SC-08 | When buyer flow refunds one ticket from a paid 4-ticket order, dashboard refreshes to `54 / 55` after React Query refetch. Existing `biz_trip_sold_count_by_tier` would have continued reading `55` because it sums quantity (drift bug we explicitly avoided). | Adversarial test T-A03. |
| SC-09 | `pnpm -F mingla-business tsc --noEmit` passes with zero errors. | CI + local. |
| SC-10 | `pnpm -F mingla-business test` passes (all existing + new tests). | CI + local. |
| SC-11 | CLOSE commit body contains literal token `[TEST-MOD-APPROVED ORCH-0947]` and `[deploy]`. | Orchestrator CLOSE Step 2.5. |

## 8. Invariants

**Preserves:**
- `I-RQ-KEY-FACTORY` — no new query key introduced; ride existing `useTrip` cache.
- `I-NO-SILENT-FAILURE` — RPC errors throw, surfacing through standard error UI.
- `I-NO-FABRICATED-DATA` — `ticketsSoldCount` derives from real `tickets` rows; no fallback that fabricates a count.
- `I-SECURITY-DEFINER-OWNERSHIP-CHECK` — every SECURITY DEFINER function runs an explicit ownership check before bypassing RLS.

**Establishes (new):**
- `I-TRIP-SPOTS-MIRRORS-CAPACITY-GATE` — any UI surface displaying "spots/sold/travelers" against a trip's capacity MUST read its numerator from `biz_trip_tickets_sold` (or future canonical replacement), NOT from `orders.count`, NOT from `order_line_items.quantity` sum, NOT from `biz_trip_sold_count_by_tier`. Enforcement: strict-grep gate (see §11).

## 9. Cache / realtime considerations

None changed. No new query keys. No realtime subscriptions added. `useTrip` continues to refetch on `staleTime` expiry and on explicit invalidation by checkout/refund mutations (existing behavior, not touched).

## 10. Test cases (mandatory — ORCH-0840 Step 0.5)

### Happy-path regression test (implementor-written)

**File:** `supabase/migrations/__tests__/biz_trip_tickets_sold.test.ts` (or matching test harness pattern in the worktree — implementor finds the right home; preferred path is wherever existing `biz_*` RPC tests live).

| ID | Scenario | Seed | Assert |
|---|---|---|---|
| T-01 | Counts valid + used + transferred, excludes cancelled/void/refunded | Seed 1 trip + 2 ticket_types + 10 tickets: 5 `valid`, 2 `used`, 1 `transferred`, 1 `cancelled`, 1 `void` | RPC returns `8` (not `10`) |
| T-02 | Sums across multiple ticket_types | Seed 1 trip + 3 ticket_types + tickets distributed 20 + 15 + 20 (all `valid`) | RPC returns `55` |
| T-03 | Zero tickets returns 0 | Seed trip with ticket_types but no tickets | RPC returns `0` (not null) |

**`fails-on-revert` proof requirement:** the implementor must capture in the implementation report:

```
Test biz_trip_tickets_sold.test.ts::T-01 PASS at <fix-commit-hash>.
Reverted RPC body to `SELECT COUNT(*) FROM orders WHERE event_id = p_event_id AND payment_status NOT IN ('failed','cancelled')` → T-01 FAIL (returns 5, expected 8). Confirms test exercises the bug.
```

### Adversarial regression test (tester-written, different angle)

**File:** `supabase/migrations/__tests__/biz_trip_tickets_sold.adversarial.test.ts` (or matching).

| ID | Scenario | Assert |
|---|---|---|
| T-A01 | Anon caller (no `auth.uid()`) | RPC raises `authentication_required` (or PG `permission denied` — either is acceptable as long as it fails) |
| T-A02 | Authenticated but NOT a member of the brand owning the trip | RPC raises `not_authorized` |
| T-A03 | Trip with one paid 4-ticket order; refund 1 ticket (set status `'refunded'` on one of the 4 ticket rows) | RPC returns `3`, NOT `4`. Proves the canonical mirror beats `biz_trip_sold_count_by_tier` on partial-refund cases. |
| T-A04 | Non-trip event id (`event_type='event'`) | RPC raises `event_not_a_trip` (defense-in-depth) |
| T-A05 | Soft-deleted trip (`events.deleted_at IS NOT NULL`) | RPC raises `trip_not_found` |

Both test files are immutable post-merge per ORCH-0840 append-only gate.

### Existing-test modifications (cite `[TEST-MOD-APPROVED ORCH-0947]` in commit)

- `dashboard-parity.test.tsx::T-07` and `T-08` — update string template assertions.
- `dashboard-parity-adversarial.test.tsx::T-A09` — verify still passes; update token if needed.

## 11. Regression prevention

**Strict-grep gate (new):** add to `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` or to a new dedicated script — implementor chooses, but the gate MUST be wired into `.github/workflows/strict-grep-mingla-business.yml`.

**Pattern to forbid in `mingla-business/app/trip/[id]/`:**
- `ordersQuery.data.*\.filter.*\.length` rendered into any string template containing "spots", "traveler", or "/ ${" near `businessTrip.capacity`.

Initial implementation can be simpler — forbid the literal identifier `travelersCount` anywhere under `mingla-business/app/trip/[id]/index.tsx`. If a future feature legitimately needs orders-count semantics, it can grep-add an allowlist with operator approval and a comment justifying the divergence.

**Invariant comment to embed at the top of `getTrip()`:**

```ts
// ORCH-0947: ticketsSoldCount comes from biz_trip_tickets_sold RPC and
// mirrors the checkout-RPC capacity gate exactly. Do NOT replace with
// orders.count, order_line_items.quantity sum, or biz_trip_sold_count_by_tier
// — those drift on per-ticket refunds, transfers, and voids.
```

## 12. Vercel `[deploy]` decision

`[deploy]` tag REQUIRED on CLOSE commit. `mingla-business/app/trip/[id]/index.tsx` is a Next.js build input for the business web preview surface. Per `feedback_vercel_deploy_gate.md`.

## 13. Operator-owned steps

- `supabase db push --linked` to apply the new migration on the linked project (orchestrator NEVER runs this — see `feedback_orchestrator_deploys_edge_functions.md`).
- No edge function deploys needed (this is a pure SQL helper + frontend change).

## 14. Discoveries for Orchestrator (side issues, not in scope)

1. **No realtime on trip dashboard KPI tile.** Spots number updates only on stale refetch — planner watching live sales won't see the tick. Pre-existing, not introduced. Suggested follow-up ORCH if Seth wants live updates: subscribe to `tickets` inserts/updates filtered by `ticket_type_id IN (trip's ticket_types)` and invalidate `useTrip(eventId)` on event.
2. **`biz_trip_sold_count_by_tier` has the same drift bug class** that `biz_trip_tickets_sold` fixes — it sums `order_line_items.quantity` filtered by `orders.payment_status`. It's load-bearing for `biz_update_live_trip`'s refund gate, so we can't simply replace it. But it's worth a future investigation: does the refund gate actually want "billed quantity" semantics or "occupied seats" semantics? They diverge on partial refunds. Likely a separate ORCH.
3. **Travelers tab (`travelers/index.tsx`) lists orders.** That's the right semantic for "list of buyers", but a planner reading "12 travelers" in the tab header alongside "55 travelers" in the action grid will be confused. Worth a UI labeling pass — but that's design polish, not a bug. Out of scope.

## 15. References

- Investigation evidence: `Mingla_Artifacts/WORLD_MAP.md` entry dated 2026-05-24
- Canonical capacity gate: [supabase/migrations/20260610000002_tr3_ticket_checkout_session_installment_aware.sql:223-228](supabase/migrations/20260610000002_tr3_ticket_checkout_session_installment_aware.sql#L223-L228)
- Auth pattern precedent: [supabase/migrations/20260616000000_orch_0876_trip_published_edit.sql:201-204](supabase/migrations/20260616000000_orch_0876_trip_published_edit.sql#L201-L204)
- Related (not coupled): ORCH-0950 [Trip capacity dual-source-of-truth]
- Memory rules: `feedback_close_commit_precommit_checks.md`, `feedback_vercel_deploy_gate.md`, `feedback_orchestrator_deploys_edge_functions.md`, `feedback_tester_canonical_and_platform_parity.md`
