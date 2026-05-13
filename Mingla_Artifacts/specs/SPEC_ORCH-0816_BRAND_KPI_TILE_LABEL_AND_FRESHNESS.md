# SPEC — ORCH-0816 — Brand KPI tile: real 7-day window + freshness signals

**Status:** ready for implementor.
**Mode:** SPEC.
**Date:** 2026-05-12.
**Owner:** Claude `mingla-forensics`.
**Investigation:** [Mingla_Artifacts/reports/INVESTIGATION_ORCH-0816_BRAND_KPI_TILE_LABEL_AND_FRESHNESS.md](Mingla_Artifacts/reports/INVESTIGATION_ORCH-0816_BRAND_KPI_TILE_LABEL_AND_FRESHNESS.md)
**Closes findings:** F-1 (label mismatch), F-2 (freshness gap), F-3 (publication membership), F-4 (hidden flaw on attendees/events).

---

## 1. Scope

In scope:
1. Compute a real **7-day rolling GMV** for the home-screen "Last 7 days" tile.
2. Preserve the **lifetime GMV / attendees / events** values for `BrandProfileView`.
3. Close the freshness gap so brand-level stats reflect new orders within seconds, not minutes.

Out of scope (non-goals):
- Any change to per-event sales summaries / `useEventOrders` (already fresh).
- Any change to `events` count semantics (already invalidated on event create/delete).
- Any change to admin dashboard, app-mobile, or edge functions.
- Any change to checkout, refund, or webhook code paths.
- Backfill of historical orders.

Assumptions:
- `orders.created_at` is the correct anchor for the 7-day window (it is — set by Postgres `now()` on insert by the checkout edge function).
- The brand owner is signed in with a session that satisfies the existing `biz_can_read_order_for_caller` RLS policy on `orders`.
- The brand has a single `defaultCurrency`; mixed-currency orders are excluded from the headline tile by design (existing behavior, preserved).

---

## 2. Implementation order

1. Database migration (publication membership for Realtime).
2. Service layer (`brandsService.ts`) — extend stats aggregation to compute lifetime + 7-day in one pass.
3. Type layer (`Brand.stats`) — add `rev7d: number` field.
4. Hook layer (`useBrands.ts`) — reduce staleTime, add Realtime subscription, expose invalidation helper.
5. Component layer (`home.tsx`, `BrandProfileView.tsx`) — bind new field, wire `RefreshControl`.
6. Tests (unit + render).
7. Strict-grep CI gate (label/field binding sanity).

---

## 3. Database layer

### 3.1 Migration

**File:** `supabase/migrations/20260513000000_orch_0816_orders_realtime_publication.sql`

**Content:**

```sql
-- ORCH-0816 — add `orders` to the supabase_realtime publication so the
-- mingla-business brand owner can subscribe to postgres_changes on their
-- brand's orders for KPI tile freshness.
--
-- Security note: RLS policy "Buyer or brand team can select orders"
-- (defined in baseline squash) gates SELECT to the buyer and the brand
-- team via `biz_can_read_order_for_caller(id)`. The publication change
-- does NOT broaden read access — Supabase Realtime enforces the same
-- RLS on event delivery as it does on direct SELECT.
ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
```

**Invariants preserved:**
- RLS unchanged. No new policies, no policy weakening.
- No DML. No data backfill.
- Idempotency: the `ADD TABLE` is run on a fresh squash where `orders` is not present; if rerun, Postgres rejects with a clear error rather than silently doing nothing. Migration runner halts — operator re-applies cleanly. (Adding `IF NOT EXISTS` is not supported on `ALTER PUBLICATION` in current Postgres; rely on Supabase's migration-tracking idempotency.)

**Test gate:**
- After apply: `SELECT pubname, schemaname, tablename FROM pg_publication_tables WHERE tablename = 'orders';` must return exactly one row with `pubname = 'supabase_realtime'`.

### 3.2 No schema changes to `orders`

`orders.created_at`, `orders.total_cents`, `orders.refunded_amount_cents`, `orders.currency`, `orders.payment_status`, `events.brand_id`, `order_line_items.quantity` are all unchanged and sufficient.

---

## 4. Service layer

### 4.1 File: `mingla-business/src/services/brandsService.ts`

**Existing function to modify:** `aggregateBrandStatsByBrandIds`.

**New shape:**

```ts
interface BrandStatsAggregate {
  attendees: number;                          // lifetime ticket quantity
  revByCurrencyCents: Map<string, number>;    // lifetime by currency
  rev7dByCurrencyCents: Map<string, number>;  // last-7-day by currency
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export async function aggregateBrandStatsByBrandIds(
  brandIds: string[],
): Promise<Map<string, BrandStatsAggregate>> {
  const result = new Map<string, BrandStatsAggregate>();
  for (const id of brandIds) {
    result.set(id, {
      attendees: 0,
      revByCurrencyCents: new Map(),
      rev7dByCurrencyCents: new Map(),
    });
  }
  if (brandIds.length === 0) return result;

  const sinceIso = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();

  const { data, error } = await supabase
    .from("orders")
    .select(`
      total_cents,
      currency,
      payment_status,
      refunded_amount_cents,
      created_at,
      events!inner ( brand_id ),
      order_line_items ( quantity )
    `)
    .in("events.brand_id", brandIds)
    .not("payment_status", "in", "(failed,cancelled,refunded)");

  if (error) throw error;

  for (const row of (data ?? []) as unknown as OrderStatsRow[]) {
    const brandId = row.events?.brand_id ?? null;
    if (brandId === null) continue;
    const bucket = result.get(brandId);
    if (bucket === undefined) continue;

    const qty = (row.order_line_items ?? []).reduce(
      (sum, line) => sum + (line.quantity ?? 0),
      0,
    );
    bucket.attendees += qty;

    const net = (row.total_cents ?? 0) - (row.refunded_amount_cents ?? 0);
    const currency = (row.currency ?? "").trim().toUpperCase();
    if (currency.length === 0) continue;

    bucket.revByCurrencyCents.set(
      currency,
      (bucket.revByCurrencyCents.get(currency) ?? 0) + net,
    );

    // 7-day window: only count if created_at within window.
    // created_at is ISO string from PostgREST.
    if (row.created_at !== null && row.created_at >= sinceIso) {
      bucket.rev7dByCurrencyCents.set(
        currency,
        (bucket.rev7dByCurrencyCents.get(currency) ?? 0) + net,
      );
    }
  }

  return result;
}
```

And update `OrderStatsRow`:

```ts
interface OrderStatsRow {
  total_cents: number | null;
  currency: string | null;
  payment_status: string | null;
  refunded_amount_cents: number | null;
  created_at: string | null;  // NEW
  events: { brand_id: string | null } | null;
  order_line_items: { quantity: number | null }[] | null;
}
```

And update `pickRevForCurrency` callers — keep the existing function shape (it already takes the lifetime map), add a sibling:

```ts
function pickRev7dForCurrency(
  agg: BrandStatsAggregate | undefined,
  defaultCurrency: string | undefined,
): number {
  if (agg === undefined) return 0;
  if (defaultCurrency === undefined || defaultCurrency.trim().length === 0) {
    return 0;
  }
  const cents = agg.rev7dByCurrencyCents.get(defaultCurrency.trim().toUpperCase());
  if (cents === undefined || cents <= 0) return 0;
  return cents / 100;
}
```

Update both `getBrands` (line 158-177) and `getBrand` (line 278-292) consumers to compute both fields:

```ts
stats: {
  ...brand.stats,
  events: eventCounts.get(row.id) ?? 0,
  attendees: agg?.attendees ?? 0,
  rev: pickRevForCurrency(agg, brand.defaultCurrency),
  rev7d: pickRev7dForCurrency(agg, brand.defaultCurrency),
},
```

**Error contract preserved:** still throws on Postgrest error. No fallback values. No swallowing.

**Query cost:** Same number of rows fetched (one round-trip). Client-side filtering for the 7-day bucket avoids a second query. Acceptable cost: a brand with 5,000 lifetime orders ships ~5,000 rows over the wire on every brand list refresh — same as today. Lower bound for optimization later if metrics warrant; not in scope here.

---

## 5. Type layer

### 5.1 File: `mingla-business/src/store/currentBrandStore.ts`

Locate the `Brand.stats` type and add `rev7d`:

```ts
stats: {
  events: number;
  followers: number;
  rev: number;       // lifetime, default currency
  rev7d: number;     // NEW — last 7 days, default currency
  attendees: number; // lifetime
};
```

**Backfill all literal `stats: { ... }` initializers** to include `rev7d: 0`:

- `mingla-business/src/services/businessEvents.ts:298`
- `mingla-business/src/services/brandsService.ts:169`, `:285`
- `mingla-business/src/services/publicEventsService.ts:248`, `:277`
- `mingla-business/src/services/__tests__/publicEventsService.test.ts:271`, `:372`
- `mingla-business/src/services/__tests__/brandsService.test.ts` test fixtures
- `mingla-business/src/hooks/useBrands.ts:170` (optimistic temp brand)
- `mingla-business/src/hooks/useBusinessEvents.ts:44`

Strict TypeScript will fail the build if any are missed; that is the gate.

---

## 6. Hook layer

### 6.1 File: `mingla-business/src/hooks/useBrands.ts`

**Change A — staleTime:**

```ts
const STALE_TIME_MS = 30 * 1000; // 30s — brand stats follow ticket sales
```

Replace existing `5 * 60 * 1000`.

**Change B — Realtime subscription inside `useBrands`:**

Add a new `useEffect` inside the `useBrands` hook body (NOT inside `queryFn`), modeled verbatim on `useBrandStripeBankVerification` lines 95-122. It subscribes to `postgres_changes` on `public.orders` when `accountId` is present and invalidates the brand list query on any event.

Because `orders` does not carry `account_id` directly (it carries `event_id` → `events.brand_id` → `brands.account_id`), the client cannot pre-filter the subscription by `account_id`. Two acceptable options — choose **Option 1**:

- **Option 1 (chosen): subscribe broadly, filter on receipt.** Subscribe to ALL orders changes (RLS enforces per-event visibility — the brand owner only receives events for orders on their own brand's events). On receipt, invalidate `brandKeys.all` and `eventOrdersKeys.all`. Cost is low because RLS gates delivery; the owner only receives ~their own orders.
- **Option 2 (rejected): pre-filter by event IDs.** Requires the hook to know all event IDs across all brands, recompute filter string when events change, and recreate the channel. Higher complexity, worse cleanup behavior on event list churn.

```ts
// Inside useBrands(accountId), after computing `enabled`:
useEffect(() => {
  if (!enabled || accountId === null) return;
  const channelName = `brand-stats-orders-${accountId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const channel = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "orders",
      },
      () => {
        queryClient.invalidateQueries({ queryKey: brandKeys.all });
        queryClient.invalidateQueries({ queryKey: eventOrdersKeys.all });
      },
    )
    .subscribe();

  return (): void => {
    void supabase.removeChannel(channel);
  };
}, [enabled, accountId, queryClient]);
```

Imports to add to the top of the file:
- `useEffect` from `"react"`
- `supabase` from `"../services/supabase"`
- `eventOrdersKeys` from `"./useEventOrders"`

**Change C — same realtime for `useBrand(brandId)`:**

`useBrand` is used by `BrandProfileView`. Add a parallel `useEffect` keyed on `brandId` rather than `accountId`. RLS still gates per-brand visibility identically.

**Change D — no change to existing optimistic mutations.** They remain.

### 6.2 Constitution #3 — silent-failure guard for Realtime

If the publication migration has not been applied (e.g., a dev cherry-picks the client code without the migration), the subscription succeeds but never receives events. To detect this in dev, add a development-only `console.warn` after a 60-second window with no events when there are known orders in cache. Skip in production (no log spam).

Actually — **do not add this**. It introduces noise and a runtime timer with edge cases. Instead: the strict-grep CI gate (§9) enforces that any migration adding `orders` to a publication is paired with the client subscription. That's the durable safeguard.

---

## 7. Component layer

### 7.1 File: `mingla-business/app/(tabs)/home.tsx`

**Change A — bind the right field:**

[Line 401-411] becomes:

```tsx
<KpiTile
  label="Last 7 days"
  value={
    currentBrand.defaultCurrency !== undefined
      ? formatCurrencyRound(
          currentBrand.stats.rev7d,  // CHANGED from .rev
          currentBrand.defaultCurrency,
        )
      : "—"
  }
/>
```

**Change B — add `RefreshControl`:**

Import:
```tsx
import { RefreshControl } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { brandKeys } from "../../src/hooks/useBrands";
import { eventOrdersKeys } from "../../src/hooks/useEventOrders";
```

Inside the component, add:
```tsx
const queryClient = useQueryClient();
const [isRefreshing, setIsRefreshing] = useState(false);

const handleRefresh = useCallback(async () => {
  setIsRefreshing(true);
  try {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: brandKeys.all }),
      queryClient.invalidateQueries({ queryKey: eventOrdersKeys.all }),
    ]);
  } finally {
    setIsRefreshing(false);
  }
}, [queryClient]);
```

And on the existing `<ScrollView>`:
```tsx
<ScrollView
  contentContainerStyle={styles.scroll}
  showsVerticalScrollIndicator={false}
  refreshControl={
    <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
  }
>
```

**Change C — fix the file-header doc comment:**

[Line 6] currently says `→ 7-day aggregate hero + KPI grid + Upcoming list`. Leave as-is — now finally honest.

### 7.2 File: `mingla-business/src/components/brand/BrandProfileView.tsx`

**Change A — bind unchanged:**

The GMV tile already correctly uses `brand.stats.rev` under "all time". No binding change. Do not introduce `rev7d` here.

**Change B — add `RefreshControl`:**

Same pattern as 7.1.B, on the ScrollView in BrandProfileView. Invalidates `brandKeys.detail(brand.id)` and `eventOrdersKeys.all`.

**Change C — no other tile changes.**

---

## 8. Success criteria

| # | Criterion | Layer | Test |
|---|---|---|---|
| SC-1 | The home tile labelled "Last 7 days" displays GMV for orders with `created_at >= now - 7d` in the brand's default currency, excluding `failed`/`cancelled`/`refunded` and netting `refunded_amount_cents` for partials. | Service + Component | Unit test on `aggregateBrandStatsByBrandIds` with fixture orders 6d/8d old; render test on `home.tsx` |
| SC-2 | The `BrandProfileView` "GMV / all time" tile is unchanged in value (lifetime, same exclusions as today). | Service + Component | Unit test asserts `pickRevForCurrency` unchanged; visual regression |
| SC-3 | Within 5 seconds of an `orders` INSERT for any of the signed-in account's brands' events, both the home and brand-profile stats tiles reflect the new value without backgrounding the app. | DB + Hook + Component | Integration smoke (manual): seed order via SQL, observe tile update |
| SC-4 | Pulling down on the home ScrollView triggers a refetch of `brandKeys.all` and `eventOrdersKeys.all`. The spinner appears and disappears. | Hook + Component | Render test with spy on `invalidateQueries` |
| SC-5 | Pulling down on the brand-profile ScrollView does the same. | Hook + Component | Render test |
| SC-6 | `staleTime` for `useBrands` / `useBrand` is 30,000 ms. No global default change. | Hook | Unit test reading the exported constant |
| SC-7 | The migration adds `orders` to `supabase_realtime` publication; `pg_publication_tables` confirms membership after `supabase db push`. | DB | SQL probe |
| SC-8 | On signed-out / unauthenticated state, no Realtime channel is created (the `useEffect` early-returns on `!enabled`). | Hook | Render test with null `accountId` |
| SC-9 | The Realtime channel is cleaned up on unmount (no leaked channels across remounts). | Hook | Render test that mounts/unmounts and asserts `removeChannel` was called |
| SC-10 | TypeScript strict build passes — every `Brand.stats` literal initializer includes `rev7d: 0`. | Type | `tsc --noEmit` |

---

## 9. Invariants & regression prevention

### 9.1 Constitutional rules — preserved

- **#1 No dead taps:** RefreshControl is a real gesture target.
- **#2 One owner per truth:** server stats stay in React Query; nothing copied into Zustand.
- **#3 No silent failures:** the Realtime path is paired with a migration; no separate fallback that could mask publication absence. Errors from `aggregateBrandStatsByBrandIds` still throw (existing contract).
- **#4 One key per entity:** reuse `brandKeys` and `eventOrdersKeys` factories. No new ad-hoc keys.
- **#5 Server state in React Query:** all changes live in React Query and the service layer.
- **#9 No fabricated data:** the 7-day tile now contains 7-day data.
- **#10 Currency-aware:** unchanged — `pickRev7dForCurrency` mirrors `pickRevForCurrency`.

### 9.2 New invariants

**None new.** This fix uses existing invariants; it does not establish new ones. (The Realtime publication membership is implementation detail, not a new system invariant.)

### 9.3 Strict-grep CI gate

Add a new strict-grep script under `.github/scripts/strict-grep/`:

**File:** `.github/scripts/strict-grep/orch-0816-last-7-days-binds-rev7d.mjs`

Logic:
- Read `mingla-business/app/(tabs)/home.tsx`.
- Find every `KpiTile` with `label="Last 7 days"`.
- For each, assert the `value` expression in the same JSX block references `stats.rev7d` and does NOT reference `stats.rev` (sans suffix).
- If any tile labelled "Last 7 days" reads `stats.rev` without the `7d` suffix, fail.

Add the job to `.github/workflows/strict-grep-mingla-business.yml` per the registry pattern (`feedback_strict_grep_registry_pattern.md`).

This prevents a future refactor from silently re-binding the wrong field.

---

## 10. Test cases (handoff to TEST mode)

| ID | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-01 | Lifetime sum with no time filter | 3 orders: 1d, 6d, 30d old, all succeeded, same currency, total_cents 1000 each | `rev = 30.00`, `rev7d = 20.00` | Service unit |
| T-02 | Partial refund netting | 1 order, 5d old, total 1000, refunded 300, partial_refund | `rev = 7.00`, `rev7d = 7.00` | Service unit |
| T-03 | Full refund excluded | 1 order, 5d old, payment_status="refunded" | `rev = 0`, `rev7d = 0` | Service unit |
| T-04 | Failed excluded | 1 order, 5d old, payment_status="failed" | `rev = 0`, `rev7d = 0` | Service unit |
| T-05 | Wrong currency excluded from headline | brand defaultCurrency GBP; 1 USD order 3d old | `rev = 0`, `rev7d = 0` (USD not surfaced on tile; correct existing behavior) | Service unit |
| T-06 | Multiple brands isolated | brand A and brand B each with own orders | Aggregates do not cross-contaminate | Service unit |
| T-07 | Home tile renders 7-day value | currentBrand.stats = { rev: 100, rev7d: 20, ... } | Tile labelled "Last 7 days" displays the 20 value formatted | Component render |
| T-08 | BrandProfileView GMV tile renders lifetime | brand.stats.rev = 100, rev7d = 20 | "GMV / all time" tile displays the 100 value formatted | Component render |
| T-09 | Pull-to-refresh invalidates | Mount home, pull down | `invalidateQueries` called with `brandKeys.all` AND `eventOrdersKeys.all` | Hook+Component test |
| T-10 | Realtime subscription mounts | accountId provided | `supabase.channel(...).on("postgres_changes", { table: "orders" })` called; cleanup calls `removeChannel` | Hook test (mocked) |
| T-11 | Realtime subscription does NOT mount when disabled | accountId null | No `channel` call | Hook test |
| T-12 | Publication membership | After `supabase db push` | `SELECT pubname FROM pg_publication_tables WHERE tablename='orders'` returns `supabase_realtime` | DB probe |
| T-13 | TypeScript build | `npm run typecheck` in mingla-business | Exits 0 | Build gate |
| T-14 | Strict-grep gate | The new script | Fails when "Last 7 days" tile binds `stats.rev` (no 7d); passes after correct binding | CI |
| T-15 | Insert→refresh live-fire | TestFlight build, fresh order via real checkout on second device | Home tile reflects new value ≤5s after order lands, no remount, no pull | Manual / live-fire |
| T-16 | Sign-out cleans up | Mount home signed in → sign out | Channel removed (verify via no further invalidations after sign-out) | Hook test |

T-15 is the operator-assisted live-fire smoke — the one that catches the "headless QA gap" pattern documented in `feedback_headless_qa_rpc_gap.md`. Required before CLOSE.

---

## 11. Files touched (exhaustive)

| File | Action |
|---|---|
| `supabase/migrations/20260513000000_orch_0816_orders_realtime_publication.sql` | CREATE |
| `mingla-business/src/services/brandsService.ts` | MODIFY (interfaces + aggregate fn + new picker) |
| `mingla-business/src/store/currentBrandStore.ts` | MODIFY (`Brand.stats.rev7d`) |
| `mingla-business/src/services/businessEvents.ts` | MODIFY (literal initializer) |
| `mingla-business/src/services/publicEventsService.ts` | MODIFY (×2 initializers) |
| `mingla-business/src/services/__tests__/publicEventsService.test.ts` | MODIFY (fixtures) |
| `mingla-business/src/services/__tests__/brandsService.test.ts` | MODIFY (fixtures + new T-01..T-06) |
| `mingla-business/src/hooks/useBrands.ts` | MODIFY (staleTime + realtime + temp init) |
| `mingla-business/src/hooks/useBusinessEvents.ts` | MODIFY (literal initializer) |
| `mingla-business/app/(tabs)/home.tsx` | MODIFY (binding + RefreshControl) |
| `mingla-business/src/components/brand/BrandProfileView.tsx` | MODIFY (RefreshControl only) |
| `.github/scripts/strict-grep/orch-0816-last-7-days-binds-rev7d.mjs` | CREATE |
| `.github/workflows/strict-grep-mingla-business.yml` | MODIFY (register the new job) |

**Files NOT touched** (must remain untouched):
- `useEventOrders.ts` — already fresh, do not regress.
- Any edge function under `supabase/functions/`.
- Any admin or app-mobile code.
- Any checkout, refund, or webhook code path.

---

## 12. Hard guards for implementor

- **Do not run** `supabase db push`. The operator owns DB migration application.
- **Do not deploy any edge function.** This SPEC touches no edge functions.
- **Do not weaken** the existing `pickRevForCurrency` exclusion of mixed currencies; preserve identical behavior for the lifetime field.
- **Do not modify** RLS on `orders`. The publication change is the only DB-side change.
- **Do not introduce** a new query key factory or hardcode key strings.
- **Do not** subscribe to Realtime inside `queryFn` — must be a separate `useEffect`.
- **Do not** invalidate keys you did not establish discipline for (e.g., do not invalidate `eventDraftKeys` from the orders listener).
- **Do not** introduce a runtime warning timer for "publication missing" detection.
- **Do not** change `useEventOrders.ts` — it is intentionally outside scope.

---

## 13. Deploy notes

Operator must, in order:
1. Pull the merged change.
2. `supabase db push --linked` — applies migration `20260513000000_orch_0816_orders_realtime_publication.sql`.
3. Verify: `SELECT * FROM pg_publication_tables WHERE tablename = 'orders';` returns the row.
4. EAS OTA for iOS:
   `cd mingla-business && eas update --branch production --platform ios --message "ORCH-0816: real 7-day GMV + brand-stats freshness"`
5. EAS OTA for Android (same command with `--platform android`).
6. Live-fire smoke (T-15) on TestFlight: open home as brand owner, run a real test checkout from a separate device, observe tile updates ≤5s.

---

## 14. Downstream routing

- After implementor returns the implementation report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0816_BRAND_KPI_TILE_LABEL_AND_FRESHNESS.md`, this skill (TEST mode) verifies against §8 success criteria and §10 test cases, with mandatory live-fire T-15.
- After PASS / CONDITIONAL PASS, the orchestrator runs CLOSE (artifacts sync + Step 1.5 DIAG reap + commit + EAS OTA + next dispatch).
