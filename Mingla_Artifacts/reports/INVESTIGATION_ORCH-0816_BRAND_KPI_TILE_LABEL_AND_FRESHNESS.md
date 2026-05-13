# INVESTIGATION — ORCH-0816 — Brand KPI tile mislabel + brand-stats freshness gap

**Status:** root cause proven (high confidence).
**Mode:** INVESTIGATE.
**Date:** 2026-05-12.
**Owner:** Claude `mingla-forensics`.
**Trigger:** Operator question — "Last 7 days" tile on mingla-business home does not appear to register after ticket purchases. Are there other figures with the same problem?

---

## 1. Symptom summary

- **Expected:** "Last 7 days" tile on the mingla-business home screen reflects sales from the past 7 days, and updates promptly after each ticket purchase.
- **Actual (two defects, independent root causes):**
  - D-1 **Label mismatch.** The value rendered under the "Last 7 days" label is the **brand's lifetime GMV** — there is no time filter anywhere in the data path. The same number is rendered on the brand profile screen under the correct label "GMV · all time".
  - D-2 **Freshness gap.** Even the lifetime GMV does not refresh after a buyer checkout for up to 5 minutes (and potentially longer if no remount occurs). No Realtime subscription, no checkout-side cache invalidation, no pull-to-refresh, no window-focus refetch.

Per-event tiles (`useEventSalesSummaries`) feel "live" because they use a 15-second `staleTime`. This contrast is what made the brand-level tile feel broken to the operator.

---

## 2. Investigation manifest

| Order | File | Why |
|---|---|---|
| 1 | [mingla-business/app/(tabs)/home.tsx](mingla-business/app/%28tabs%29/home.tsx) | Find the tile and what value it binds to |
| 2 | [mingla-business/src/services/brandsService.ts](mingla-business/src/services/brandsService.ts) | Trace `brand.stats.rev` to its query |
| 3 | [mingla-business/src/hooks/useBrands.ts](mingla-business/src/hooks/useBrands.ts) | React Query freshness config for brand data |
| 4 | [mingla-business/src/config/queryClient.ts](mingla-business/src/config/queryClient.ts) | Global QueryClient defaults |
| 5 | [mingla-business/src/hooks/useEventOrders.ts](mingla-business/src/hooks/useEventOrders.ts) | Compare with per-event sales summary freshness |
| 6 | [mingla-business/src/components/brand/BrandProfileView.tsx](mingla-business/src/components/brand/BrandProfileView.tsx) | Find every other consumer of `brand.stats.*` |
| 7 | [mingla-business/src/hooks/useBrandStripeBankVerification.ts](mingla-business/src/hooks/useBrandStripeBankVerification.ts) | Authoritative pattern for `postgres_changes` realtime |
| 8 | `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` | Verify `orders` RLS + Realtime publication membership |
| 9 | `supabase/migrations/20260530000000_orch_0804_orders_tax_columns.sql` | Latest migration touching orders — confirm nothing else superseded the squash w.r.t. publication |
| 10 | `Mingla_Artifacts/MASTER_BUG_LIST.md` (header) | Allocate ORCH-ID; confirm no duplicate item open |

---

## 3. Findings

### 🔴 F-1 — ROOT CAUSE — "Last 7 days" tile is lifetime GMV, not a 7-day window

| Field | Evidence |
|---|---|
| File + line | [mingla-business/app/(tabs)/home.tsx:401-411](mingla-business/app/%28tabs%29/home.tsx#L401-L411) (consumer); [mingla-business/src/services/brandsService.ts:204-250](mingla-business/src/services/brandsService.ts#L204-L250) (producer) |
| Exact code (producer) | `await supabase.from("orders").select("...").in("events.brand_id", brandIds).not("payment_status", "in", "(failed,cancelled,refunded)")` — **no date predicate** |
| Exact code (consumer) | `<KpiTile label="Last 7 days" value={... formatCurrencyRound(currentBrand.stats.rev, ...) ...} />` |
| What it does | Sums `(total_cents - refunded_amount_cents)` across **all orders ever placed** for any of the brand's events, scoped only by `payment_status` exclusion. Result is bound to a tile labeled "Last 7 days". |
| What it should do | Sum only orders whose `created_at >= now() - interval '7 days'`. The label and the data must agree. |
| Causal chain | (1) `getBrands` / `getBrand` call `aggregateBrandStatsByBrandIds`. (2) That fn has no date filter. (3) Returned `agg.revByCurrencyCents` is bucketed only by currency. (4) `pickRevForCurrency` returns lifetime cents/100 as `stats.rev`. (5) `home.tsx` renders it under a "Last 7 days" label. → User sees a lifetime number believing it is a 7-day number. |
| Verification | Confirmed by reading the producer SQL: zero references to `created_at`, no `gte`, no `since`. Confirmed by reading BrandProfileView ([line 509-513](mingla-business/src/components/brand/BrandProfileView.tsx#L509-L513)) which binds the **same field** to a label `"all time"`. Two consumers + one source = the all-time label is correct, the 7-day label is the lie. |

Classification: **🔴 Root cause** (Constitution #9 "No fabricated data" — though the data itself is real, the label is fabricated relative to its content; user is misled about timeframe).

### 🔴 F-2 — ROOT CAUSE — Brand stats have no freshness signal after buyer purchase

| Field | Evidence |
|---|---|
| File + line | [mingla-business/src/hooks/useBrands.ts:44](mingla-business/src/hooks/useBrands.ts#L44) (`STALE_TIME_MS = 5 * 60 * 1000`); [mingla-business/src/config/queryClient.ts:35-37](mingla-business/src/config/queryClient.ts#L35-L37) (`refetchOnWindowFocus: false`); [mingla-business/app/(tabs)/home.tsx](mingla-business/app/%28tabs%29/home.tsx) — no `RefreshControl`; no Realtime subscription on `orders` anywhere in the brand-stats flow. |
| Exact code | `const STALE_TIME_MS = 5 * 60 * 1000; // 5 min — brands change infrequently` + `useQuery({ queryKey: ..., staleTime: STALE_TIME_MS, ... })` |
| What it does | After a buyer (anonymous, separate device/session) completes checkout: the server-side webhook updates `orders`. The brand owner's app has no listener on this table. The brand list query holds its cached result for 5 minutes and will not refetch on window focus or app foreground. On the next remount after staleness, it refetches — but only then. |
| What it should do | Within a few seconds of any non-failed order landing for any of the brand's events, the brand owner's stats tiles should reflect the new attendee count and GMV. |
| Causal chain | (1) Buyer checkout completes server-side. (2) `orders` row inserted with `payment_status = 'succeeded'`. (3) No mechanism on the owner's device is notified. (4) The `useBrands` cache continues to serve stale data for ≥5 min. (5) No `RefreshControl` lets the user force a refetch. → Owner perceives "sales don't register". |
| Verification | (a) Grep of `mingla-business/src` for `invalidateQueries.*brand` shows zero invalidations triggered by order/checkout/refund flows touching `brandKeys`. (b) Grep for `channel(`/`postgres_changes` shows only `useBrandStripeBankVerification` and `useBrandStripeStatus` use Realtime — `orders` has no subscriber. (c) `refetchOnWindowFocus: false` set globally — confirmed in queryClient. (d) Reading home.tsx ScrollView: no `RefreshControl` prop. |

Classification: **🔴 Root cause** (Constitution #2 contender — currently no owner refreshes server truth for `brand.stats`; the only "owner" is a stale cache).

### 🟠 F-3 — CONTRIBUTING FACTOR — `orders` is not in the `supabase_realtime` publication

| Field | Evidence |
|---|---|
| File + line | `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` — `ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public".<table>` lines do not include `orders`. Grep is empty for `ADD TABLE ONLY "public"."orders"` across all migrations. |
| What it does | Even if a client subscribes via `supabase.channel(...).on("postgres_changes", { table: "orders", ... })`, Postgres will not stream changes for this table — they aren't published. Subscriber silently never receives events. |
| What it should do | If we choose to use Realtime as a freshness signal (option C in the SPEC), `orders` must be added to the publication via migration. RLS on the `orders` table already gates SELECT to "Buyer or brand team can select orders", so brand-team members will receive events on their own brand's orders only — the publication change does not weaken security. |
| Causal chain | Constrains the SPEC: a Realtime-based fix requires a one-line publication migration, not just client code. Without it, a subscription is a silent no-op (Constitution #3 — silent failure risk). |

Classification: **🟠 Contributing factor** (relevant only if we choose the Realtime path; either way the SPEC must address it).

### 🟡 F-4 — HIDDEN FLAW — `brand.stats.attendees`, `brand.stats.events` share the freshness gap

| Field | Evidence |
|---|---|
| File + line | [mingla-business/src/components/brand/BrandProfileView.tsx:507-514](mingla-business/src/components/brand/BrandProfileView.tsx#L507-L514) — all three tiles read `brand.stats.*` and are populated by the same `useBrands`/`useBrand` query. |
| What it does | "Events" (count), "Attendees" (lifetime ticket count), and "GMV" (lifetime revenue) on the brand profile all share the 5-minute staleness, no realtime, no invalidate-on-purchase pipeline. |
| What it should do | Any fix to F-2 must cover all three fields, not just `rev`. The fix is in the source (`useBrands` hook + cache invalidation strategy), not at any single tile. |

Classification: **🟡 Hidden flaw** (no user-visible symptom called out yet, but the same root cause; the fix must be at the right layer to address all three).

### 🔵 F-5 — OBSERVATION — Per-event freshness is fine

| Field | Evidence |
|---|---|
| File + line | [mingla-business/src/hooks/useEventOrders.ts:66](mingla-business/src/hooks/useEventOrders.ts#L66), [:186](mingla-business/src/hooks/useEventOrders.ts#L186) — `staleTime: 15 * 1000`. Refund mutations invalidate every `event-orders` key for the event ([:233-237](mingla-business/src/hooks/useEventOrders.ts#L233-L237)). |
| Note | The 15-second staleTime is why the home hero's per-event "Tickets sold" and per-event KPI tiles feel responsive after a sale. This work should **not** touch `useEventOrders` — it is already at a good freshness/cost tradeoff. |

Classification: **🔵 Observation** (validates that the per-event design is a working reference point).

---

## 4. Five-layer cross-check

| Layer | Finding |
|---|---|
| **Docs** | `home.tsx` header comment (line 6) calls the surface a "7-day aggregate hero". README of the file documents an intent (7-day) that the code never implemented. |
| **Schema** | `orders.created_at` exists and is queryable. `orders` is **not** in the `supabase_realtime` publication. RLS allows brand-team SELECT on their orders. No schema change needed for the label/window fix; one line needed for Realtime. |
| **Code** | Producer (`aggregateBrandStatsByBrandIds`) has no date predicate. Consumer (`home.tsx:402`) labels the value "Last 7 days". Three layers — docs, label, code — disagree on whether this is 7-day or all-time. |
| **Runtime** | At runtime, a brand owner sees a value that climbs over the brand's lifetime, never decays as 7-day windows roll forward. After a sale, the value does not update for at least 5 minutes (often longer until app remount). |
| **Data** | The underlying `orders` rows have valid `created_at` timestamps. Lifetime totals are correct. The 7-day truth simply isn't computed. |

**Layers in contradiction:** Docs (says 7-day), Code (computes all-time), Label (says 7-day). The label and docs agree with each other but disagree with the code. The product intent (per the header comment) is the 7-day reading; the code never matched.

---

## 5. Blast radius

| Surface | Field bound | Label rendered | Impact |
|---|---|---|---|
| `mingla-business/app/(tabs)/home.tsx` (no live event) | `currentBrand.stats.rev` | **"Last 7 days"** | ❌ Mislabeled + stale |
| `mingla-business/src/components/brand/BrandProfileView.tsx` GMV tile | `brand.stats.rev` | "GMV / all time" | ⚠ Stale (label honest) |
| `BrandProfileView` Attendees tile | `brand.stats.attendees` | "Attendees / all time" | ⚠ Stale |
| `BrandProfileView` Events tile | `brand.stats.events` | "Events / all time" | ⚠ Stale (event creation/delete already invalidates a different key; lower urgency) |
| Per-event tiles in `home.tsx` Upcoming list | via `useEventSalesSummaries` | per-event labels | ✅ Fresh (15s staleTime) — not in scope |
| Brand profile hero (other surfaces) | `brand.stats.*` if rendered elsewhere | — | Will inherit the same fix |

No admin / app-mobile / edge function impact. Pure mingla-business client-side issue.

---

## 6. Invariant violations / Constitutional pressure

- **Constitution #9 (No fabricated data)** — the rendered text says "Last 7 days" but the data is lifetime. The numeric is not fabricated, but the temporal scope is. **Pressure: yes.** Spec must restore label/data agreement.
- **Constitution #3 (No silent failures)** — F-3: if a Realtime subscription is added without the publication change, the subscription succeeds and silently never delivers events. Spec must explicitly handle this.
- **Constitution #4 (One key per entity)** — already complied via `brandKeys` factory; the fix should reuse it.
- **Constitution #5 (Server state in React Query)** — already complied; the fix stays inside React Query.

No registered invariant is directly violated; no new invariant is required by this fix.

---

## 7. Fix strategy (direction only — full spec separately)

Two coordinated changes:

1. **Make the label honest about the window.** Extend `aggregateBrandStatsByBrandIds` to accept an optional `sinceMs: number | null` parameter; pass `now - 7d` from the home tile path, leave `null` (lifetime) for the BrandProfileView path. Either: (a) split into `useBrandStatsWindow(brandId, sinceMs)` and the existing lifetime query, OR (b) keep one query but compute both lifetime + last-7-day in a single pass and expose both on `Brand.stats`. Recommend (b) — same network cost, both surfaces stay in sync.
2. **Close the freshness gap.** Three layered mechanisms:
   - Reduce `staleTime` on `useBrands`/`useBrand` from 5 min → 30 s.
   - Add a `RefreshControl` to the `home.tsx` and `BrandProfileView` ScrollViews that invalidates `brandKeys.all` and `eventOrdersKeys.all`.
   - Add a Realtime listener on `orders` filtered by `event_id IN (brand's events)` (or, simpler, by tracking on the client and matching brand-side) — mirroring `useBrandStripeBankVerification`. Requires migration to add `orders` to `supabase_realtime` publication.

---

## 8. Regression prevention requirements

- A unit test for `aggregateBrandStatsByBrandIds` that asserts: given two orders 8 days apart, a `sinceMs = now - 7d` call returns only the recent one and a `sinceMs = null` call returns both.
- A unit test asserting `brand.stats.rev7d` is computed from window=7d and `brand.stats.rev` is computed from window=null (or whichever shape the spec chooses).
- A snapshot/render test on `home.tsx` confirming the tile labelled "Last 7 days" binds to the windowed field.
- A `RefreshControl` smoke test that confirms `brandKeys.all` is in the invalidation set.
- Manual TestFlight smoke: create order → confirm tile reflects new value within 30 s (or immediately if Realtime path is chosen) without backgrounding the app.

---

## 9. Discoveries for orchestrator

- **Docs/Code drift:** `home.tsx` header (line 6) describes the surface intent as "7-day aggregate hero". The implementation has never matched that intent. No action other than the fix needed, but the comment is evidence that the original product intent was always 7-day.
- **Cycle-B5 marketing hub (ORCH-0815, currently in flight Phase A):** This work does not collide with marketing-hub scope. The brand-stats query is owned by `brandsService.ts`; the marketing hub work creates new tables under `mingla-business/src/services/marketing/`. No risk of merge conflict, but the SPEC should be implemented after Phase A merges to avoid two simultaneous mutations to brand profile UI.
- **Pattern reference:** `useBrandStripeBankVerification` is the canonical Realtime pattern in this app. Reuse verbatim for the orders listener — channel name with `Date.now()` suffix + random tail, single useEffect, cleanup via `removeChannel`.
- **`orders` publication membership:** The Realtime path requires a one-line migration. If the operator wants to avoid migrations entirely, the SPEC can ship without (c) and rely on (a) + (b) alone. Recommended to include (c) — sales are the most time-sensitive product signal a brand owner watches.

---

## 10. Confidence

**High.** Six-field evidence on both root causes. Five-layer cross-check shows clear contradiction between code and label. No layer assumption uncorroborated. The Realtime publication finding is corroborated by direct grep of the squash migration plus absence of any later `ALTER PUBLICATION` line touching `orders`.

---

## 11. Spec handoff

A SPEC has been drafted in parallel at
`Mingla_Artifacts/specs/SPEC_ORCH-0816_BRAND_KPI_TILE_LABEL_AND_FRESHNESS.md`.
It addresses F-1, F-2, F-3, F-4. F-5 is acknowledged and excluded from scope.
