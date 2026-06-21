# SPEC — ORCH-1186-B: Venue Overview → Intelligence Dashboard

**META:** META-ORCH-1186 Venue Unification · **Leg:** 2 (sequence Leg1→Leg2→Leg4→Leg3)
**Worktree:** `~/Desktop/mingla-orchs/1186-[venue-unify]` · **Branch:** `1186-venue-unify` (at origin/main `89ab7f3ff`, INCLUDES the #580 venue command-center desktop redesign)
**Mode:** SPEC (no product code written). Author: mingla-forensics.
**Date:** 2026-06-21
**Investigation basis:** code-verified data inventory (this SPEC; two read-only forensic sweeps pinned inline). No prior INVESTIGATION_ORCH-1186-B report exists — this leg is a greenfield build off verified ground truth, not a bug fix, so the data inventory below stands in for it. If a gap surfaces during IMPLEMENT, STOP and request re-investigation; do not investigate-and-build.

---

## 1. Executive summary

The venue suite's **Overview** module today renders `VenueListingContent.tsx` — a read-only recap of the listing (status, what-you-submitted, AI match scores, changes-remaining, manage actions). Leg 1 (ORCH-1186-A) relocates ALL of that recap content into the **Settings** module as real editors. That frees the Overview surface.

This leg repurposes Overview into a **venue intelligence dashboard** that surfaces, **from real data only**:
1. **Slow hours** — orders bucketed by hour-of-day in the venue's local timezone.
2. **Slow days** — orders bucketed by day-of-week in the venue's local timezone.
3. **Revenue trend** — a 30-day daily revenue series (reusing the existing CSS-bar sparkline convention) + lifetime/7-day headline figures.
4. **Signal effectiveness** — the venue's `ai_signal_scores`, reframed as "which moments you win" (re-homed from the listing recap, now read-only intelligence, not an editor — the editor lives in Settings per Leg 1).

Every tile renders **only when there is enough real data**, with an honest "not enough data yet" empty state otherwise (Constitution #9, no fabrication). BestTime foot-traffic, page-view/impression/CTR, and signal→conversion attribution have **no capture in the codebase today** — they are rendered as explicitly-labeled "Coming soon" tiles (justified in §3), never faked.

All money is currency-aware (Constitution #10) via the canonical `utils/currency.ts` helpers; all time bucketing is done in the venue's local timezone (Constitution #12), resolved server-side in a new RPC.

---

## 2. Scope & non-goals

### In scope
- A new read-only intelligence component mounted by `VenueSuiteShell` for `activeModule === "overview"`.
- A new read RPC `venue_intelligence_overview(p_brand_id uuid)` (SECURITY DEFINER, owner-scoped) that returns slow-hours / slow-days / revenue-trend / signal-effectiveness aggregations computed server-side with timezone-correct bucketing.
- A new hook + service wrapping that RPC.
- Honest empty/insufficient-data states with exact copy + numeric thresholds.
- Three "Coming soon" placeholder tiles (BestTime busy-hours, page views/CTR, signal→conversion attribution).
- A fails-on-revert regression test on the aggregation correctness (SQL fixture) + a no-fabrication source-grep test.

### Non-goals (explicit)
- **NG-1: No Settings editors.** Leg 1 owns relocating the listing recap into Settings. This leg only *consumes* `ai_signal_scores` read-only; it does NOT build the AI re-run or any editor. If Leg 1 has not yet landed when this leg implements, see §10 OQ-1.
- **NG-2: No new data capture.** No BestTime API call, no page-view/impression table, no attribution join. Those are "Coming soon" tiles only. Building any capture is OUT (Constitution #9 forbids surfacing fabricated/derived-from-nothing metrics; building the pipeline is a separate future ORCH).
- **NG-3: No new timezone column write.** This leg READS an existing timezone source (§4.1 resolution ladder); it does NOT add a per-brand IANA timezone column or backfill (that is a candidate for Leg 1 / a future ORCH — see §10 OQ-2).
- **NG-4: No consumer-app or public-page change.** Intelligence is owner-only, business-app + business-web-desktop only.
- **NG-5: No reservations-data intelligence.** Reservations/turn-time/occupancy analytics are out (no completed-reservation dataset exists yet at scale — META-ORCH-1148 notes 0 reservations completed e2e). Intelligence is sourced from `orders` only.
- **NG-6: No charting library.** Reuse the existing CSS-`<View>`-bar sparkline pattern (`BrandFinanceReportsView.tsx:148-172`, `barWrap` styles). Do NOT add `react-native-svg`/`victory`/`recharts`.

### Assumptions
- Leg 1 has relocated `VenueListingContent`'s recap into Settings, so the Overview slot in `VenueSuiteShell.renderWorkspace()` is free to repoint. This SPEC defines the hand-off (§4.0) but does not re-spec Leg 1's editors.
- A venue (claimed brand) has `placePoolId !== null`. The intelligence dashboard is meaningful only for venues; for a brand with no `place_pool` the dashboard shows the global empty state (§4.6 E-0).

---

## 3. Cross-Surface Impact Declaration (MANDATORY)

| # | Surface | Covered? | User-visible behavior | Files touched there | Parity |
|---|---------|----------|----------------------|---------------------|--------|
| 1 | Consumer iOS (`app-mobile/` iOS) | NOT | Reason: owner-only intelligence; consumer never sees the venue suite. | none | n/a |
| 2 | Consumer Android | NOT | Same reason as #1. | none | n/a |
| 3 | Buyer/anon Web | NOT | Reason: intelligence is private to the venue owner; never on a public page. | none | n/a |
| 4 | Business iOS | **COVERED** | Overview module shows the intelligence dashboard (real tiles + honest empties + coming-soon). | `VenueSuiteShell.tsx`, new `VenueIntelligenceModule.tsx`, new hook/service | Automatic (shared RN component) |
| 5 | Business Android | **COVERED** | Same as #4. Android glass = opaque fallback per policy on any GlassCard used. | same as #4 | Automatic (shared RN component) — verify Android opaque-fill on new cards |
| 6 | Admin Web (`mingla-admin/`) | NOT | Reason: admin does not render the business venue suite. | none | n/a |
| 7 | Business Web preview (desktop, `isWideDesktop`) | **COVERED** | Same dashboard renders in the desktop workspace column (the suite already renders both via `useResponsiveLayout`). | `VenueSuiteShell.tsx` (desktop branch already routes through `renderWorkspace`) | Automatic (one component for both shell branches) |

**Coming-soon tiles — justification for LABEL over OMIT:**
- BestTime busy-hours, page-views/CTR, signal→conversion attribution are rendered as **labeled "Coming soon" tiles**, NOT omitted. Justification: the charter ROBUST GOAL #3 explicitly requires these be "stubbed/labeled 'coming' not faked," and Seth's intent (charter line 26) is that the dashboard communicate the *roadmap* of intelligence, not silently hide it. A labeled tile sets honest expectations and is itself a no-fabrication-compliant artifact (it shows zero data and says so). The alternative (omit) would make the dashboard look "finished" and hide that richer intelligence is coming. **Constraint:** a coming-soon tile MUST render NO numbers, NO `$`, NO fabricated bars — only the title + "Coming soon" pill + one-line description. Enforced by the no-fabrication test (§9).

---

## 4. Layered specification

### 4.0 Hand-off from Leg 1 (what moves OUT, what comes IN) — NOT a re-spec of Leg 1

**Moves OUT of the Overview slot (Leg 1 owns the destination):**
- `VenueListingContent.tsx` (the whole recap: status badge, "What you submitted", "How you match Mingla moments" AI-score list, "Changes remaining", manage actions, claim-feedback banner/sheet) → relocated by Leg 1 into the Settings module as editors. **Do NOT delete `VenueListingContent.tsx` in this leg** — Leg 1 owns its disposition; this leg only stops mounting it at the Overview slot (§4.5). If Leg 1 already removed the Overview mount, this leg replaces whatever stub it left.
- The `!reservationsEnabled` "Take table reservations" invitation card currently pinned above the listing in `VenueSuiteShell.renderWorkspace()` (`VenueSuiteShell.tsx:135-156`): **KEEP it** — it is a reservations-activation CTA, orthogonal to the listing recap, and still belongs at the top of Overview (intelligence dashboard below it). It is NOT part of the Leg-1 relocation.

**Comes IN to the Overview slot (this leg):**
- `<VenueIntelligenceModule brandId={brandId} />` — the new dashboard (§4.5), rendered below the (kept) reservations invitation card.

**Data the dashboard reuses from the recap (read-only, no editor):**
- `ai_signal_scores` — same source the recap read (`useBrandPlaceAuthoringContext` → `ctx.data.ai_signal_scores`, `businessPlaceAuthoringService.ts:104,109-113`). Re-rendered here as "Which moments you win" (§4.5 Tile D). This is a READ; the re-run/edit affordance lives in Settings (Leg 1, NG-1).

### 4.1 Timezone resolution (CRITICAL — Constitution #12)

**Verified ground truth:** there is **NO DST-aware per-brand/per-venue IANA timezone column** on `brands` or `place_pool` (forensic sweep 2, §3). Available signals, in priority order:
1. `venue_availability_config.iana_timezone` (IANA, DST-aware) — `supabase/migrations/20261008000000_orch_1148_availability_iana_timezone.sql:40-41`. Present ONLY for venues that set up the reservations availability engine.
2. The brand's events' `events.timezone` (IANA, DST-aware, default `'UTC'`) — `baseline_squash:7815`. Present for any brand that created an event with a real venue address.
3. `place_pool.utc_offset_minutes` (static integer offset, NOT DST-aware, often NULL for older places) — `baseline_squash:7159`. Last resort, DST-unsafe.
4. `'UTC'` — final fallback.

**RPC resolution ladder (server-side, single source):** the RPC computes `v_tz text` once as:
```
COALESCE(
  vac.iana_timezone,                        -- (1) reservations config
  (most-common non-UTC events.timezone for this brand),  -- (2)
  derive-from utc_offset_minutes if present,  -- (3) see note
  'UTC')                                     -- (4)
```
Note on (3): a static offset cannot be safely converted to an IANA zone. If only `utc_offset_minutes` is available, the RPC buckets using a fixed-offset interval (`ts AT TIME ZONE INTERVAL`), and the RPC returns a `tz_confidence` field (`'iana' | 'offset' | 'utc'`) so the UI can footnote "approximate (timezone not fully configured)". This keeps the metric honest rather than silently UTC-wrong.

**RPC returns `resolved_timezone text` + `tz_confidence text`** so the component can render the timezone label (e.g. "times in America/New_York") and the approximate-footnote when confidence is `'offset'`/`'utc'`.

### 4.2 Database — new RPC (no new table, no new column)

**Migration file:** `supabase/migrations/20261021000000_orch_1186b_venue_intelligence_overview.sql`
- Collision-check performed: latest migrations on origin/main include `20261008000000_orch_1148_*` and the 1009 series; `20261021000000` is monotonic-after and unused. **The implementor MUST re-run the collision check** (`ls supabase/migrations/ | sort | tail` and confirm no `20261021000000*` exists) before creating the file, and bump the date-stamp if a sibling leg/session landed one first.

**Function:** `public.venue_intelligence_overview(p_brand_id uuid)` — `RETURNS jsonb`, `SECURITY DEFINER`, `SET search_path = public`, `LANGUAGE plpgsql`.

**Authorization (fail-closed, owner-only):** at entry, assert the caller owns the brand:
```
IF NOT EXISTS (SELECT 1 FROM public.brands b
               WHERE b.id = p_brand_id AND b.account_id = auth.uid()) THEN
  RAISE EXCEPTION 'not authorized for brand %', p_brand_id USING ERRCODE = '42501';
END IF;
```
(Confirm the owning column name against the `brands` table — the implementor verifies `account_id` vs `owner_account_id` from the latest `brands` migration; if different, use the verified column. This is a stop-and-amend point only if neither exists.)

**`GRANT EXECUTE ON FUNCTION public.venue_intelligence_overview(uuid) TO authenticated;`** Revoke from `anon`/`public`.

**Source set:** all non-failed/non-cancelled paid orders across the brand's events:
```
FROM public.orders o
JOIN public.events e ON e.id = o.event_id AND e.brand_id = p_brand_id AND e.deleted_at IS NULL
WHERE o.payment_status NOT IN ('failed','cancelled','refunded')
```
Use `COALESCE(o.confirmed_at, o.created_at)` as the order timestamp (the "paid at" instant, matching `eventOrdersService.ts:255` `paidAt = confirmed_at ?? created_at`). Net revenue per order = `o.total_cents - COALESCE(o.refunded_amount_cents,0)` (matching `brandsService.ts:577`).

**Currency handling (Constitution #10):** revenue is bucketed **per-currency** server-side (a `jsonb` keyed by currency code), mirroring `aggregateBrandStatsByBrandIds` (`brandsService.ts:580-589`). The RPC also returns `brand_default_currency` (from `brands.default_currency`) so the UI shows the headline in the brand's default currency and footnotes mixed-currency cases. **Never sum across currencies into one number.**

**Returned JSON shape (contract):**
```jsonc
{
  "resolved_timezone": "America/New_York",
  "tz_confidence": "iana",                  // 'iana' | 'offset' | 'utc'
  "brand_default_currency": "USD",
  "order_count": 137,                        // total qualifying orders (threshold gate)
  "first_order_at": "2026-04-02T18:11:00Z",  // null if none
  "hours": [ { "hour": 0, "orders": 0 }, ... 24 rows, hour 0..23 ],   // bucketed by EXTRACT(hour FROM ts AT TIME ZONE v_tz)
  "days":  [ { "weekday": 0, "orders": 0 }, ... 7 rows, weekday 0..6 ],// 0=Monday..6=Sunday (match brand_hours convention, baseline weekday semantics)
  "revenue_trend": {                          // last 30 calendar days, venue-local
    "currency": "USD",                        // brand_default_currency bucket only
    "days": [ { "date": "2026-05-23", "net_cents": 0 }, ... 30 rows ] // oldest→newest
  },
  "revenue_by_currency": { "USD": 412300, "GBP": 0 },  // lifetime net cents per currency
  "rev7d_by_currency":  { "USD": 38900 },              // last-7-day net cents per currency
  "signal_scores": [ { "id": "romantic", "score": 88 }, ... ]  // from ai_signal_scores, inappropriate_for=false only, desc
}
```
- **Day-of-week convention MUST be 0=Monday..6=Sunday** to match `brand_hours.weekday` (`ve1...sql:62-72`) and the app's existing weekday semantics. Postgres `EXTRACT(dow ...)` returns 0=Sunday; the RPC remaps `((dow + 6) % 7)` → 0=Monday. **This remap is a fails-on-revert test target (§9).**
- `hours` always returns all 24 buckets (0-fill missing hours); `days` always returns all 7. This lets the UI render a full bar row and identify the *minimum* (slow) bucket honestly.
- `signal_scores` reads `place_pool.ai_signal_scores` via the brand's `place_pool_id`; filters `inappropriate_for = true` out (matching `VenueListingContent.tsx:211`); returns `[]` if the brand has no `place_pool` or no scores.

**RLS:** no new table. The RPC is SECURITY DEFINER with an explicit owner check (above); it does NOT bypass any table RLS for the caller because it self-authorizes on `auth.uid()`.

### 4.3 Service

**File:** `mingla-business/src/services/venueIntelligenceService.ts` (new).
**Signature:** `export async function fetchVenueIntelligence(brandId: string): Promise<VenueIntelligence>`.
- Calls `supabase.rpc("venue_intelligence_overview", { p_brand_id: brandId })`.
- Error contract: **throws** on RPC error (React Query surfaces it; matches `eventOrdersService` convention which throws).
- Parses the `jsonb` into a typed `VenueIntelligence` interface (defined in this file or `types/`):
```ts
export interface VenueIntelligence {
  resolvedTimezone: string;
  tzConfidence: "iana" | "offset" | "utc";
  brandDefaultCurrency: string;
  orderCount: number;
  firstOrderAt: string | null;
  hours: { hour: number; orders: number }[];       // length 24
  days: { weekday: number; orders: number }[];      // length 7, 0=Mon
  revenueTrend: { currency: string; days: { date: string; netCents: number }[] }; // length 30
  revenueByCurrency: Record<string, number>;
  rev7dByCurrency: Record<string, number>;
  signalScores: { id: string; score: number }[];
}
```
- Defensive: if the RPC returns null/empty, return a zero-filled `VenueIntelligence` (orderCount 0, empty arrays) rather than throwing — so the UI shows empties, not an error, for a brand-new venue.

### 4.4 Hook

**File:** `mingla-business/src/hooks/useVenueIntelligence.ts` (new).
**Signature:** `export function useVenueIntelligence(brandId: string | null)`.
- React Query. **Key (from a key factory or inline):** `["venue-intelligence", brandId]`. (Do NOT reuse the `["event-orders", ...]` or `["brand-stats", ...]` keys — distinct entity, avoid cache drift.)
- `enabled: brandId !== null` AND auth session present (mirror `useEventOrders.ts:63` gating).
- `staleTime`: 60_000 (intelligence is not real-time; 60s is generous and avoids refetch thrash on module switches).
- Returns the standard `{ data, isLoading, isError, refetch }`.

### 4.5 Component

**File:** `mingla-business/src/components/venue/VenueIntelligenceModule.tsx` (new).
**Props:** `{ brandId: string | null }`.
**Self-scroll contract:** the component **owns its own `ScrollView`** with bottom-nav clearance `insets.bottom + 120` (the shared `VENUE_SCROLL_NAV_CLEARANCE`, `venueShellScroll.ts:22`), exactly like `VenueListingContent` did. Because `moduleSelfScrolls("overview")` already returns `true` (`venueShellScroll.ts:28-30`), the shell will NOT wrap it in a second ScrollView — **this contract is preserved; do NOT change `moduleSelfScrolls`.**

**Visual convention:** `GlassCard` tiles (matching the suite). Android: opaque fallback per `ANDROID_GLASS_USES_OPAQUE_FALLBACK` policy. Design tokens from `constants/designSystem`. Bars reuse the CSS-`<View>` pattern from `BrandFinanceReportsView.tsx` (normalized 0..100 height, `barWrap` styling) — NO svg.

**Tiles, in order:**

- **Tile A — Revenue (headline + 30-day trend).**
  - Headline: lifetime net + 7-day net in the brand default currency, via `formatCurrencyRound(revenueByCurrency[defaultCurrency], defaultCurrency, true)` and `formatCurrencyRound(rev7dByCurrency[defaultCurrency], defaultCurrency, true)` (`currency.ts:116`, `minor=true` because RPC returns cents).
  - 30-day bar sparkline from `revenueTrend.days[].netCents`, normalized 0..100 (reuse `computeSparklineBars` algorithm shape, `BrandFinanceReportsView.tsx:148-172`).
  - Mixed-currency footnote: if `>1` currency has non-zero revenue, append "Showing {DEFAULT} only — you also have sales in {others}."
  - **Empty (E-A):** if `orderCount === 0` → see §4.6.

- **Tile B — Slow hours.** A 24-bar row (hour 0..23), bars from `hours[].orders` normalized 0..100. Highlight the lowest-nonzero-context bucket(s) and surface a one-line takeaway: "Quietest around {hourLabel}." Label times in `resolvedTimezone`. If `tzConfidence !== 'iana'`, footnote "Times approximate — set your venue timezone for precision."
  - **Empty (E-B):** threshold `orderCount < 14` → see §4.6 (need ≥14 orders before slow-hours is meaningful — see §4.6 rationale).

- **Tile C — Slow days.** A 7-bar row (Mon..Sun), bars from `days[].orders`. Takeaway: "Slowest day: {weekdayLabel}." Cross-reference `brand_hours` is OUT of this leg (no need; the bars already show it).
  - **Empty (E-C):** threshold `orderCount < 14` → see §4.6.

- **Tile D — Which moments you win (signal effectiveness).** The `signalScores` list rendered as labeled score bars (reuse the score-bar styling from `VenueListingContent.tsx:346-361` / `scoreBarTrack`/`scoreBarFill`), `venueSignalLabel(id)` for labels (`constants/venueSignals.ts`). Reframe copy: "Where Mingla recommends you most. Improve these in Settings." (No editor here — NG-1.)
  - **Empty (E-D):** if `signalScores.length === 0` → "We haven't scored this venue yet. Add details in Settings and run 'Recommend me' to see where you win."

- **Tiles E/F/G — Coming soon (labeled, NO data):**
  - **E — Busy hours (foot traffic):** "Coming soon" pill + "See when people actually visit, powered by live foot-traffic data."
  - **F — Page views & taps:** "Coming soon" pill + "How many people viewed your venue page and tapped through."
  - **G — Signal → bookings:** "Coming soon" pill + "Which moments actually turn into bookings."
  - These render NO numbers/`$`/bars. (No-fabrication test §9 enforces this.)

**Module-level loading state:** `isLoading` → centered `ActivityIndicator` (match `VenueListingContent.tsx:261-264`).
**Module-level error state:** `isError` → a single GlassCard "Couldn't load your venue insights. Pull to refresh or try again." with a retry `Button` calling `refetch()`.

### 4.6 Honest empty/insufficient-data states (exact copy + thresholds)

| ID | Condition | Threshold rationale | Exact copy |
|----|-----------|--------------------|-----------|
| E-0 | `brandId === null` OR brand has no `place_pool` (not a venue) | Intelligence is venue-only | Title: "No venue insights yet" · Body: "Add your venue to start seeing how it performs on Mingla." (mirrors `VenueListingContent.tsx:251-260` no-venue card; reuses the "Add your venue" CTA → `/venue/create`.) |
| E-A | `orderCount === 0` (Revenue tile) | Zero sales = nothing to chart | Title: "No sales yet" · Body: "When people book or buy on Mingla, your revenue and trends show up here." (NO `$`, NO zero-bars.) |
| E-B / E-C | `orderCount < 14` (Slow hours / Slow days tiles) | Below ~2 orders/day-equivalent the hour/day buckets are noise, not signal; 14 is the smallest honest floor (a "couple weeks of activity" framing). | Title: "Not enough data yet" · Body: "We'll show your slow {hours/days} once you've had a bit more activity — about {14 - orderCount} more {order/orders} to go." (Render the count honestly from real `orderCount`.) |
| E-D | `signalScores.length === 0` | No AI scores computed | "We haven't scored this venue yet. Add details in Settings and run 'Recommend me' to see where you win." |

**Threshold constant** `INTELLIGENCE_MIN_ORDERS_FOR_TIME_BUCKETS = 14` lives in the component (or a small `venueIntelligence.ts` pure module) and is the fails-on-revert anchor for the empty-state test (§9). It is intentionally a single named constant so the test can assert the gate.

**No-fabrication rule:** when a tile is in an empty state it renders the copy above and **NO bars, NO numbers, NO `$`**. Constitution #9 / `I-PROPOSED-1186-INTELLIGENCE-NO-FABRICATION`.

### 4.7 Shell wiring

**File:** `mingla-business/src/components/venue/VenueSuiteShell.tsx`.
- In `renderWorkspace()` for `activeModule === "overview"` (`VenueSuiteShell.tsx:127-164`): KEEP the `!reservationsEnabled` invitation card (`:135-156`); REPLACE `<VenueListingContent brandId chromeMode="tab" />` (`:157-161`) with `<VenueIntelligenceModule brandId={brandId} />`.
- Remove the now-unused `VenueListingContent` import IF Leg 1 hasn't already (the `focus` prop forwarding becomes unused at the Overview slot — confirm `focus` isn't consumed elsewhere in the shell before dropping the prop thread; it is only passed to `VenueListingContent` today at `:159`). **Do NOT delete `VenueListingContent.tsx` the file** (NG-1 / Leg 1 owns it).
- The `moduleSelfScrolls("overview")` path (`:124`, `:199`, `:225`) stays — the new module self-scrolls, same contract.

---

## 5. Success criteria (observable, testable)

- **SC-1 (RPC correctness — slow hours):** Given a fixture of orders at known `confirmed_at` instants in a venue with `iana_timezone='America/New_York'`, `venue_intelligence_overview` returns `hours` with the count landing in the venue-local hour bucket (NOT the UTC hour). Test: an order at `2026-05-01T01:30:00Z` (UTC) lands in hour `21` (EDT, UTC-4), not hour `1`.
- **SC-2 (RPC correctness — slow days, Mon=0):** An order whose venue-local instant is a Tuesday returns in `days[]` with `weekday === 1` (0=Mon convention). A Sunday → `weekday === 6`.
- **SC-3 (RPC currency safety):** A brand with orders in USD and GBP returns `revenue_by_currency` with separate `USD`/`GBP` keys; `revenue_trend.currency === brand_default_currency`; no key sums across currencies.
- **SC-4 (RPC authorization):** Calling the RPC for a brand the caller does not own raises `42501` (not authorized); the caller receives no data.
- **SC-5-iOS / SC-5-Android (empty: no orders):** A venue with `orderCount === 0` shows the E-A revenue empty ("No sales yet"), and the slow-hours/slow-days tiles show E-B/E-C ("Not enough data yet"), with NO `$` and NO bars rendered.
- **SC-6-iOS / SC-6-Android (populated):** A venue with `orderCount ≥ 14` renders the 30-day revenue sparkline, the 24-hour bar row, the 7-day bar row, and the signal-score bars, all from RPC data.
- **SC-7 (timezone footnote):** When `tz_confidence !== 'iana'`, the slow-hours tile renders the "Times approximate" footnote; when `'iana'`, it renders "times in {zone}" without the approximate footnote.
- **SC-8 (coming-soon honesty):** The three coming-soon tiles render their title + "Coming soon" pill + description and contain NO `$`, NO numeric metric, NO bar elements.
- **SC-9 (no listing recap left at Overview):** The Overview module no longer renders the listing recap ("What you submitted", "Changes remaining", manage-actions); that content is reachable only via Settings (Leg 1). The reservations-activation invitation card is still present when `reservationsEnabled === false`.
- **SC-10 (currency-aware headline):** Revenue headline formats via `formatCurrencyRound(..., brandDefaultCurrency, true)` — a USD brand shows `$`, a GBP brand shows `£`, never a hardcoded symbol.

---

## 6. Invariants

**Preserves:**
- `I-PROPOSED-1148-RESERVATION-TOGGLE-GATES-SUITE` (`venueModules.ts:6-12`): this leg does not touch `deriveVenueModules`; the Overview/Settings module set is unchanged. Verified by the existing `venueModules.test.ts` staying green.
- `I-AI-SIGNAL-SCORES-COLUMN-SOLE-OWNER` (forensic sweep 2): this leg only READS `place_pool.ai_signal_scores` (via the RPC and the existing context hook); it never writes it. The sole writer remains `run-place-intelligence-trial`.
- Venue-suite self-scroll contract (`venueShellScroll.ts`): the new module self-scrolls; `moduleSelfScrolls("overview")` unchanged.

**Establishes (DRAFT — flip ACTIVE on CLOSE; orchestrator owns the flip):**
- `I-PROPOSED-1186-INTELLIGENCE-NO-FABRICATION` (from charter line 66) — the venue overview intelligence renders ONLY real aggregations from `orders` + `ai_signal_scores`; every tile with insufficient data shows an honest empty state with NO numbers/`$`/bars; coming-soon tiles carry NO data. Verified by §9 tests.
- `I-PROPOSED-1186-INTELLIGENCE-TZ-LOCAL` (new) — slow-hours/slow-days bucketing is computed in the venue's resolved local timezone (RPC `AT TIME ZONE v_tz`), never raw UTC; the weekday convention is 0=Monday..6=Sunday (matching `brand_hours`). Verified by SC-1/SC-2.
- `I-PROPOSED-1186-INTELLIGENCE-CURRENCY-BUCKETED` (new) — revenue is never summed across currencies; the RPC returns per-currency buckets and the UI renders the brand default currency only, footnoting others. Verified by SC-3.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-1 (happy, tz) | Order at UTC midnight, NY venue | `confirmed_at='2026-05-01T01:30:00Z'`, `iana_timezone='America/New_York'` | `hours[21].orders === 1` | DB/RPC (SQL fixture) |
| T-2 (happy, dow) | Order on a venue-local Tuesday | local Tue instant | `days` row `weekday===1` (Mon=0) | DB/RPC |
| T-3 (revert anchor) | Revert the `(dow+6)%7` remap | RPC uses raw Postgres dow | T-2 FAILS (Sunday→0 wrong) | DB/RPC |
| T-4 (currency) | USD + GBP orders | mixed-currency order set | `revenue_by_currency` has both keys; trend currency = default; no cross-sum | DB/RPC |
| T-5 (authz, error) | Non-owner caller | `auth.uid()` ≠ brand owner | raises `42501` | DB/RPC |
| T-6 (edge, refund) | Refunded order excluded | `payment_status='refunded'` | not counted in `order_count`/buckets | DB/RPC |
| T-7 (edge, partial refund) | Partial refund netted | `refunded_amount_cents>0`, status `partial_refund` | counted; net = total - refunded | DB/RPC |
| T-8 (empty) | Zero orders | `orderCount===0` | component shows E-A; source has no `$`/bars in empty branch | Component (source-grep + render) |
| T-9 (threshold) | 13 orders | `orderCount===13 < 14` | slow-hours/slow-days show E-B/E-C "Not enough data yet" | Component |
| T-10 (coming-soon honesty) | Always | render module | coming-soon tiles contain no `$`/number/bar | Component (source-grep) |
| T-11 (currency-aware) | GBP brand | `brandDefaultCurrency='GBP'` | headline shows `£`, not `$` | Component |

---

## 8. Implementation order

1. **DB:** create `supabase/migrations/20261021000000_orch_1186b_venue_intelligence_overview.sql` (re-run collision check first; verify `brands` owner column). Apply via the sanctioned path (MCP `apply_migration` / Management API per `feedback_edge_deploy_and_migration_apply_hazards.md` — NOT a stale-worktree `db push`). Write the SQL fixture test (T-1..T-7) as a `.sql` test or a pgTAP-style assertion run against a seeded fixture.
2. **Service:** `venueIntelligenceService.ts` + `VenueIntelligence` type.
3. **Hook:** `useVenueIntelligence.ts`.
4. **Component:** `VenueIntelligenceModule.tsx` (tiles A–G, empties E-0/E-A/E-B/E-C/E-D, loading, error).
5. **Shell wiring:** repoint `VenueSuiteShell.renderWorkspace()` Overview slot to the new module (keep invitation card; drop the `VenueListingContent` mount + unused `focus` thread at that slot).
6. **Tests:** SQL fixture (T-1..T-7), component tests (T-8..T-11), no-fabrication source-grep (§9).

---

## 9. Regression prevention (fails-on-revert contract)

**Safeguard 1 — aggregation correctness (the primary fails-on-revert anchor).**
- Test: a SQL fixture test seeds `events` (brand_id, with a known `events.timezone` or a `venue_availability_config.iana_timezone`) + `orders` at hand-computed UTC instants, calls `venue_intelligence_overview`, and asserts the `hours`/`days`/`revenue_*` buckets exactly (T-1..T-7).
- **Fails-on-revert proof required:** reverting the `AT TIME ZONE v_tz` clause to raw UTC MUST flip T-1 to FAIL; reverting the `(dow+6)%7` weekday remap MUST flip T-2/T-3 to FAIL; reverting the per-currency bucketing to a cross-currency `SUM` MUST flip T-4 to FAIL. The implementor demonstrates each revert→fail→restore→pass in the implementation report.
- Protective comment in the migration: a header block stating "buckets are venue-local (Constitution #12); weekday is 0=Mon to match brand_hours; revenue is per-currency, never cross-summed (Constitution #10) — see SPEC ORCH-1186-B §4.2."

**Safeguard 2 — no-fabrication source-grep (mirrors the proven `overview-no-revenue.test.ts` pattern, `app/(tabs)/marketing/__tests__/overview-no-revenue.test.ts`).**
- Test file: `mingla-business/src/components/venue/__tests__/venueIntelligence.noFabrication.test.ts`.
- Reads `VenueIntelligenceModule.tsx` from disk and asserts: the three coming-soon tiles' JSX region contains no `$` literal (outside `${}`), no digit-bearing metric, no `<View style={styles.bar` element; AND the file imports/uses `formatCurrencyRound`/`formatCurrency` from `utils/currency` (no ad-hoc `Intl.NumberFormat`); AND `INTELLIGENCE_MIN_ORDERS_FOR_TIME_BUCKETS === 14` is present (the empty-state threshold anchor).
- **Fails-on-revert proof:** hardcoding a fake "$1,240" into a coming-soon tile, or lowering the threshold to 0, MUST flip this test to FAIL.

**Safeguard 3 — overview-no-listing-recap (parity with Leg 1 hand-off).**
- A source-grep on `VenueSuiteShell.tsx` asserting the Overview slot renders `VenueIntelligenceModule` and NOT `VenueListingContent`. Fails-on-revert: re-mounting `VenueListingContent` at Overview flips it.

---

## 10. Open questions

- **OQ-1 (Leg 1 ordering dependency):** This leg assumes Leg 1 has relocated the listing recap into Settings. If IMPLEMENT of this leg starts before Leg 1's Settings editors land, the recap content would be temporarily unreachable (removed from Overview, not yet in Settings). **Recommendation:** honor the charter sequence (Leg1→Leg2) so Settings is the live home before Overview is repurposed. If the conductor parallelizes, this leg's shell edit MUST be the LAST commit (after Leg 1's Settings editors merge) to avoid a recap gap. Flag for the orchestrator.
- **OQ-2 (timezone source quality):** No DST-aware per-venue timezone column exists (§4.1). The RPC's resolution ladder falls back to `events.timezone` then a static offset then UTC. For a venue with NO events and no reservations config, slow-hours will be UTC-bucketed (footnoted "approximate"). **Should Leg 1 add a real `place_pool.iana_timezone` (or `brands.timezone`) column + backfill so intelligence is precise for all venues?** This is a real product-quality question for Seth — recommend a small additive column in Leg 1 (it already touches venue creation fields), but it is OUT of this leg's scope (NG-3). Flag.
- **OQ-3 (reservations as a future intelligence source):** Once reservations have real completion data (META-ORCH-1148 e2e), occupancy/turn-time intelligence could enrich the slow-hours signal. Explicitly deferred (NG-5); noted for a future leg.
- **OQ-4 (brands owner column name):** The RPC's authorization clause assumes `brands.account_id = auth.uid()`. The implementor verifies the exact owner column from the latest `brands` migration; if it is `owner_account_id` or routes through a membership table, use the verified path. Stop-and-amend only if neither resolves.

---

## 11. Downstream routing

- **Next:** mingla-designer (inline or orchestrator-spawned) to produce the pixel-precise tile layout / bar styling / empty-state visual contract for `VenueIntelligenceModule.tsx` (tiles A–G, the CSS-bar sparkline + 24/7 bar rows, score bars, coming-soon pill, empty cards), embedded back into §4.5 as a Design sub-section. THEN mingla-implementor builds per this SPEC + the embedded design.
- **Then:** mingla-tester (adversarial — RPC authz, timezone correctness on a live fixture, no-fabrication, currency edge, Android opaque-glass parity, device QA on business iOS + Android).
- **Then:** mingla-orchestrator CLOSE (flip the three DRAFT invariants ACTIVE, artifact sync, pre-merge gate).
- **Working tree:** `~/Desktop/mingla-orchs/1186-[venue-unify]/` on branch `1186-venue-unify`.

---

## Scoped allowlist (implementor MAY change)
- `supabase/migrations/20261021000000_orch_1186b_venue_intelligence_overview.sql` (new; re-collision-check the stamp)
- `mingla-business/src/services/venueIntelligenceService.ts` (new)
- `mingla-business/src/hooks/useVenueIntelligence.ts` (new)
- `mingla-business/src/components/venue/VenueIntelligenceModule.tsx` (new)
- `mingla-business/src/components/venue/VenueSuiteShell.tsx` (Overview-slot repoint only, §4.7)
- `mingla-business/src/components/venue/__tests__/venueIntelligence.noFabrication.test.ts` (new)
- the SQL fixture/aggregation test file(s) for T-1..T-7 (new)
- a small pure `mingla-business/src/components/venue/venueIntelligence.ts` ONLY if the threshold constant/helpers warrant extraction (optional)

## DO-NOT-TOUCH (stop-and-amend before changing)
- `VenueListingContent.tsx` — Leg 1 owns its relocation/disposition (NG-1).
- `venueModules.ts` / `deriveVenueModules` — module set is unchanged (preserves I-PROPOSED-1148).
- `venueShellScroll.ts` / `moduleSelfScrolls` — self-scroll contract preserved.
- `VenueSettingsModule.tsx` and the Settings editors — Leg 1's domain.
- `place_pool.ai_signal_scores` writers (`run-place-intelligence-trial`, `businessPlaceAuthoringService` write paths) — READ ONLY here.
- `aggregateBrandStatsByBrandIds` / `brandsService.ts` / `eventOrdersService.ts` — reused as reference patterns, NOT modified (the new RPC is the read path).
- Any consumer-app / public-page / admin files (NG-4).

---

## DESIGN (ORCH-1186-B)

**Author:** mingla-designer (inline, dispatched by mingla-forensics for SPEC §11 routing).
**Date:** 2026-06-21 · **Component:** `mingla-business/src/components/venue/VenueIntelligenceModule.tsx`
**Comms ack:** read COMMS_LEDGER on entry; COMMS-0050 (WARN/ALL — do not delete `origin/ORCH-1158-event-page-wizard-fixes`) noted, out of scope for this design-only append (no branch ops performed).
**Verified ground truth (all token/style refs below were read on the `1186-venue-unify` tree):** `constants/designSystem.ts` (spacing/radius/typography/glass/accent/text/semantic/shadows/durations/easings), `utils/currency.ts` (`formatCurrency`/`formatCurrencyRound`, `minor` flag), `components/ui/GlassCard.tsx` (variant/padding props), `components/ui/GlassChrome.tsx` (Android opaque fallback `rgba(20,22,26,0.92)` already encapsulated), `BrandFinanceReportsView.tsx:148-172,410-438,740-750` (CSS-bar sparkline algorithm + JSX + styles), `VenueListingContent.tsx:340-363,511-528` (score-bar markup + styles), `venueSignals.ts:39` (`venueSignalLabel`).

> **The design is GLASS-ON-DARK.** The venue suite renders on the dark business chrome; `glass.*`/`text.*`/`accent.*` tokens are the white-on-dark glass family (NOT the light `colors.*` family). All values below use the dark-glass tokens, matching `VenueListingContent` (the surface this replaces) and `BrandFinanceReportsView` (the sparkline source). There is no separate light theme for the venue suite — it is dark-glass only — so "light AND dark values" collapse to one set; the per-platform delta that matters is the **Android opaque-glass fallback** (§D-8), handled inside `GlassChrome`.

### D-1. Information architecture & reading order

The module answers ONE operator question — *"how is my venue actually doing, and where do I win?"* — top to bottom, most-decisive first:

```
[ kept: reservations-activation invitation card — shell-owned, NOT this module ]   (only when !reservationsEnabled)
┌─ VenueIntelligenceModule (own ScrollView) ──────────────────────────────┐
│  (header strip)   "Venue insights"  +  tz chip "times in {zone}"        │  ← orientation
│  Tile A   REVENUE         headline $$$ + 30-bar sparkline               │  ← the money answer
│  Tile B   SLOW HOURS      24-bar row + "Quietest around 3 PM"           │  ← when to act
│  Tile C   SLOW DAYS       7-bar row  + "Slowest day: Tuesday"           │  ← when to act
│  Tile D   WHICH MOMENTS YOU WIN   signal score bars                     │  ← where you win
│  ── "Coming soon" section label ──                                       │  ← honest roadmap divider
│  Tile E   Busy hours (foot traffic)     [Coming soon]                   │
│  Tile F   Page views & taps             [Coming soon]                   │
│  Tile G   Signal → bookings             [Coming soon]                   │
└─────────────────────────────────────────────────────────────────────────┘
```

Rationale per tile: revenue is the operator's first question (money), slow hours/days are the *actionable* insights (run a promo, change hours), signal-effectiveness is strategic ("where Mingla sends people"). The three coming-soon tiles sit BELOW a quiet divider label so the live tiles never visually blend with the stubs — the divider is the honesty boundary (Constitution #9): everything above is real, everything below is roadmap.

**Flow / branches** (drives which tree renders — full copy in §4.6, visuals in §D-6):
- `isLoading` → module-level centered spinner (no tiles).
- `isError` → single error GlassCard + Retry (no tiles).
- `brandId === null` OR no `place_pool` → E-0 single "No venue insights yet" card (no tiles, no coming-soon section).
- loaded & is-a-venue → header + A–D (each tile self-selects populated vs its own empty) + coming-soon section E–G (E–G ALWAYS render once loaded; they are roadmap, not data-gated).

### D-2. Layout & spacing grid (4/8pt; tokens from `spacing`)

- **Scroll container:** `contentContainerStyle = { paddingHorizontal: spacing.md /*16*/, paddingTop: spacing.md, paddingBottom: insets.bottom + VENUE_SCROLL_NAV_CLEARANCE /*120*/ }`. The module owns its `ScrollView` (SPEC §4.5 self-scroll contract). `showsVerticalScrollIndicator={false}`.
- **Inter-tile gap:** `spacing.md` (16) between every GlassCard. Implement as `gap: spacing.md` on the inner column `View`, OR `marginBottom: spacing.md` per tile — gap preferred (RN ≥0.71 supports it; the suite already uses `gap`).
- **Tile padding:** every GlassCard `padding={spacing.lg}` (24) — matches `VenueListingContent` cards. EXCEPTION: coming-soon tiles `padding={spacing.md}` (16) — they are deliberately smaller/quieter (less visual weight = "not here yet").
- **Tile internal vertical rhythm:** title → (subtitle) → data block → takeaway/footnote, each separated by:
  - title→subtitle: `4` (spacing.xs)
  - subtitle→data block: `spacing.md` (16)
  - data block→takeaway: `spacing.sm` (8)
  - takeaway→footnote: `4`
- **Tile variants:** Tile A (Revenue) = `variant="elevated"` (the hero, radius xl/24, intensity 34) — it leads. Tiles B/C/D = `variant="base"` (radius lg/16, intensity 30). Coming-soon E/F/G = `variant="base"` but visually muted (§D-6).
- **Header strip:** a non-card row above Tile A. `flexDirection:"row"`, `alignItems:"center"`, `justifyContent:"space-between"`, `marginBottom: spacing.md`. Left = screen title; right = tz chip.
- **Coming-soon divider label:** a plain `Text` row, `marginTop: spacing.sm`, `marginBottom: 4`, left-aligned — NOT a card.

### D-3. Type scale (every text element → named `typography` token)

| Element | Token | Color token | Notes |
|---|---|---|---|
| Header title "Venue insights" | `typography.h2` (24/36, 700) | `text.primary` (0.96) | screen orientation |
| tz chip "times in {zone}" | `typography.caption` (12/16, 500) | `text.secondary` (0.72) | inside a pill (§D-6) |
| Tile title (A–D, e.g. "Revenue") | `typography.h3` (20/32, 600) | `text.primary` | |
| Tile subtitle / helper line | `typography.bodySm` (14/20, 400) | `text.secondary` | e.g. Tile D "Where Mingla recommends you most…" |
| Revenue headline value | `typography.statValue` (26/32, 700, ls -0.4) | `text.primary` | the big number; `formatCurrencyRound(..., minor=true)` |
| Revenue secondary "7-day" value | `typography.bodyLg` (18/28, 500) | `text.primary` | smaller than lifetime |
| Revenue metric captions ("Lifetime"/"Last 7 days") | `typography.labelCap` (12/16, 600, ls 1.4) UPPERCASE | `text.tertiary` (0.52) | small caps over each figure |
| Takeaway line ("Quietest around 3 PM") | `typography.bodySm`, **fontWeight 600** | `text.primary` | bold the actionable insight |
| Footnote ("Times approximate…", mixed-currency) | `typography.caption` (12/16) | `text.tertiary` | quiet |
| Bar-row axis label (hour/day ticks) | `typography.micro` (11/14, 600, ls 0.4) | `text.tertiary` | sparse ticks only (§D-5) |
| Score-bar row label | `typography.caption` | `text.secondary` | fixed width 110 (matches source) |
| Score-bar value (number) | `typography.caption`, **fontWeight 700** | `text.primary` | width 28, right-aligned |
| Coming-soon tile title | `typography.bodyLg` (18/28, 500) | `text.secondary` (0.72) | dimmer than live titles — signals "not active" |
| Coming-soon description | `typography.bodySm` | `text.tertiary` (0.52) | |
| "Coming soon" pill text | `typography.micro` (11/14, 600, ls 0.4) UPPERCASE | `accent.warm` (#eb7825) | |
| Empty-state title (E-0/A/B/C/D) | `typography.h3` | `text.primary` | matches `VenueListingContent` emptyTitle |
| Empty-state body | `typography.bodySm` | `text.secondary` | |

**Dynamic Type:** all text uses RN default font scaling (no `allowFontScaling={false}`). Bar HEIGHTS are percentage-of-fixed-track (§D-5) so they do not reflow with type size. The fixed-width score label (110) and value (28) match the shipped `VenueListingContent` source — keep them; they hold at default-to-large type. At accessibility-XL the bar rows stay legible because heights are independent of type.

### D-4. Color & token mapping

All from `designSystem.ts`. No raw hex in the component except where reused verbatim from the sparkline source (the `rgba(255,255,255,0.16)` inactive-bar fill is the established convention — keep it identical for visual parity, or promote to a local const `BAR_INACTIVE = "rgba(255,255,255,0.16)"`).

| Role | Token / value | Contrast on dark glass |
|---|---|---|
| Primary text | `text.primary` `rgba(255,255,255,0.96)` | ≥ 12:1 on `rgba(20,22,26,~0.5–0.92)` — PASS AA/AAA |
| Secondary text | `text.secondary` `rgba(255,255,255,0.72)` | ~7:1 — PASS AA |
| Tertiary/footnote | `text.tertiary` `rgba(255,255,255,0.52)` | ~4.6:1 on the opaque Android fill — PASS AA for ≥12px; iOS translucent worst-case is the concern → see note |
| Active bar / accent fill | `accent.warm` `#eb7825` | the brand action color; used for: recent-5 sparkline bars, the highlighted slow-bucket bar, score-bar fills, the coming-soon pill text |
| Inactive bar | `rgba(255,255,255,0.16)` | the established sparkline-inactive token (BrandFinanceReportsView) |
| Slow-bucket emphasis bar (B/C) | `accent.warm` for the lowest bucket; `rgba(255,255,255,0.28)` for all other buckets | the slow bucket is the INSIGHT → it gets the accent; others are context |
| Bar track (score bars) | `rgba(255,255,255,0.10)` | matches `VenueListingContent.scoreBarTrack` |
| Pill background ("Coming soon") | `accent.tint` `rgba(235,120,37,0.28)` | pill fill behind `accent.warm` text |
| tz-chip background | `glass.tint.badge.idle` `rgba(12,14,18,0.42)` + border `glass.border.badge` `rgba(255,255,255,0.14)` | a glass micro-pill |
| Error icon/accent | `semantic.error` `#ef4444` (icon only, on the error card) | |
| Coming-soon tile tint overlay | none extra — base GlassCard, content dimmed via text tokens + a 0.6 wrapper opacity on the data-less body | signals inactive |

**Contrast note (tertiary text on translucent iOS glass):** `text.tertiary` (0.52 alpha white) over the iOS translucent fill can dip toward ~4.0:1 in the lightest blur condition. Mitigation already structural: footnotes sit inside GlassCard whose backdrop is dark (`rgba(20,22,26,…)` family); the shipped `VenueListingContent` uses the same tertiary for `metaLine`/`subtle` with no complaint. Keep tertiary for footnotes (they are non-essential context); use `text.secondary` for any footnote that carries a REQUIRED honesty caveat (the "Times approximate" footnote → `text.secondary`, not tertiary, so the caveat is never the lowest-contrast text on screen).

### D-5. The bars (CSS `<View>` only — NO svg/charting lib, SPEC NG-6)

Three bar primitives, all `<View>`-based, all reusing the established sparkline/score-bar shapes.

**(a) Revenue 30-day sparkline (Tile A)** — verbatim convention from `BrandFinanceReportsView.tsx:740-750` + `:417-438`:
```
sparklineRow:  { flexDirection:"row", alignItems:"flex-end", gap:4, height:56, marginTop:spacing.md }
sparklineBar:  { flex:1, borderRadius:2 }
// per bar: height: `${Math.max(heightPct, 4)}%`  (4% floor so a zero day still shows a sliver)
// color: last 5 bars (recent) → accent.warm ; older → rgba(255,255,255,0.16)
```
- Data: `revenueTrend.days[].netCents`, normalized 0..100 by max bucket (`computeSparklineBars` shape — reuse the algorithm, fed by RPC daily series instead of client-bucketing).
- Render order oldest→newest left→right (RPC returns oldest→newest, §4.2).
- The 30 bars at `flex:1` with `gap:4` fit the tile width (≈ (cardWidth − 2·24padding) split 30 ways ≈ 8–9px per bar on phone — matches the finance view).

**(b) Slow-hours 24-bar row (Tile B) & slow-days 7-bar row (Tile C)** — same primitive, taller track, with bucket emphasis:
```
barRow:   { flexDirection:"row", alignItems:"flex-end", gap: 3 /*24 bars tight*/, height:72, marginTop:spacing.md }
          // Tile C (7 bars): gap: spacing.sm /*8*/, same height:72
bar:      { flex:1, borderRadius:2 }
// per bar height: `${Math.max(normalized, 6)}%`  (6% floor — empty hour still has a visible stub so the row reads as "24 slots")
// per bar color:
//   - the MINIMUM-count bucket (the "slow" one) → accent.warm   (the insight)
//   - all other buckets → rgba(255,255,255,0.28)                (context)
// Tie rule: if multiple buckets share the min, highlight ALL of them (honest — there are multiple quiet slots).
```
- **Axis ticks (sparse, to keep 24 bars legible):** below the bar row, a `flexDirection:"row", justifyContent:"space-between", marginTop:6` strip with `typography.micro` `text.tertiary` ticks. Tile B (hours): show 4 ticks — `12a · 6a · 12p · 6p` (NOT 24 labels — they'd collide). Tile C (days): show all 7 — `M T W T F S S` (single-letter, evenly spaced under each bar). Hour labels formatted 12-hour in `resolvedTimezone` (the venue-local label, e.g. "3 PM" for the takeaway).
- **No y-axis, no gridlines** (honesty + no-chart-lib): the bars are comparative, not absolute; the takeaway line states the actual insight in words.

**(c) Signal score bars (Tile D)** — verbatim from `VenueListingContent.tsx:511-528`:
```
scoreList:     { marginTop: spacing.sm, gap: spacing.sm }
scoreRow:      { flexDirection:"row", alignItems:"center", gap: spacing.sm }
scoreLabel:    { width:110, ...typography.caption, color: text.secondary }   numberOfLines={1}
scoreBarTrack: { flex:1, height:8, borderRadius:4, backgroundColor:"rgba(255,255,255,0.10)", overflow:"hidden" }
scoreBarFill:  { height:8, borderRadius:4, backgroundColor: accent.warm, width:`${clamp(score,0,100)}%` }
scoreValue:    { width:28, textAlign:"right", ...typography.caption, fontWeight:"700", color: text.primary }
```
- Order: `signalScores` already desc by score (RPC §4.2). Render top→bottom. Label via `venueSignalLabel(id)`.

**Normalization helper (pure, testable):** extract `normalizeBars(counts: number[]): number[]` returning `value/Math.max(...counts,1)*100`. Used by B and C. Tile A reuses the sparkline algorithm. This keeps bar math out of JSX and gives the no-fab/threshold test a clean seam. (Optional `venueIntelligence.ts` per SPEC scoped-allowlist.)

### D-6. Every interactive & content state (exact values)

**Tile A — Revenue (populated, `orderCount > 0`):**
- Title "Revenue" (`h3`). Two-column metric header: left `Lifetime` (labelCap) over `formatCurrencyRound(revenueByCurrency[defaultCurrency] ?? 0, brandDefaultCurrency, true)` (statValue); right `Last 7 days` (labelCap) over `formatCurrencyRound(rev7dByCurrency[defaultCurrency] ?? 0, brandDefaultCurrency, true)` (bodyLg). Columns: `flexDirection:"row", justifyContent:"space-between", alignItems:"flex-end"`.
- 30-bar sparkline below (§D-5a).
- Mixed-currency footnote (caption, tertiary) when `Object.keys(revenueByCurrency).filter(k=>revenueByCurrency[k]>0).length > 1`: `"Showing {DEFAULT} only — you also have sales in {others}."` (`others` = comma-joined other currency codes).
- **E-A (orderCount === 0):** the WHOLE Tile A body becomes the empty card — title "No sales yet" (h3) + body "When people book or buy on Mingla, your revenue and trends show up here." (bodySm, secondary). NO `$`, NO statValue, NO sparkline rendered (the `<View style={styles.bar*}>` and any currency-formatted string must be absent from this branch — enforced by §9 no-fab grep).

**Tile B — Slow hours (populated, `orderCount ≥ 14`):**
- Title "Slow hours" (h3). 24-bar row (§D-5b) + 4 sparse ticks.
- Takeaway (bodySm, 600, primary): `"Quietest around {hourLabel}."` where hourLabel = 12-hour venue-local label of the min bucket (or `"{a}, {b} and {c}"` for ties, capped at listing 3 then "+N more").
- tz footnote: if `tzConfidence === 'iana'` → no approximate footnote (the header chip already says "times in {zone}"); if `!== 'iana'` → footnote (bodySm/**secondary** per §D-4 caveat rule): `"Times approximate — set your venue timezone for precision."`
- **E-B (orderCount < 14):** title "Not enough data yet" + body `"We'll show your slow hours once you've had a bit more activity — about {14 - orderCount} more {order|orders} to go."` (pluralize on `14-orderCount === 1`). NO bars, NO numbers other than the honest real `14 - orderCount` remaining count.

**Tile C — Slow days (populated, `orderCount ≥ 14`):**
- Title "Slow days" (h3). 7-bar row (§D-5b) + Mon–Sun single-letter ticks.
- Takeaway: `"Slowest day: {weekdayLabel}."` (full weekday name of the min bucket; ties → list).
- **E-C (orderCount < 14):** identical pattern to E-B with "slow days" / "We'll show your slow days …".

**Tile D — Which moments you win (populated, `signalScores.length > 0`):**
- Title "Which moments you win" (h3). Subtitle (bodySm, secondary): "Where Mingla recommends you most. Improve these in Settings." Score bars (§D-5c).
- **E-D (signalScores.length === 0):** title "Not scored yet" (h3) + body "We haven't scored this venue yet. Add details in Settings and run 'Recommend me' to see where you win." NO bars, NO numbers.

**Tiles E/F/G — Coming soon (ALWAYS render once loaded; carry NO data):**
- GlassCard `variant="base"`, `padding={spacing.md}`. Row layout: title (bodyLg, **text.secondary** — dimmed) on the left, "Coming soon" pill on the right (`flexDirection:"row", justifyContent:"space-between", alignItems:"center"`). Description line below (bodySm, **text.tertiary**).
- **Pill:** `paddingVertical:3, paddingHorizontal:8, borderRadius:radius.full, backgroundColor: accent.tint` with text `typography.micro` UPPERCASE `accent.warm`, content `"COMING SOON"`.
- Copy:
  - E — title "Busy hours" · desc "See when people actually visit, powered by live foot-traffic data."
  - F — title "Page views & taps" · desc "How many people viewed your venue page and tapped through."
  - G — title "Signal → bookings" · desc "Which moments actually turn into bookings."
- **HARD: zero numbers, zero `$`, zero `<View style={styles.bar*}>` in E/F/G JSX** (Constitution #9; §9 no-fab grep). No skeleton bars either — a skeleton implies "loading real data," which is dishonest here.

**Module-level states:**
- **Loading** (`isLoading`): a single centered `<ActivityIndicator color={accent.warm} />` in a `flex:1, justifyContent:"center", alignItems:"center", paddingVertical: spacing.xxl` View (mirror `VenueListingContent.tsx:261-264`). No tiles, no skeleton-of-tiles (avoids layout flash). Header strip omitted while loading.
- **Error** (`isError`): single GlassCard `variant="base"`: an alert icon (`Icon` name e.g. `"alert-circle"`, `semantic.error`, 24), title "Couldn't load your insights" (h3), body "Pull to refresh or try again." (bodySm/secondary), then a `Button label="Try again" variant="secondary" size="md"` onPress `refetch()`. Also wire `RefreshControl` (tintColor `accent.warm`) on the ScrollView so pull-to-refresh works in every state.
- **E-0** (`brandId === null` or no place_pool): single GlassCard `variant="elevated"`: title "No venue insights yet" (h3) + body "Add your venue to start seeing how it performs on Mingla." (bodySm/secondary) + `Button label="Add your venue" variant="primary"` → `router.push("/venue/create")` (mirror `VenueListingContent.tsx:251-260`). No header chip, no coming-soon section (nothing to roadmap for a non-venue).
- **Press states:** the only pressables are Buttons (E-0 "Add your venue", error "Try again") — they inherit `Button`'s built-in press (0.96 scale / opacity per the shared component). Bars/tiles are NOT pressable (read-only intelligence; no dead taps, no fake affordance). The tz chip is non-interactive (it's a label).

### D-7. Motion spec

Restrained — this is a glanceable dashboard, not a celebration surface. Motion communicates "data arrived," nothing decorative.

| Trigger | Property | Curve | Duration | Reduced-motion fallback |
|---|---|---|---|---|
| Tiles mount after load (loading→loaded) | container `opacity` 0→1 | `easings.out` (cubic-bezier(0.33,1,0.68,1)) | `durations.entry` (260ms) | render at opacity 1 immediately (no fade) |
| Bars first paint (A/B/C) | bar `height` 0→target (grow up from baseline; `alignItems:"flex-end"` makes them grow upward) | `easings.out` | `durations.slow` (320ms), stagger 8ms per bar (cap total ~600ms) | render bars at final height, no grow |
| Score-bar fill (D) first paint | `width` 0→`{score}%` | `easings.out` | `durations.slow` (320ms) | final width, no animate |
| Pull-to-refresh | native `RefreshControl` | platform default | platform | unchanged (essential feedback) |
| Button press | scale/opacity (Button-owned) | press curve | `durations.fast` | Button handles it |

- **Implementation note:** bar grow/fade is OPTIONAL polish — if reduced-motion is on (`AccessibilityInfo.isReduceMotionEnabled`) OR to keep the first pass simple, render at final values. The SPEC's correctness contract does not depend on motion. Use RN `Animated`/Reanimated `withTiming`. Animating `height`/`width` here is acceptable (small bar count, not a layout-thrash hot path) and matches the established sparkline which renders statically — animation is additive, never required.
- **No looping/idle animation** anywhere (battery + honesty: a pulsing coming-soon tile would imply activity).

### D-8. Accessibility

- **Touch targets:** the two Buttons are the only targets — `Button size="md"` is ≥44pt (shared component guarantees it). No sub-44 tappables exist.
- **Bars are decorative-with-a-text-equivalent:** the bar rows carry `accessibilityElementsHidden` / `importantForAccessibility="no-hide-descendants"` is WRONG here — instead, give each bar ROW a single `accessibilityRole="image"` + `accessibilityLabel` summarizing the data in words, e.g. Tile B row: `"Orders by hour. Quietest around 3 PM."`; Tile C: `"Orders by day. Slowest day Tuesday."`; Tile A sparkline: `"30-day revenue trend."` The individual `<View>` bars themselves are non-focusable (no label) so VoiceOver reads the one summary, not 24 empty views. The takeaway text line is the screen-reader-accessible truth (color is never the only indicator — the slow bucket is ALSO named in words).
- **Score bars:** each `scoreRow` gets `accessibilityLabel={`${label}: ${score} out of 100`}` so VoiceOver reads "Romantic: 88 out of 100" (the visual bar + the printed value + the label all agree).
- **tz chip:** `accessibilityLabel="Times shown in {zone}"`.
- **Coming-soon pill:** the tile gets `accessibilityLabel={`${title}. Coming soon. ${description}`}` so the pill's meaning is spoken.
- **Reading order:** header → A → B → C → D → coming-soon label → E → F → G (natural DOM/JSX order; no `accessibilityViewIsModal` needed — it's a scroll surface).
- **Contrast:** all text pairings pass AA per §D-4 (required honesty caveats use `text.secondary`, never tertiary).
- **Reduced motion:** every animation (§D-7) has a no-animate fallback; default to static if `isReduceMotionEnabled`.
- **Color independence:** the "slow" bucket is conveyed by the takeaway sentence, not solely by the accent color — colorblind-safe.
- **One-handed reach:** the module self-scrolls; the only actions (Buttons) appear in empty/error states centered in the card, within thumb arc; there are no top-pinned actions.

### D-9. Per-platform deltas

- **iOS:** GlassCard renders the translucent 5-layer glass (blur intensity 30/34 per variant) — the design's native look. Sparkline/bars as specified.
- **Android (ANDROID_GLASS_USES_OPAQUE_FALLBACK — hard policy):** `GlassChrome` ALREADY substitutes an **opaque** fill `rgba(20,22,26,0.92)` with NO blur and clips with `overflow:"hidden"` and drops the under-fill shadow — so every GlassCard in this module inherits the compliant opaque frosted fill automatically. **The implementor uses GlassCard and does NOT hand-roll any translucent Android fill.** Visual deltas to verify on an Android build: (1) tile fills read as solid dark `#14161A`-ish, not see-through; (2) `accent.warm` bars and `accent.tint` pill remain vivid on the opaque fill (they do — both are opaque/semi-opaque accent values); (3) the score-bar track `rgba(255,255,255,0.10)` is faint-but-visible on the opaque fill (it is — matches shipped `VenueListingContent` on Android). The bars/sparkline are plain `<View>`s — identical on both platforms (no blur dependency).
- **Web (business desktop, `isWideDesktop`):** same RN component renders in the desktop workspace column (SPEC §3 row 7). The tile column inherits the workspace width (full-width post-ORCH-1184). The 30-bar sparkline + 24-bar row scale up gracefully (`flex:1` bars widen); no layout change needed. Pull-to-refresh has no web gesture — the error-card "Try again" button is the web refetch path (already specified), so web is not gesture-dependent.

### D-10. Build-ready handoff (tokens, primitives, new constants)

- **Existing tokens used (no new design tokens required):** `spacing.{xs,sm,md,lg,xxl}`, `radius.{lg,xl,full}`, `typography.{h2,h3,bodyLg,body,bodySm,caption,micro,labelCap,statValue}`, `text.{primary,secondary,tertiary}`, `accent.{warm,tint}`, `glass.tint.badge.idle`, `glass.border.badge`, `semantic.error`, `durations.{entry,slow,fast}`, `easings.out`, `shadows` (via GlassCard).
- **RN primitives / shared components:** `ScrollView` (+ `RefreshControl`), `View`, `Text`, `ActivityIndicator`, `Animated` (optional motion), `GlassCard` (`variant`, `padding`), `Button` (`label`, `variant`, `size`, `onPress`, `fullWidth`), `Icon`, `useSafeAreaInsets`, `useRouter`.
- **Helpers:** `formatCurrencyRound(value, currency, /*minor*/true)` and (if a non-rounded figure is ever shown) `formatCurrency` — both from `utils/currency.ts`, NEVER ad-hoc `Intl.NumberFormat` (enforced §9). `venueSignalLabel(id)` from `constants/venueSignals.ts`. `VENUE_SCROLL_NAV_CLEARANCE` from `venueShellScroll.ts`.
- **Local consts to define in the component (or `venueIntelligence.ts`):** `INTELLIGENCE_MIN_ORDERS_FOR_TIME_BUCKETS = 14` (the §9 threshold anchor — MUST be present), `BAR_INACTIVE = "rgba(255,255,255,0.16)"`, `BAR_CONTEXT = "rgba(255,255,255,0.28)"`, `BAR_HEIGHT_FLOOR_PCT` (4 for sparkline / 6 for hour-day rows), `normalizeBars(counts)` pure helper.
- **No new style/token system additions.** Every value maps to an existing token or a verbatim-reused convention from the two reference files; the design is fully buildable from this section + SPEC §4.

### D-11. Honesty checklist (Constitution #9 — pre-merge design verification)

1. Coming-soon tiles E/F/G contain NO `$`, NO digit-metric, NO bar `<View>` — verified by §9 Safeguard 2 grep.
2. Empty tiles (E-A/B/C/D, E-0) render copy ONLY — no bars, no `$`, no fabricated numbers; the only number allowed is the honest real `14 - orderCount` countdown in E-B/E-C.
3. No skeleton bars anywhere (a skeleton implies real data is loading; coming-soon has none).
4. Slow-bucket insight is conveyed in WORDS (takeaway) as well as color — never color-only.
5. tz approximation is disclosed (footnote) whenever `tzConfidence !== 'iana'` — never silently UTC-wrong.
6. Mixed-currency disclosed; never cross-summed (UI shows default only + footnote; RPC enforces per-currency).
7. All money via `formatCurrency*` (currency-aware symbol) — never a hardcoded `$`/`£`.
